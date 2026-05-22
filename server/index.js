import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import { randomUUID } from 'crypto';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { createNearbyJobsHandler, reverseGeocode } from './geoSearch.js';
import {
  clampScoutRadius,
  getClientIp,
  getErrorMessage,
  MAX_RESUME_BYTES,
  MAX_SCOUT_RADIUS_METERS,
  MAX_SSE_CONNECTIONS_PER_IP,
  MIN_SCOUT_RADIUS_METERS,
  SSE_CONNECTION_TTL_MS,
} from './limits.js';
import { migrate, query } from './db.js';
import { getFunnelStats } from './analytics.js';
import { sendBusinessNotifications, sendBusinessSignupAlert } from './notifier.js';
import { cleanupStaleScoutRuns, createScoutRun, deleteScoutRun, getScoutRun, runScout, visitBusiness, skipBusiness, subscribeScoutRun } from './scoutRunner.js';
import { createRequestId, logError, logInfo, logWarn } from './logger.js';
import { reserveDailyUsage } from './budgetGuard.js';

config();

const app = express();
const cache = new NodeCache({ stdTTL: 86400 }); // 24 hour cache to respect free tier
const sseConnections = new Map();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

app.set('trust proxy', 1);
app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  const startedAt = Date.now();
  req.requestId = req.headers['x-request-id'] || createRequestId();
  res.setHeader('x-request-id', req.requestId);
  res.on('finish', () => {
    logInfo('http_request_finished', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });
  });
  next();
});
app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests from this IP. General API access is limited to 60 requests per minute.',
  },
}));

const scoutRunRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many scout runs from this IP. Scout runs are limited to 10 per hour.',
  },
});

const SEARCH_API_KEY = process.env.SEARCH_API_KEY;
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const ALLOWED_LOCAL_EMAIL_CHARS = new Set(['.', '!', '#', '$', '%', '&', "'", '*', '+', '/', '=', '?', '^', '_', '`', '{', '|', '}', '~', '-']);

function isAsciiAlphaNumeric(char) {
  const code = char.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isValidEmail(email) {
  if (!email || email.length > 254 || email.includes(' ')) return false;
  const at = email.indexOf('@');
  if (at <= 0 || at !== email.lastIndexOf('@') || at === email.length - 1) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (!local || !domain || local.length > 64 || !domain.includes('.')) return false;
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;

  for (const char of local) {
    if (!isAsciiAlphaNumeric(char) && !ALLOWED_LOCAL_EMAIL_CHARS.has(char)) {
      return false;
    }
  }

  const labels = domain.split('.');
  if (labels.some(label => !label || label.startsWith('-') || label.endsWith('-'))) return false;
  for (const char of domain) {
    if (!isAsciiAlphaNumeric(char) && char !== '.' && char !== '-') return false;
  }

  return true;
}

if (!SEARCH_API_KEY || !MAPBOX_TOKEN || !GOOGLE_PLACES_API_KEY) {
  logWarn('config_missing_required_env', {
    searchApiConfigured: Boolean(SEARCH_API_KEY),
    mapboxConfigured: Boolean(MAPBOX_TOKEN),
    googlePlacesConfigured: Boolean(GOOGLE_PLACES_API_KEY),
  });
}

function trackSseConnection(ip, connection) {
  const connections = sseConnections.get(ip) || new Set();
  connections.add(connection);
  sseConnections.set(ip, connections);
}

function releaseSseConnection(ip, connection) {
  const connections = sseConnections.get(ip);
  if (!connections) return;
  connections.delete(connection);
  if (connections.size === 0) {
    sseConnections.delete(ip);
  }
}

// --- Geocode with company name for precise office location ---
async function geocodeLocation(location, company = null) {
  // Try company + location first for more precise results
  const searchQueries = company
    ? [`${company} ${location}`, location]
    : [location];

  for (const query of searchQueries) {
    const cacheKey = `geo:${query}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=place,region,district,locality,address,poi_label`;

    try {
      reserveDailyUsage('mapbox', { operation: 'geocode_location' });
      const res = await fetch(url);
      const data = await res.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        const result = { lat, lng, placeName: data.features[0].place_name };
        cache.set(cacheKey, result);
        return result;
      }
    } catch (err) {
      logError('geocode_failed', { query, error: err });
    }
  }

  return null;
}

