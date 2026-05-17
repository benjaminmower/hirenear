import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { discoverResumeMatchedPlaces, resolveLocationLabel, searchJobsForCompany } from './geoSearch.js';
import { query } from './db.js';
import { inspectWebsite, normalizeDomain } from './websiteInspector.js';
import { matchScoutRunBatch, extractResumeSignals } from './resumeMatcher.js';
import { notifyBusinessIfQualified } from './notifier.js';

const events = new Map();
const CONCURRENCY = Number(process.env.SCOUT_INSPECTION_CONCURRENCY || 2);
const TTL_HOURS = Number(process.env.SCOUT_INSPECTION_TTL_HOURS || 48);

function emitterFor(runId) {
  if (!events.has(runId)) events.set(runId, new EventEmitter());
  return events.get(runId);
}

function emitRun(runId, type, payload) {
  emitterFor(runId).emit('event', { type, payload });
}

function businessRowToClient(row) {
  return {
    id: row.id,
    placeId: row.place_id,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    vicinity: row.vicinity,
    rating: row.rating,
    userRatingsTotal: row.user_ratings_total,
    website: row.website,
    inspectionStatus: row.inspection_status,
    signalStrength: row.signal_strength,
    signalSummary: row.signal_summary,
    fitScore: row.fit_score,
    fitReason: row.fit_reason,
    nextStep: row.next_step,
    discoverySource: row.discovery_source,
    discoveryQuery: row.discovery_query,
    discoveryScore: row.discovery_score,
    contactEmail: row.contact_email,
    evidence: row.evidence || [],
  };
}

function opportunityRowToClient(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    source: row.source,
    kind: row.kind,
    title: row.title,
    url: row.url,
    description: row.description,
    signalStrength: row.signal_strength,
  };
}

function matchRowToClient(row) {
  return {
    id: row.id,
    businessId: row.business_id,
    opportunityId: row.opportunity_id,
    scope: row.scope,
    matchLevel: row.match_level,
    fitScore: row.fit_score,
    reason: row.reason,
    nextStep: row.next_step,
  };
}

export async function createScoutRun({ resumeText, lat, lng, radius, locationLabel, targetLanes = [], avoidTerms = '' }) {
  const runId = randomUUID();
  let extractedSignals = null;
  const resolvedLocationLabel = await resolveLocationLabel(lat, lng, locationLabel);

  try {
    extractedSignals = await extractResumeSignals(resumeText, targetLanes);
  } catch (err) {
    console.error('[createScoutRun] extraction failed:', err.message);
  }

  await query(
    `INSERT INTO scout_runs (id, resume_text, lat, lng, radius, location_label, target_lanes, avoid_terms, extracted_signals, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued')`,
    [
      runId,
      resumeText,
      lat,
      lng,
      radius,
      resolvedLocationLabel || null,
      JSON.stringify(targetLanes),
      avoidTerms || null,
      extractedSignals ? JSON.stringify(extractedSignals) : null,
    ]
  );
  return runId;
}

export function subscribeScoutRun(runId, onEvent) {
  const emitter = emitterFor(runId);
  emitter.on('event', onEvent);
  return () => emitter.off('event', onEvent);
}

export async function getScoutRun(runId) {
  const runResult = await query('SELECT * FROM scout_runs WHERE id = $1', [runId]);
  if (runResult.rowCount === 0) return null;

  const [businesses, opportunities, matches] = await Promise.all([
    query('SELECT * FROM scout_businesses WHERE run_id = $1 ORDER BY COALESCE(fit_score, 0) DESC, COALESCE(discovery_score, 0) DESC, created_at ASC', [runId]),
    query('SELECT * FROM scout_opportunities WHERE run_id = $1 ORDER BY created_at ASC', [runId]),
    query('SELECT * FROM scout_matches WHERE run_id = $1 ORDER BY created_at ASC', [runId]),
  ]);

  return {
    run: {
      id: runResult.rows[0].id,
      status: runResult.rows[0].status,
      resumeText: runResult.rows[0].resume_text,
      lat: runResult.rows[0].lat,
      lng: runResult.rows[0].lng,
      radius: runResult.rows[0].radius,
      locationLabel: runResult.rows[0].location_label,
      targetLanes: runResult.rows[0].target_lanes || [],
      avoidTerms: runResult.rows[0].avoid_terms || '',
      summary: runResult.rows[0].summary,
      error: runResult.rows[0].error,
    },
    businesses: businesses.rows.map(businessRowToClient),
    opportunities: opportunities.rows.map(opportunityRowToClient),
    matches: matches.rows.map(matchRowToClient),
  };
}

