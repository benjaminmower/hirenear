import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { discoverResumeMatchedPlaces, resolveLocationLabel, searchJobsForCompany } from './geoSearch.js';
import { getErrorMessage } from './limits.js';
import { query } from './db.js';
import { closeRunInspectionSessions, inspectWebsite, normalizeDomain } from './websiteInspector.js';
import { matchScoutRunBatch, extractResumeSignals } from './resumeMatcher.js';
import { notifyBusinessIfQualified } from './notifier.js';
import { logError, logInfo, logWarn } from './logger.js';

const events = new Map();
const CONCURRENCY = Number(process.env.SCOUT_INSPECTION_CONCURRENCY || 2);
const TTL_HOURS = Number(process.env.SCOUT_INSPECTION_TTL_HOURS || 48);
const STALE_RUNNING_RUN_MINUTES = 15;

function emitterFor(runId) {
  if (!events.has(runId)) events.set(runId, new EventEmitter());
  return events.get(runId);
}

function emitRun(runId, type, payload) {
  emitterFor(runId).emit('event', { type, payload });
}

function emitStep(runId, step) {
  emitRun(runId, 'inspection_step', { step });
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
    userRatingCount: row.user_ratings_total,
    primaryTypeDisplayName: row.primary_type_display_name,
    businessStatus: row.business_status,
    googleMapsUri: row.google_maps_uri,
    weekdayDescriptions: row.weekday_descriptions || [],
    website: row.website,
    inspectionStatus: row.inspection_status,
    signalStrength: row.signal_strength,
    signalSummary: row.signal_summary,
    companyProfile: row.company_profile || null,
    homepageExcerpt: row.homepage_excerpt || row.homepageExcerpt || null,
    aboutExcerpt: row.about_excerpt || row.aboutExcerpt || null,
    fitScore: row.fit_score,
    matchSummary: row.match_summary,
    matchSignals: row.match_signals || [],
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
  logInfo('scout_run_persist_started', {
    runId,
    lat,
    lng,
    radius,
    locationLabel: resolvedLocationLabel,
    targetLanes,
    avoidTermsPresent: Boolean(avoidTerms),
  });

  try {
    extractedSignals = await extractResumeSignals(resumeText, targetLanes);
    logInfo('resume_signal_extraction_completed', {
      runId,
      jobSearchTitleCount: extractedSignals?.jobSearchTitles?.length || 0,
      employerSearchQueryCount: extractedSignals?.employerSearchQueries?.length || 0,
      preferredIndustryCount: extractedSignals?.preferredIndustries?.length || 0,
      negativeBusinessTypeCount: extractedSignals?.negativeBusinessTypes?.length || 0,
    });
  } catch (err) {
    logError('resume_signal_extraction_failed', { runId, error: err });
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
  logInfo('scout_run_persist_completed', { runId });
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
  await closeRunInspectionSessions(runId);
  const result = await query('DELETE FROM scout_runs WHERE id = $1 RETURNING id', [runId]);
  return result.rowCount > 0;
}

export async function cleanupStaleScoutRuns() {
  const result = await query(
    `UPDATE scout_runs
     SET status = 'failed',
         error = $2,
         completed_at = COALESCE(completed_at, now()),
         updated_at = now()
     WHERE status = 'running'
       AND updated_at < now() - ($1::text || ' minutes')::interval
     RETURNING id`,
    [STALE_RUNNING_RUN_MINUTES, `Scout run expired after ${STALE_RUNNING_RUN_MINUTES} minutes without completing. Please start a new run.`]
  );

  const runIds = result.rows.map(row => row.id);
  if (runIds.length === 0) return 0;
  logWarn('stale_scout_runs_marked_failed', { count: runIds.length, runIds });

  await query(
    `UPDATE scout_businesses
     SET inspection_status = 'failed',
         updated_at = now()
     WHERE run_id = ANY($1::text[])
       AND inspection_status IN ('queued', 'checking')`,
    [runIds]
  );

  await Promise.all(runIds.map(runId => closeRunInspectionSessions(runId)));
  return runIds.length;
}

async function getFreshInspection(cacheKey) {
  const result = await query(
    `SELECT * FROM business_inspections
     WHERE cache_key = $1
       AND inspected_at > now() - ($2::text || ' hours')::interval
     ORDER BY inspected_at DESC
     LIMIT 1`,
    [cacheKey, TTL_HOURS]
  );
  return result.rows[0] || null;
}

async function saveInspection(runId, cacheKey, placeId, website, inspection) {
  await query(
    `INSERT INTO business_inspections
      (cache_key, place_id, run_id, domain, website, status, signal_strength, signal_summary, evidence, opportunities, company_profile, contact_email, error, inspected_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now())`,
    [
      cacheKey,
      placeId,
      runId,
      normalizeDomain(website),
      website,
      inspection.status,
      inspection.signalStrength,
      inspection.signalSummary,
      JSON.stringify(inspection.evidence || []),
      JSON.stringify(inspection.opportunities || []),
      inspection.companyProfile ? JSON.stringify(inspection.companyProfile) : null,
      inspection.contactEmail || null,
      inspection.error || null,
    ]
  );
  logInfo('business_inspection_recorded', {
    runId,
    cacheKey,
    placeId,
    websitePresent: Boolean(website),
    status: inspection.status,
    signalStrength: inspection.signalStrength,
    opportunityCount: inspection.opportunities?.length || 0,
    evidenceCount: inspection.evidence?.length || 0,
    contactEmailFound: Boolean(inspection.contactEmail),
  });
}

async function persistCompanyProfile({ runId, business, companyProfile }) {
  if (!companyProfile) return;
  const website = business.website;
  const domain = normalizeDomain(website);
  const cacheKey = domain ? `domain:${domain}` : `place:${business.place_id || business.placeId}`;
  await query(
    `UPDATE business_inspections
     SET company_profile = $2
     WHERE id = (
       SELECT id FROM business_inspections
       WHERE cache_key = $1
       ORDER BY inspected_at DESC
       LIMIT 1
     )`,
    [cacheKey, JSON.stringify(companyProfile)]
  );
  logInfo('company_profile_recorded', {
    runId,
    businessId: business.id,
    cacheKey,
    hasBlurb: Boolean(companyProfile.blurb),
  });
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
  logInfo('opportunity_inserted', {
    runId,
    businessId,
    source: opportunity.source || 'website',
    kind: opportunity.kind || 'opening',
    signalStrength: opportunity.signalStrength || 'weak',
    hasUrl: Boolean(opportunity.url),
  });
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
  const startedAt = Date.now();
  logInfo('business_inspection_started', {
    runId: run.id,
    businessId: business.id,
    placeId: business.place_id,
    businessName: business.name,
    websitePresent: Boolean(business.website),
  });
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
    logInfo('business_inspection_cache_hit', { runId: run.id, businessId: business.id, cacheKey });
    emitStep(run.id, 'Loaded from cache');
    inspection = {
      status: cached.status,
      signalStrength: cached.signal_strength,
      signalSummary: cached.signal_summary,
      evidence: cached.evidence || [],
      opportunities: cached.opportunities || [],
      companyProfile: cached.company_profile || null,
      contactEmail: cached.contact_email || null,
      error: cached.error,
    };
  } else {
    logInfo('business_inspection_cache_miss', { runId: run.id, businessId: business.id, cacheKey });
    emitStep(run.id, 'Loading website...');
    inspection = await inspectWebsite(business.website, { runId: run.id, emitStep: (step) => emitStep(run.id, step) });
    emitStep(run.id, 'Scanning for hiring signals...');
    await saveInspection(run.id, cacheKey, business.place_id, business.website, inspection);
  }

  let opportunities = [...(inspection.opportunities || [])];
  if (inspection.signalStrength !== 'strong') {
    emitStep(run.id, 'Searching for job listings...');
    const fallback = await searchFallbackOpportunities(business, cache, run);
    logInfo('business_fallback_search_completed', {
      runId: run.id,
      businessId: business.id,
      fallbackOpportunityCount: fallback.length,
    });
    opportunities = opportunities.concat(fallback);
    if (fallback.length > 0 && inspection.signalStrength !== 'strong') {
      inspection.signalStrength = 'strong';
      inspection.signalSummary = `${fallback.length} job result${fallback.length === 1 ? '' : 's'} found via SearchAPI fallback`;
    }
  }

  emitStep(run.id, 'Processing findings...');
  for (const opportunity of opportunities) {
    const row = await insertOpportunity(run.id, business.id, opportunity);
    emitRun(run.id, 'opportunity_found', { opportunity: opportunityRowToClient(row) });
  }

  await query(
    `UPDATE scout_businesses
     SET inspection_status = $2, signal_strength = $3, signal_summary = $4, evidence = $5,
         contact_email = $6, company_profile = COALESCE($7, company_profile), updated_at = now()
     WHERE id = $1`,
    [
      business.id,
      inspection.status,
      inspection.signalStrength,
      inspection.signalSummary,
      JSON.stringify(inspection.evidence || []),
      inspection.contactEmail || null,
      inspection.companyProfile ? JSON.stringify(inspection.companyProfile) : null,
    ]
  );

  const updatedBusiness = await query('SELECT * FROM scout_businesses WHERE id = $1', [business.id]);
  emitStep(run.id, 'Analyzing fit with resume...');
  logInfo('business_inspection_completed', {
    runId: run.id,
    businessId: business.id,
    placeId: business.place_id,
    status: inspection.status,
    signalStrength: inspection.signalStrength,
    opportunityCount: opportunities.length,
    evidenceCount: inspection.evidence?.length || 0,
    contactEmailFound: Boolean(inspection.contactEmail),
    durationMs: Date.now() - startedAt,
  });
  emitRun(run.id, 'business_update', { business: businessRowToClient(updatedBusiness.rows[0]) });
  return inspection;
}