// --- Search jobs via SearchAPI ---
app.get('/api/jobs', async (req, res) => {
  const { query, location, chips } = req.query;

  if (!query) return res.status(400).json({ error: 'query is required' });

  const cacheKey = `jobs:${query}:${location}:${chips}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ jobs: cached, fromCache: true });

  try {
    reserveDailyUsage('searchApi', { operation: 'jobs_route', query: String(query).slice(0, 80) });
    const params = new URLSearchParams({
      engine: 'google_jobs',
      q: query,
      api_key: SEARCH_API_KEY,
      num: '20',
    });

    if (location) params.set('location', location);
    if (chips) params.set('chips', chips); // e.g. date_posted:week

    const apiRes = await fetch(`https://www.searchapi.io/api/v1/search?${params}`);
    const apiData = await apiRes.json();

    logInfo('jobs_searchapi_response', {
      query,
      status: apiRes.status,
      error: apiData.error,
      jobsCount: apiData.jobs_results?.length || 0,
    });

    if (apiData.error) {
      return res.status(500).json({ error: apiData.error });
    }

    const rawJobs = apiData.jobs || apiData.jobs_results || [];

    // Geocode each job with company name for precise office location
    const jobsWithGeo = await Promise.all(
      rawJobs.map(async job => {
        const geo = await geocodeLocation(job.location, job.company_name);
        return [job, geo];
      })
    );

    const jobs = jobsWithGeo
      .map(([job, geo]) => {
        return {
          id: job.snake_up_apply_id || `${job.company_name}-${job.title}-${job.location}`,
          title: job.title,
          company: job.company_name,
          location: job.location,
          via: job.via,
          description: job.description,
          salary: job.salary_range ?? null,
          workType: job.work_from_home ? 'Remote' : 'On-site',
          postedAt: job.posted_at ?? null,
          applyLink: job.apply_link ?? null,
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
          hasCoords: geo !== null,
        };
      });

    cache.set(cacheKey, jobs);
    res.json({ jobs, fromCache: false });
  } catch (err) {
    logError('jobs_search_failed', { requestId: req.requestId, error: err });
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.get('/api/reverse-geocode', async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  try {
    const locationLabel = await reverseGeocode(lat, lng, MAPBOX_TOKEN);
    res.json({ locationLabel: locationLabel || null });
  } catch (err) {
    logError('reverse_geocode_route_failed', { lat, lng, error: err });
    res.status(500).json({ error: 'Failed to resolve location' });
  }
});

app.get('/api/nearby-jobs', createNearbyJobsHandler({
  cache,
  mapboxToken: MAPBOX_TOKEN,
}));

app.post('/api/business-signups', async (req, res) => {
  const businessName = String(req.body?.businessName || '').trim().slice(0, 160);
  const contactName = String(req.body?.contactName || '').trim().slice(0, 120);
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 254);
  const city = String(req.body?.city || '').trim().slice(0, 100);
  const state = String(req.body?.state || '').trim().slice(0, 60);
  const hiringCategories = Array.isArray(req.body?.hiringCategories)
    ? [...new Set(req.body.hiringCategories.map(item => String(item || '').trim()).filter(Boolean))].slice(0, 20)
    : [];
  const currentHiringChannel = String(req.body?.currentHiringChannel || '').trim().slice(0, 800);
  const hiresPerYear = String(req.body?.hiresPerYear || '').trim().slice(0, 80);
  const source = String(req.body?.source || 'for-businesses/signup').trim().slice(0, 120);

  if (!businessName || !contactName || !isValidEmail(email) || !city || !state || hiringCategories.length === 0) {
    logWarn('business_signup_rejected', {
      requestId: req.requestId,
      reason: 'missing_required_fields',
      businessNamePresent: Boolean(businessName),
      contactNamePresent: Boolean(contactName),
      emailValid: isValidEmail(email),
      cityPresent: Boolean(city),
      statePresent: Boolean(state),
      hiringCategoryCount: hiringCategories.length,
    });
    return res.status(400).json({ error: 'Business name, your name, valid email, city, state, and at least one hiring category are required.' });
  }

  try {
    const result = await query(
      `INSERT INTO business_signups
        (business_name, contact_name, email, city, state, hiring_categories, current_hiring_channel, hires_per_year, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, business_name, contact_name, email, city, state, hiring_categories, current_hiring_channel, hires_per_year, source, created_at`,
      [
        businessName,
        contactName,
        email,
        city,
        state,
        JSON.stringify(hiringCategories),
        currentHiringChannel || null,
        hiresPerYear || null,
        source || null,
      ]
    );
    const row = result.rows[0];
    const signup = {
      id: row.id,
      businessName: row.business_name,
      contactName: row.contact_name,
      email: row.email,
      city: row.city,
      state: row.state,
      hiringCategories: row.hiring_categories || [],
      currentHiringChannel: row.current_hiring_channel,
      hiresPerYear: row.hires_per_year,
      source: row.source,
      createdAt: row.created_at,
    };
    const alert = await sendBusinessSignupAlert(signup);
    logInfo('business_signup_created', {
      requestId: req.requestId,
      signupId: signup.id,
      businessName: signup.businessName,
      city: signup.city,
      state: signup.state,
      hiringCategoryCount: signup.hiringCategories.length,
      alertSent: Boolean(alert.sent),
    });
    return res.status(201).json({ id: signup.id, alert });
  } catch (err) {
    logError('business_signup_failed', { requestId: req.requestId, error: err });
    return res.status(500).json({ error: getErrorMessage(err) || 'Failed to submit business signup' });
  }
});