export async function deleteScoutRun(runId) {
  const result = await query('DELETE FROM scout_runs WHERE id = $1 RETURNING id', [runId]);
  return result.rowCount > 0;
}

async function getFreshInspection(cacheKey) {
  const result = await query(
    `SELECT * FROM business_inspections
     WHERE cache_key = $1 AND inspected_at > now() - ($2::text || ' hours')::interval`,
    [cacheKey, TTL_HOURS]
  );
  return result.rows[0] || null;
}

async function saveInspection(cacheKey, placeId, website, inspection) {
  await query(
    `INSERT INTO business_inspections
      (cache_key, place_id, domain, website, status, signal_strength, signal_summary, evidence, opportunities, error, inspected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())
     ON CONFLICT (cache_key) DO UPDATE SET
      place_id = EXCLUDED.place_id,
      domain = EXCLUDED.domain,
      website = EXCLUDED.website,
      status = EXCLUDED.status,
      signal_strength = EXCLUDED.signal_strength,
      signal_summary = EXCLUDED.signal_summary,
      evidence = EXCLUDED.evidence,
      opportunities = EXCLUDED.opportunities,
      error = EXCLUDED.error,
      inspected_at = now()`,
    [
      cacheKey,
      placeId,
      normalizeDomain(website),
      website,
      inspection.status,
      inspection.signalStrength,
      inspection.signalSummary,
      JSON.stringify(inspection.evidence || []),
      JSON.stringify(inspection.opportunities || []),
      inspection.error || null,
    ]
  );
}

async function insertOpportunity(runId, businessId, opportunity) {
  const id = randomUUID();
  const result = await query(
    `INSERT INTO scout_opportunities
      (id, run_id, business_id, source, kind, title, url, description, signal_strength)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING *`,
    [
      id,
      runId,
      businessId,
      opportunity.source || 'website',
      opportunity.kind || 'opening',
      opportunity.title || 'Hiring opportunity',
      opportunity.url || null,
      opportunity.description || null,
      opportunity.signalStrength || 'weak',
    ]
  );
  return result.rows[0];
}

