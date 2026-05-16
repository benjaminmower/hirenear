import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import { config } from 'dotenv';
import { createNearbyJobsHandler } from './geoSearch.js';
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
import { migrate } from './db.js';
import { cleanupStaleScoutRuns, createScoutRun, deleteScoutRun, getScoutRun, runScout, visitBusiness, skipBusiness, subscribeScoutRun } from './scoutRunner.js';

config();

const app = express();
const cache = new NodeCache({ stdTTL: 86400 }); // 24 hour cache to respect free tier
const sseConnections = new Map();

app.set('trust proxy', 1);
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '1mb' }));
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

if (!SEARCH_API_KEY || !MAPBOX_TOKEN || !GOOGLE_PLACES_API_KEY) {
  console.warn('⚠️  Missing env vars. Copy .env.example to .env and fill in your keys.');
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
      const res = await fetch(url);
      const data = await res.json();

      if (data.features && data.features.length > 0) {
        const [lng, lat] = data.features[0].center;
        const result = { lat, lng, placeName: data.features[0].place_name };
        cache.set(cacheKey, result);
        return result;
      }
    } catch (err) {
      console.error(`Geocoding error for "${query}":`, getErrorMessage(err));
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

    console.log(`[${query}] SearchAPI response:`, {
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
    console.error('Job search error:', getErrorMessage(err));
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

app.get('/api/nearby-jobs', createNearbyJobsHandler({
  cache,
  mapboxToken: MAPBOX_TOKEN,
}));

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
    return res.status(400).json({ error: 'resumeText is required and must be at least 40 characters' });
  }
  if (Buffer.byteLength(resumeText, 'utf8') > MAX_RESUME_BYTES) {
    return res.status(400).json({ error: 'resumeText must be 15KB or smaller before starting a scout run' });
  }
  if (targetLanes.length === 0) {
    return res.status(400).json({ error: 'Choose at least one kind of work to target' });
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }
  if (!Number.isFinite(radius) || radius < MIN_SCOUT_RADIUS_METERS) {
    return res.status(400).json({ error: `radius must be at least ${MIN_SCOUT_RADIUS_METERS} meters and no more than ${MAX_SCOUT_RADIUS_METERS} meters` });
  }

  try {
    const runId = await createScoutRun({ resumeText, lat, lng, radius, locationLabel, targetLanes, avoidTerms });
    res.status(202).json({ runId });
    runScout(runId, cache);
  } catch (err) {
    console.error('Create scout run error:', getErrorMessage(err));
    res.status(500).json({ error: getErrorMessage(err) || 'Failed to create scout run' });
  }
});

app.get('/api/scout-runs/:runId', async (req, res) => {
  try {
    const run = await getScoutRun(req.params.runId);
    if (!run) return res.status(404).json({ error: 'Scout run not found' });
    res.json(run);
  } catch (err) {
    console.error('Get scout run error:', getErrorMessage(err));
    res.status(500).json({ error: getErrorMessage(err) || 'Failed to load scout run' });
  }
});

app.delete('/api/scout-runs/:runId', async (req, res) => {
  try {
    const deleted = await deleteScoutRun(req.params.runId);
    if (!deleted) return res.status(404).json({ error: 'Scout run not found' });
    res.status(204).end();
  } catch (err) {
    console.error('Delete scout run error:', getErrorMessage(err));
    res.status(500).json({ error: getErrorMessage(err) || 'Failed to delete scout run' });
  }
});

app.post('/api/scout-runs/:runId/visit/:placeId', async (req, res) => {
  try {
    res.status(202).json({ ok: true });
    visitBusiness(req.params.runId, req.params.placeId, cache);
  } catch (err) {
    console.error('Visit business error:', getErrorMessage(err));
    res.status(500).json({ error: getErrorMessage(err) || 'Failed to visit business' });
  }
});

app.post('/api/scout-runs/:runId/skip/:placeId', async (req, res) => {
  try {
    res.status(202).json({ ok: true });
    skipBusiness(req.params.runId, req.params.placeId);
  } catch (err) {
    console.error('Skip business error:', getErrorMessage(err));
    res.status(500).json({ error: getErrorMessage(err) || 'Failed to skip business' });
  }
});

app.get('/api/scout-runs/:runId/events', (req, res) => {
  const ip = getClientIp(req);
  const currentConnections = sseConnections.get(ip);
  if (currentConnections && currentConnections.size >= MAX_SSE_CONNECTIONS_PER_IP) {
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
  };
  const send = ({ type, payload }) => {
    if (cleanedUp || res.writableEnded) return;
    res.write(`event: ${type}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (type === 'complete' || type === 'error') {
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
      type: 'error',
      payload: { error: `Scout event stream closed after ${Math.round(SSE_CONNECTION_TTL_MS / 60000)} minutes. Reconnect to continue receiving updates.` },
    });
  }, SSE_CONNECTION_TTL_MS);
  trackSseConnection(ip, connection);

  req.on('close', () => {
    cleanup();
  });
});

// --- Health check ---
app.get('/api/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
migrate()
  .then(async () => {
    try {
      await cleanupStaleScoutRuns();
    } catch (err) {
      console.error('Startup scout cleanup error:', getErrorMessage(err));
    }
    app.listen(PORT, () => console.log(`🗺️  jobmap server running on http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('Database migration failed:', getErrorMessage(err));
    process.exit(1);
  });