app.post('/api/scout-runs', scoutRunRateLimit, async (req, res) => {
  const resumeText = String(req.body.resumeText || '').trim();
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  const radius = clampScoutRadius(req.body.radius || 1000);
  const locationLabel = req.body.locationLabel || null;
  const targetLanes = Array.isArray(req.body.targetLanes)
    ? req.body.targetLanes.map(item => String(item).trim()).filter(Boolean).slice(0, 3)
    : [];
  const avoidTerms = String(req.body.avoidTerms || '').trim().slice(0, 300);

  if (resumeText.length < 40) {
    logWarn('scout_create_rejected', { requestId: req.requestId, reason: 'resume_too_short' });
    return res.status(400).json({ error: 'resumeText is required and must be at least 40 characters' });
  }
  if (Buffer.byteLength(resumeText, 'utf8') > MAX_RESUME_BYTES) {
    logWarn('scout_create_rejected', { requestId: req.requestId, reason: 'resume_too_large' });
    return res.status(400).json({ error: 'resumeText must be 15KB or smaller before starting a scout run' });
  }
  if (targetLanes.length === 0) {
    logWarn('scout_create_rejected', { requestId: req.requestId, reason: 'missing_target_lanes' });
    return res.status(400).json({ error: 'Choose at least one kind of work to target' });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    logWarn('scout_create_rejected', { requestId: req.requestId, reason: 'invalid_coordinates' });
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  if (!Number.isFinite(radius) || radius < MIN_SCOUT_RADIUS_METERS) {
    logWarn('scout_create_rejected', { requestId: req.requestId, reason: 'invalid_radius', radius });
    return res.status(400).json({ error: `radius must be at least ${MIN_SCOUT_RADIUS_METERS} meters and no more than ${MAX_SCOUT_RADIUS_METERS} meters` });
  }

  try {
    reserveDailyUsage('scoutRuns', { operation: 'create_scout_run' });
    logInfo('scout_create_started', {
      requestId: req.requestId,
      resumeBytes: Buffer.byteLength(resumeText, 'utf8'),
      targetLanes,
      avoidTermsPresent: Boolean(avoidTerms),
      lat,
      lng,
      radius,
      locationLabel,
    });
    const runId = await createScoutRun({ resumeText, lat, lng, radius, locationLabel, targetLanes, avoidTerms });
    logInfo('scout_create_accepted', { requestId: req.requestId, runId });
    res.status(202).json({ runId });
    runScout(runId, cache).catch(err => {
      logError('scout_background_run_unhandled', { requestId: req.requestId, runId, error: err });
    });
  } catch (err) {
    logError('scout_create_failed', { requestId: req.requestId, error: err });
    res.status(500).json({ error: getErrorMessage(err) || 'Failed to create scout run' });
  }
});

app.get('/api/scout-runs/:runId', async (req, res) => {
  try {
    const run = await getScoutRun(req.params.runId);
    if (!run) {
      logWarn('scout_get_not_found', { requestId: req.requestId, runId: req.params.runId });
      return res.status(404).json({ error: 'Scout run not found' });
    }
    logInfo('scout_get_loaded', {
      requestId: req.requestId,
      runId: req.params.runId,
      status: run.run.status,
      businessCount: run.businesses.length,
      opportunityCount: run.opportunities.length,
      matchCount: run.matches.length,
    });
    res.json(run);
  } catch (err) {
    logError('scout_get_failed', { requestId: req.requestId, runId: req.params.runId, error: err });
    res.status(500).json({ error: getErrorMessage(err) || 'Failed to load scout run' });
  }
});

app.delete('/api/scout-runs/:runId', async (req, res) => {
  try {
    const deleted = await deleteScoutRun(req.params.runId);
    if (!deleted) {
      logWarn('scout_delete_not_found', { requestId: req.requestId, runId: req.params.runId });
      return res.status(404).json({ error: 'Scout run not found' });
    }
    logInfo('scout_deleted', { requestId: req.requestId, runId: req.params.runId });
    res.status(204).end();
  } catch (err) {
    logError('scout_delete_failed', { requestId: req.requestId, runId: req.params.runId, error: err });
    res.status(500).json({ error: getErrorMessage(err) || 'Failed to delete scout run' });
  }
});

app.post('/api/scout-runs/:runId/visit/:placeId', async (req, res) => {
  try {
    logInfo('business_visit_requested', { requestId: req.requestId, runId: req.params.runId, placeId: req.params.placeId });
    res.status(202).json({ ok: true });
    visitBusiness(req.params.runId, req.params.placeId, cache).catch(err => {
      logError('business_visit_unhandled', { requestId: req.requestId, runId: req.params.runId, placeId: req.params.placeId, error: err });
    });
  } catch (err) {
    logError('business_visit_request_failed', { requestId: req.requestId, runId: req.params.runId, placeId: req.params.placeId, error: err });
    res.status(500).json({ error: getErrorMessage(err) || 'Failed to visit business' });
  }
});

app.post('/api/scout-runs/:runId/skip/:placeId', async (req, res) => {
  try {
    logInfo('business_skip_requested', { requestId: req.requestId, runId: req.params.runId, placeId: req.params.placeId });
    res.status(202).json({ ok: true });
    skipBusiness(req.params.runId, req.params.placeId).catch(err => {
      logError('business_skip_unhandled', { requestId: req.requestId, runId: req.params.runId, placeId: req.params.placeId, error: err });
    });
  } catch (err) {
    logError('business_skip_request_failed', { requestId: req.requestId, runId: req.params.runId, placeId: req.params.placeId, error: err });
    res.status(500).json({ error: getErrorMessage(err) || 'Failed to skip business' });
  }
});

app.post('/api/scout-runs/:runId/interest', async (req, res) => {
  const runId = String(req.params.runId || '').trim();
  const seekerEmail = String(req.body?.seekerEmail || '').trim().toLowerCase();
  const rawPlaceIds = Array.isArray(req.body?.businessPlaceIds) ? req.body.businessPlaceIds : null;

  if (!isValidEmail(seekerEmail)) {
    logWarn('interest_submit_rejected', { requestId: req.requestId, runId, reason: 'invalid_email' });
    return res.status(400).json({ error: 'seekerEmail must be a valid email address' });
  }

  if (!rawPlaceIds || rawPlaceIds.length === 0 || rawPlaceIds.length > 10) {
    logWarn('interest_submit_rejected', { requestId: req.requestId, runId, reason: 'invalid_place_ids_count', count: rawPlaceIds?.length || 0 });
    return res.status(400).json({ error: 'businessPlaceIds must be a non-empty array with at most 10 entries' });
  }

  const businessPlaceIds = rawPlaceIds
    .map(value => String(value || '').trim())
    .filter(Boolean);

  if (businessPlaceIds.length === 0) {
    logWarn('interest_submit_rejected', { requestId: req.requestId, runId, reason: 'empty_place_ids' });
    return res.status(400).json({ error: 'businessPlaceIds must contain valid place ids' });
  }

  try {
    logInfo('interest_submit_started', {
      requestId: req.requestId,
      runId,
      requestedBusinessCount: businessPlaceIds.length,
    });
    const runResult = await query('SELECT id, status FROM scout_runs WHERE id = $1', [runId]);
    if (runResult.rowCount === 0) {
      logWarn('interest_submit_rejected', { requestId: req.requestId, runId, reason: 'run_not_found' });
      return res.status(404).json({ error: 'Scout run not found' });
    }
    if (runResult.rows[0].status !== 'complete') {
      logWarn('interest_submit_rejected', { requestId: req.requestId, runId, reason: 'run_not_complete', status: runResult.rows[0].status });
      return res.status(400).json({ error: 'Scout run must be complete before submitting interest' });
    }

    const existing = await query('SELECT 1 FROM scout_interest WHERE run_id = $1 LIMIT 1', [runId]);
    if (existing.rowCount > 0) {
      logWarn('interest_submit_rejected', { requestId: req.requestId, runId, reason: 'duplicate_interest' });
      return res.status(409).json({ error: 'Interest already submitted for this run' });
    }

    const uniquePlaceIds = Array.from(new Set(businessPlaceIds));
    const businesses = await query(
      `SELECT place_id, name, contact_email, fit_score
       FROM scout_businesses
       WHERE run_id = $1
         AND place_id = ANY($2::text[])`,
      [runId, uniquePlaceIds]
    );

    const byPlaceId = new Map(businesses.rows.map(row => [row.place_id, row]));
    let saved = 0;
    let willNotify = 0;

    for (const placeId of uniquePlaceIds) {
      const business = byPlaceId.get(placeId);
      if (!business) continue;

      await query(
        `INSERT INTO scout_interest
          (id, run_id, business_place_id, business_name, business_contact_email, seeker_email, fit_score)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          runId,
          business.place_id,
          business.name,
          business.contact_email || null,
          seekerEmail,
          Number.isFinite(Number(business.fit_score)) ? Number(business.fit_score) : 0,
        ]
      );
      saved += 1;
      if (business.contact_email) willNotify += 1;
    }

    const notification = await sendBusinessNotifications(runId).catch(err => {
      logError('interest_notification_unhandled', { requestId: req.requestId, runId, error: err });
      return { configured: false, attempted: willNotify, sent: 0, seekerFollowupsSent: 0, failed: willNotify, reason: 'notification_error' };
    });

    logInfo('interest_submit_completed', { requestId: req.requestId, runId, saved, willNotify, notification });
    return res.json({ saved, willNotify, notification });
  } catch (err) {
    logError('interest_submit_failed', { requestId: req.requestId, runId, error: err });
    return res.status(500).json({ error: err.message || 'Failed to save scout interest' });
  }
});

app.get('/api/match/:token', async (req, res) => {
  const token = String(req.params.token || '').trim();

  try {
    const result = await query(
      `SELECT id, business_name, fit_score, match_token, contacted_at, opened_at
       FROM scout_interest
       WHERE match_token = $1
       LIMIT 1`,
      [token]
    );

    if (result.rowCount === 0) {
      logWarn('match_link_not_found', { requestId: req.requestId, tokenPrefix: token.slice(0, 8) });
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = result.rows[0];
    if (!match.opened_at) {
      await query(
        `UPDATE scout_interest
         SET opened_at = now()
         WHERE id = $1
           AND opened_at IS NULL`,
        [match.id]
      );
    }

    logInfo('match_link_opened', {
      requestId: req.requestId,
      scoutInterestId: match.id,
      firstOpen: !match.opened_at,
      alreadyContacted: Boolean(match.contacted_at),
    });
    return res.json({
      businessName: match.business_name,
      fitScore: match.fit_score,
      matchToken: match.match_token,
      alreadyContacted: Boolean(match.contacted_at),
    });
  } catch (err) {
    logError('match_link_load_failed', { requestId: req.requestId, tokenPrefix: token.slice(0, 8), error: err });
    return res.status(500).json({ error: err.message || 'Failed to load match' });
  }
});

app.post('/api/match/:token/contact', async (req, res) => {
  const token = String(req.params.token || '').trim();

  try {
    const result = await query(
      `SELECT id, seeker_email, contacted_at
       FROM scout_interest
       WHERE match_token = $1
       LIMIT 1`,
      [token]
    );

    if (result.rowCount === 0) {
      logWarn('match_contact_not_found', { requestId: req.requestId, tokenPrefix: token.slice(0, 8) });
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = result.rows[0];
    if (match.contacted_at) {
      logWarn('match_contact_duplicate', { requestId: req.requestId, scoutInterestId: match.id });
      return res.status(409).json({ error: 'Match already contacted' });
    }

    const updated = await query(
      `UPDATE scout_interest
       SET contacted_at = now()
       WHERE id = $1
         AND contacted_at IS NULL
       RETURNING seeker_email`,
      [match.id]
    );

    if (updated.rowCount === 0) {
      logWarn('match_contact_race_duplicate', { requestId: req.requestId, scoutInterestId: match.id });
      return res.status(409).json({ error: 'Match already contacted' });
    }

    logInfo('match_contact_completed', { requestId: req.requestId, scoutInterestId: match.id });
    return res.json({ seekerEmail: updated.rows[0].seeker_email });
  } catch (err) {
    logError('match_contact_failed', { requestId: req.requestId, tokenPrefix: token.slice(0, 8), error: err });
    return res.status(500).json({ error: err.message || 'Failed to contact match' });
  }
});

app.get('/api/match/:token/confirm', async (req, res) => {
  const token = String(req.params.token || '').trim();

  try {
    const result = await query(
      `SELECT id, business_name
       FROM scout_interest
       WHERE match_token = $1
       LIMIT 1`,
      [token]
    );

    if (result.rowCount === 0) {
      logWarn('match_confirm_not_found', { requestId: req.requestId, tokenPrefix: token.slice(0, 8) });
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = result.rows[0];
    await query(
      `UPDATE scout_interest
       SET seeker_confirmed_at = now()
       WHERE id = $1
         AND seeker_confirmed_at IS NULL`,
      [match.id]
    );

    logInfo('match_confirm_completed', { requestId: req.requestId, scoutInterestId: match.id });
    return res.json({
      businessName: match.business_name,
      confirmed: true,
    });
  } catch (err) {
    logError('match_confirm_failed', { requestId: req.requestId, tokenPrefix: token.slice(0, 8), error: err });
    return res.status(500).json({ error: err.message || 'Failed to confirm match' });
  }
});

app.get('/api/admin/funnel', async (req, res) => {
  const adminToken = process.env.ADMIN_TOKEN;
  const authHeader = String(req.headers.authorization || '');
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  if (!adminToken || !providedToken || providedToken !== adminToken) {
    logWarn('admin_funnel_unauthorized', { requestId: req.requestId });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    logInfo('admin_funnel_requested', { requestId: req.requestId });
    return res.json(await getFunnelStats());
  } catch (err) {
    logError('admin_funnel_failed', { requestId: req.requestId, error: err });
    return res.status(500).json({ error: err.message || 'Failed to load funnel stats' });
  }
});

app.get('/api/scout-runs/:runId/events', (req, res) => {
  const ip = getClientIp(req);
  const currentConnections = sseConnections.get(ip);
  if (currentConnections && currentConnections.size >= MAX_SSE_CONNECTIONS_PER_IP) {
    logWarn('sse_connection_rejected', { requestId: req.requestId, runId: req.params.runId, reason: 'too_many_connections', ip });
    return res.status(429).json({
      error: `Too many open scout event streams from this IP. SSE connections are limited to ${MAX_SSE_CONNECTIONS_PER_IP} concurrent connections.`,
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  let cleanedUp = false;
  let unsubscribe = () => {};
  const connection = {};
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(heartbeat);
    clearTimeout(connectionTimeout);
    unsubscribe();
    releaseSseConnection(ip, connection);
    if (!res.writableEnded) {
      res.end();
    }
    logInfo('sse_connection_closed', { requestId: req.requestId, runId: req.params.runId, ip });
  };
  const send = ({ type, payload }) => {
    if (cleanedUp || res.writableEnded) return;
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (type === 'complete' || type === 'error' || type === 'stream_error') {
      cleanup();
    }
  };

  res.write(`event: connected\n`);
  res.write(`data: ${JSON.stringify({ runId: req.params.runId })}\n\n`);

  unsubscribe = subscribeScoutRun(req.params.runId, send);
  const heartbeat = setInterval(() => {
    res.write(`event: heartbeat\n`);
    res.write(`data: {}\n\n`);
  }, 15000);
  const connectionTimeout = setTimeout(() => {
    send({
      type: 'stream_error',
      payload: { error: `Scout event stream closed after ${Math.round(SSE_CONNECTION_TTL_MS / 60000)} minutes. Reconnect to continue receiving updates.` },
    });
    cleanup();
  }, SSE_CONNECTION_TTL_MS);
  trackSseConnection(ip, connection);
  logInfo('sse_connection_opened', { requestId: req.requestId, runId: req.params.runId, ip });

  req.on('close', () => {
    cleanup();
  });
});

// --- Health check ---
app.get('/api/health', (_, res) => res.json({ ok: true }));

app.get('/runtime-config.js', (_, res) => {
  res.type('application/javascript').send(`window.HIRENEAR_CONFIG=${JSON.stringify({
    mapboxToken: MAPBOX_TOKEN || '',
  })};`);
});

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(publicDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
migrate()
  .then(async () => {
    try {
      await cleanupStaleScoutRuns();
    } catch (err) {
      logError('startup_scout_cleanup_failed', { error: err });
    }
    app.listen(PORT, () => logInfo('server_started', { port: PORT }));
  })
  .catch(err => {
    logError('database_migration_failed', { error: err });
    process.exit(1);
  });