async function insertMatch({ runId, businessId, opportunityId = null, scope, match }) {
  const result = await query(
    `INSERT INTO scout_matches
      (id, run_id, business_id, opportunity_id, scope, match_level, fit_score, reason, next_step, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      randomUUID(),
      runId,
      businessId,
      opportunityId,
      scope,
      match.matchLevel,
      match.fitScore,
      match.reason,
      match.nextStep,
      JSON.stringify(match.raw || {}),
    ]
  );
  return result.rows[0];
}

async function runWithConcurrency(items, limit, worker) {
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index];
      index += 1;
      await worker(item);
    }
  });
  await Promise.all(workers);
}

async function searchFallbackOpportunities(business, cache, run) {
  const extractedTitles = run.extracted_signals?.jobSearchTitles && run.extracted_signals.jobSearchTitles.length > 0
    ? run.extracted_signals.jobSearchTitles
    : run.extracted_signals?.jobTitles && run.extracted_signals.jobTitles.length > 0
    ? run.extracted_signals.jobTitles
    : run.target_lanes || [];

  const jobs = await searchJobsForCompany(
    business.name,
    cache,
    run.location_label || 'Salt Lake City, UT',
    extractedTitles,
    run.avoid_terms || '',
    { fromExtraction: !!(run.extracted_signals?.jobSearchTitles || run.extracted_signals?.jobTitles) }
  );
  if (!Array.isArray(jobs)) return [];
  return jobs.slice(0, 5).map(job => ({
    source: 'searchapi',
    kind: 'opening',
    title: job.title,
    url: job.applyLink,
    description: job.location || job.via || null,
    signalStrength: 'strong',
  }));
}

async function inspectBusiness({ run, business, cache }) {
  emitRun(run.id, 'business_update', { business: { ...businessRowToClient(business), inspectionStatus: 'checking' } });
  await query(
    `UPDATE scout_businesses SET inspection_status = 'checking', updated_at = now() WHERE id = $1`,
    [business.id]
  );

  const domain = normalizeDomain(business.website);
  const cacheKey = domain ? `domain:${domain}` : `place:${business.place_id}`;
  let inspection;
  const cached = await getFreshInspection(cacheKey);
  if (cached) {
    inspection = {
      status: cached.status,
      signalStrength: cached.signal_strength,
      signalSummary: cached.signal_summary,
      evidence: cached.evidence || [],
      opportunities: cached.opportunities || [],
      error: cached.error,
    };
  } else {
    inspection = await inspectWebsite(business.website);
    await saveInspection(cacheKey, business.place_id, business.website, inspection);
  }

  let opportunities = [...(inspection.opportunities || [])];
  if (inspection.signalStrength !== 'strong') {
    const fallback = await searchFallbackOpportunities(business, cache, run);
    opportunities = opportunities.concat(fallback);
    if (fallback.length > 0 && inspection.signalStrength !== 'strong') {
      inspection.signalStrength = 'strong';
      inspection.signalSummary = `${fallback.length} job result${fallback.length === 1 ? '' : 's'} found via SearchAPI fallback`;
    }
  }

  for (const opportunity of opportunities) {
    const row = await insertOpportunity(run.id, business.id, opportunity);
    emitRun(run.id, 'opportunity_found', { opportunity: opportunityRowToClient(row) });
  }

  await query(
    `UPDATE scout_businesses
     SET inspection_status = $2, signal_strength = $3, signal_summary = $4, evidence = $5,
         contact_email = $6, updated_at = now()
      WHERE id = $1`,
    [
      business.id,
      inspection.status,
      inspection.signalStrength,
      inspection.signalSummary,
      JSON.stringify(inspection.evidence || []),
      inspection.contactEmail || null,
    ]
  );

  const updatedBusiness = await query('SELECT * FROM scout_businesses WHERE id = $1', [business.id]);
  emitRun(run.id, 'business_update', { business: businessRowToClient(updatedBusiness.rows[0]) });
}

async function applyBatchMatches(run, businesses, opportunities) {
  const batch = await matchScoutRunBatch({
    resumeText: run.resume_text,
    targetLanes: run.target_lanes || [],
    avoidTerms: run.avoid_terms || '',
    businesses: businesses.map(businessRowToClient),
    opportunities: opportunities.map(opportunityRowToClient),
  });

  for (const match of batch.businessMatches) {
    const row = await insertMatch({
      runId: run.id,
      businessId: match.businessId,
      scope: 'business',
      match,
    });

    await query(
      `UPDATE scout_businesses
       SET fit_score = $2, fit_reason = $3, next_step = $4, updated_at = now()
       WHERE id = $1`,
      [match.businessId, match.fitScore, match.reason, match.nextStep]
    );

    const updatedBusiness = await query('SELECT * FROM scout_businesses WHERE id = $1', [match.businessId]);
    const updatedBusinessRow = updatedBusiness.rows[0];
    if (!updatedBusinessRow) {
      console.warn(`[applyBatchMatches] missing business row for id ${match.businessId}`);
      continue;
    }
    notifyBusinessIfQualified(updatedBusinessRow);
    emitRun(run.id, 'business_update', { business: businessRowToClient(updatedBusinessRow) });
    emitRun(run.id, 'match_update', { match: matchRowToClient(row) });
  }

  for (const match of batch.opportunityMatches) {
    const row = await insertMatch({
      runId: run.id,
      businessId: match.businessId,
      opportunityId: match.opportunityId,
      scope: 'opportunity',
      match,
    });
    emitRun(run.id, 'match_update', { match: matchRowToClient(row) });
  }

  return batch.summary;
}

// Phase 1: discover resume-matched businesses and queue them. Website inspection is still user-driven.
export async function runScout(runId, cache) {
  try {
    const runResult = await query('SELECT * FROM scout_runs WHERE id = $1', [runId]);
    const run = runResult.rows[0];
    if (!run) return;

    await query(`UPDATE scout_runs SET status = 'running', updated_at = now() WHERE id = $1`, [runId]);
    const locationLabel = await resolveLocationLabel(run.lat, run.lng, run.location_label);
    if (locationLabel !== run.location_label) {
      run.location_label = locationLabel;
      await query(`UPDATE scout_runs SET location_label = $2, updated_at = now() WHERE id = $1`, [runId, locationLabel]);
    }

    const places = await discoverResumeMatchedPlaces({
      lat: run.lat,
      lng: run.lng,
      radius: run.radius,
      locationLabel,
      signals: run.extracted_signals || {},
      cache,
    });

    for (const place of places) {
      const id = randomUUID();
      const row = await query(
        `INSERT INTO scout_businesses
          (id, run_id, place_id, name, lat, lng, vicinity, rating, user_ratings_total, website,
           signal_strength, signal_summary, discovery_source, discovery_query, discovery_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (run_id, place_id) DO UPDATE SET
           signal_strength = CASE
             WHEN EXCLUDED.signal_strength = 'strong' THEN EXCLUDED.signal_strength
             ELSE scout_businesses.signal_strength
           END,
           signal_summary = COALESCE(EXCLUDED.signal_summary, scout_businesses.signal_summary),
           discovery_source = EXCLUDED.discovery_source,
           discovery_query = EXCLUDED.discovery_query,
           discovery_score = EXCLUDED.discovery_score,
           updated_at = now()
         RETURNING *`,
        [
          id,
          runId,
          place.place_id,
          place.name,
          place.geometry.location.lat,
          place.geometry.location.lng,
          place.vicinity || null,
          place.rating,
          place.user_ratings_total || 0,
          place.websiteUri || null,
          (place.initialOpportunities || []).length > 0 ? 'strong' : 'queued',
          (place.initialOpportunities || []).length > 0
            ? `${place.initialOpportunities.length} resume-matched job posting${place.initialOpportunities.length === 1 ? '' : 's'} found during discovery`
            : null,
          place.discoverySource || null,
          place.discoveryQuery || null,
          place.discoveryScore || null,
        ]
      );
      const business = row.rows[0];
      for (const opportunity of (place.initialOpportunities || [])) {
        const opportunityRow = await insertOpportunity(runId, business.id, opportunity);
        emitRun(runId, 'opportunity_found', { opportunity: opportunityRowToClient(opportunityRow) });
      }
      emitRun(runId, 'business_queued', { business: businessRowToClient(business) });
    }
    // Businesses are now queued; the user drives website inspection via visitBusiness().
  } catch (err) {
    console.error('Scout run error:', err);
    await query(
      `UPDATE scout_runs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
      [runId, err.message]
    ).catch(() => {});
    emitRun(runId, 'error', { error: err.message });
  }
}