async function applyBatchMatches(run, businesses, opportunities) {
  const startedAt = Date.now();
  logInfo('batch_match_started', {
    runId: run.id,
    businessCount: businesses.length,
    opportunityCount: opportunities.length,
  });
  const batch = await matchScoutRunBatch({
    resumeText: run.resume_text,
    targetLanes: run.target_lanes || [],
    avoidTerms: run.avoid_terms || '',
    businesses: businesses.map(businessRowToClient),
    opportunities: opportunities.map(opportunityRowToClient),
  });

  const businessById = new Map(businesses.map(business => [business.id, business]));
  for (const match of batch.businessMatches) {
    const row = await insertMatch({
      runId: run.id,
      businessId: match.businessId,
      scope: 'business',
      match,
    });

    const updateResult = await query(
      `UPDATE scout_businesses
       SET fit_score = $2, fit_reason = $3, next_step = $4, match_summary = $5, match_signals = $6,
           company_profile = COALESCE($7, company_profile), updated_at = now()
       WHERE id = $1
         AND (fit_score IS NULL OR $2 >= fit_score)
       RETURNING *`,
      [
        match.businessId,
        match.fitScore,
        match.reason,
        match.nextStep,
        match.matchSummary || null,
        JSON.stringify(match.matchSignals || []),
        match.companyProfile ? JSON.stringify(match.companyProfile) : null,
      ]
    );

    let updatedBusinessRow = updateResult.rows[0] || (await query('SELECT * FROM scout_businesses WHERE id = $1', [match.businessId])).rows[0];
    if (!updatedBusinessRow) {
      logWarn('batch_match_missing_business_row', { runId: run.id, businessId: match.businessId });
      continue;
    }
    if (updateResult.rowCount === 0) {
      logInfo('business_match_downgrade_ignored', {
        runId: run.id,
        businessId: match.businessId,
        existingFitScore: updatedBusinessRow.fit_score,
        attemptedFitScore: match.fitScore,
        matchLevel: match.matchLevel,
      });
    }
    if (match.companyProfile) {
      if (!updatedBusinessRow.company_profile) {
        const profileUpdate = await query(
          `UPDATE scout_businesses
           SET company_profile = $2, updated_at = now()
           WHERE id = $1
           RETURNING *`,
          [match.businessId, JSON.stringify(match.companyProfile)]
        );
        updatedBusinessRow = profileUpdate.rows[0] || updatedBusinessRow;
      }
      await persistCompanyProfile({
        runId: run.id,
        business: businessById.get(match.businessId) || updatedBusinessRow,
        companyProfile: match.companyProfile,
      });
    }
    notifyBusinessIfQualified(updatedBusinessRow).catch(err => {
      logError('qualified_business_notification_unhandled', { runId: run.id, businessId: match.businessId, error: err });
    });
    logInfo('business_match_applied', {
      runId: run.id,
      businessId: match.businessId,
      fitScore: match.fitScore,
      matchLevel: match.matchLevel,
      signalCount: match.matchSignals?.length || 0,
      hasSummary: Boolean(match.matchSummary),
    });
    emitRun(run.id, 'business_update', { business: businessRowToClient(updatedBusinessRow) });
    emitRun(run.id, 'match_update', {
      match: matchRowToClient(row),
      business: businessRowToClient(updatedBusinessRow),
      companyProfile: updatedBusinessRow.company_profile || match.companyProfile || null,
    });
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

  logInfo('batch_match_completed', {
    runId: run.id,
    businessMatchCount: batch.businessMatches.length,
    opportunityMatchCount: batch.opportunityMatches.length,
    durationMs: Date.now() - startedAt,
  });
  return batch.summary;
}

// Phase 1: discover resume-matched businesses and queue them. Website inspection is still user-driven.
export async function runScout(runId, cache) {
  const startedAt = Date.now();
  try {
    logInfo('scout_discovery_started', { runId });
    const runResult = await query('SELECT * FROM scout_runs WHERE id = $1', [runId]);
    const run = runResult.rows[0];
    if (!run) {
      logWarn('scout_discovery_aborted', { runId, reason: 'run_not_found' });
      return;
    }

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
    logInfo('scout_discovery_places_found', { runId, count: places.length, locationLabel });

    for (const place of places) {
      const id = randomUUID();
      const row = await query(
        `INSERT INTO scout_businesses
          (id, run_id, place_id, name, lat, lng, vicinity, rating, user_ratings_total,
           primary_type_display_name, business_status, google_maps_uri, weekday_descriptions, website,
           signal_strength, signal_summary, discovery_source, discovery_query, discovery_score)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         ON CONFLICT (run_id, place_id) DO UPDATE SET
           rating = EXCLUDED.rating,
           user_ratings_total = EXCLUDED.user_ratings_total,
           primary_type_display_name = EXCLUDED.primary_type_display_name,
           business_status = EXCLUDED.business_status,
           google_maps_uri = EXCLUDED.google_maps_uri,
           weekday_descriptions = EXCLUDED.weekday_descriptions,
           website = COALESCE(EXCLUDED.website, scout_businesses.website),
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
          place.primaryTypeDisplayName || null,
          place.businessStatus || null,
          place.googleMapsUri || null,
          JSON.stringify(place.weekdayDescriptions || []),
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
    logInfo('scout_discovery_completed', { runId, queuedBusinessCount: places.length, durationMs: Date.now() - startedAt });
  } catch (err) {
    logError('scout_discovery_failed', { runId, durationMs: Date.now() - startedAt, error: err });
    await closeRunInspectionSessions(runId).catch(() => {});
    await query(
      `UPDATE scout_runs SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
      [runId, getErrorMessage(err)]
    ).catch(() => {});
    emitRun(runId, 'error', { error: getErrorMessage(err) });
  }
}

// Phase 2a: user clicked Visit — inspect this business then match resume
export async function visitBusiness(runId, placeId, cache) {
  const startedAt = Date.now();
  try {
    logInfo('business_visit_started', { runId, placeId });
    const runResult = await query('SELECT * FROM scout_runs WHERE id = $1', [runId]);
    const run = runResult.rows[0];
    if (!run) {
      logWarn('business_visit_aborted', { runId, placeId, reason: 'run_not_found' });
      return;
    }

    const bizResult = await query(
      'SELECT * FROM scout_businesses WHERE run_id = $1 AND place_id = $2',
      [runId, placeId]
    );
    const business = bizResult.rows[0];
    if (!business) {
      logWarn('business_visit_aborted', { runId, placeId, reason: 'business_not_found' });
      return;
    }

    const inspection = await inspectBusiness({ run, business, cache });

    // Match resume against this single business immediately after inspection
    const [updatedBiz, allOpportunities] = await Promise.all([
      query('SELECT * FROM scout_businesses WHERE id = $1', [business.id]),
      query('SELECT * FROM scout_opportunities WHERE business_id = $1', [business.id]),
    ]);

    const businessesForMatch = updatedBiz.rows.map(row => ({
      ...row,
      homepage_excerpt: inspection?.homepageExcerpt || null,
      about_excerpt: inspection?.aboutExcerpt || null,
      company_profile: row.company_profile || inspection?.companyProfile || null,
    }));

    await applyBatchMatches(run, businessesForMatch, allOpportunities.rows);

    // Check if all visited businesses are done, emit complete if so
    await maybeComplete(run);
    logInfo('business_visit_completed', { runId, placeId, businessId: business.id, durationMs: Date.now() - startedAt });
  } catch (err) {
    logError('business_visit_failed', { runId, placeId, durationMs: Date.now() - startedAt, error: err });
  }
}

// Phase 2b: user clicked Skip — mark skipped, no inspection
export async function skipBusiness(runId, placeId) {
  try {
    logInfo('business_skip_started', { runId, placeId });
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
      logInfo('business_skip_completed', { runId, placeId, businessId: bizResult.rows[0].id });
    } else {
      logWarn('business_skip_missing_business', { runId, placeId });
    }
    // Check if all businesses are now decided
    const runResult = await query('SELECT * FROM scout_runs WHERE id = $1', [runId]);
    await maybeComplete(runResult.rows[0]);
  } catch (err) {
    logError('business_skip_failed', { runId, placeId, error: err });
  }
}

// Emit complete when every business has been visited or skipped
async function maybeComplete(run) {
  const remaining = await query(
    `SELECT COUNT(*) FROM scout_businesses WHERE run_id = $1 AND inspection_status = 'queued'`,
    [run.id]
  );
  const remainingCount = Number(remaining.rows[0].count);
  logInfo('scout_completion_checked', { runId: run.id, remainingQueuedBusinesses: remainingCount });
  if (remainingCount > 0) return;

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
  logInfo('scout_completed', {
    runId: run.id,
    visitedBusinessCount: finalBusinesses.rows.length,
    opportunityCount: finalOpportunities.rows.length,
    summaryLength: summary.length,
  });
  emitRun(run.id, 'complete', { summary });
}