// Phase 2a: user clicked Visit — inspect this business then match resume
export async function visitBusiness(runId, placeId, cache) {
  try {
    const runResult = await query('SELECT * FROM scout_runs WHERE id = $1', [runId]);
    const run = runResult.rows[0];
    if (!run) return;

    const bizResult = await query(
      'SELECT * FROM scout_businesses WHERE run_id = $1 AND place_id = $2',
      [runId, placeId]
    );
    const business = bizResult.rows[0];
    if (!business) return;

    await inspectBusiness({ run, business, cache });

    // Match resume against this single business immediately after inspection
    const [updatedBiz, allOpportunities] = await Promise.all([
      query('SELECT * FROM scout_businesses WHERE id = $1', [business.id]),
      query('SELECT * FROM scout_opportunities WHERE business_id = $1', [business.id]),
    ]);

    const batch = await applyBatchMatches(run, updatedBiz.rows, allOpportunities.rows);

    // Check if all visited businesses are done, emit complete if so
    await maybeComplete(run);
  } catch (err) {
    console.error('visitBusiness error:', err);
  }
}

// Phase 2b: user clicked Skip — mark skipped, no inspection
export async function skipBusiness(runId, placeId) {
  try {
    await query(
      `UPDATE scout_businesses SET inspection_status = 'skipped', signal_strength = 'none', updated_at = now()
       WHERE run_id = $1 AND place_id = $2`,
      [runId, placeId]
    );
    const bizResult = await query(
      'SELECT * FROM scout_businesses WHERE run_id = $1 AND place_id = $2',
      [runId, placeId]
    );
    if (bizResult.rows[0]) {
      emitRun(runId, 'business_update', { business: businessRowToClient(bizResult.rows[0]) });
    }
    // Check if all businesses are now decided
    const runResult = await query('SELECT * FROM scout_runs WHERE id = $1', [runId]);
    await maybeComplete(runResult.rows[0]);
  } catch (err) {
    console.error('skipBusiness error:', err);
  }
}

// Emit complete when every business has been visited or skipped
async function maybeComplete(run) {
  const remaining = await query(
    `SELECT COUNT(*) FROM scout_businesses WHERE run_id = $1 AND inspection_status = 'queued'`,
    [run.id]
  );
  if (Number(remaining.rows[0].count) > 0) return;

  const [finalBusinesses, finalOpportunities] = await Promise.all([
    query(`SELECT * FROM scout_businesses WHERE run_id = $1 AND inspection_status != 'skipped'`, [run.id]),
    query('SELECT * FROM scout_opportunities WHERE run_id = $1', [run.id]),
  ]);

  const summary = finalBusinesses.rows.length > 0
    ? await applyBatchMatches(run, finalBusinesses.rows, finalOpportunities.rows)
    : 'Scout complete. No businesses were visited.';

  await query(
    `UPDATE scout_runs SET status = 'complete', summary = $2, completed_at = now(), updated_at = now() WHERE id = $1`,
    [run.id, summary]
  );
  emitRun(run.id, 'complete', { summary });
}
