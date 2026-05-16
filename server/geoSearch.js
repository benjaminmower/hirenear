import { clampScoutRadius, getErrorMessage, MIN_SCOUT_RADIUS_METERS } from './limits.js';

const EXCLUDED_PLACE_TYPES = new Set([
  'atm',
  'bus_station',
  'light_rail_station',
  'parking',
  'subway_station',
  'taxi_stand',
  'train_station',
  'transit_station',
]);

const EXCLUDED_NAME_PATTERNS = [
  /\batm\b/i,
  /\bparking\b/i,
  /\bgarage\b/i,
  /\bbus stop\b/i,
  /\btransit\b/i,
];

const SALT_LAKE_CITY = {
  lat: 40.7608,
  lng: -111.8910,
};

const MAX_PLACES_TO_SHOW = Number(process.env.MAX_PLACES_TO_SHOW || 20);
const MAX_COMPANIES_TO_CHECK = Number(process.env.MAX_COMPANIES_TO_CHECK || MAX_PLACES_TO_SHOW);
const JOB_DISCOVERY_LIMIT = Number(process.env.SCOUT_JOB_DISCOVERY_LIMIT || 12);
const EMPLOYER_DISCOVERY_LIMIT = Number(process.env.SCOUT_EMPLOYER_DISCOVERY_LIMIT || 16);

function normalizeCompanyName(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizePlaceKey(place) {
  if (place.place_id) return `place:${place.place_id}`;
  const name = normalizeCompanyName(place.name || '');
  const location = normalizeCompanyName(place.vicinity || place.formattedAddress || '');
  return `name:${name}:${location}`;
}

function normalizeBusinessKey(name) {
  return normalizeCompanyName(String(name || '').replace(/\b(llc|inc|co|company|corp|corporation)\b\.?/gi, ''));
}

function getCategoryFromTypes(types) {
  if (!Array.isArray(types) || types.length === 0) return null;
  const typeMap = {
    'restaurant': 'Restaurant',
    'cafe': 'Café',
    'bar': 'Bar',
    'hotel': 'Hotel',
    'retail': 'Retail',
    'shopping_mall': 'Shopping',
    'grocery_or_supermarket': 'Grocery',
    'pharmacy': 'Pharmacy',
    'hospital': 'Hospital',
    'clinic': 'Clinic',
    'doctor': 'Medical',
    'dentist': 'Dentist',
    'bank': 'Bank',
    'library': 'Library',
    'school': 'School',
    'university': 'University',
    'gym': 'Gym',
    'park': 'Park',
    'office': 'Office',
    'corporate_office': 'Corporate Office',
    'headquarters': 'Headquarters',
    'beauty_salon': 'Salon',
    'hair_care': 'Hair Care',
    'spa': 'Spa',
    'museum': 'Museum',
    'art_gallery': 'Gallery',
    'night_club': 'Night Club',
    'bakery': 'Bakery',
  };
  for (const type of types) {
    if (typeMap[type]) return typeMap[type];
  }
  return null;
}

function mapSearchApiJob(job, companyName) {
  return {
    id: job.snake_up_apply_id || `${job.company_name || companyName}-${job.title}-${job.location || ''}`,
    title: job.title,
    company: job.company_name || companyName,
    location: job.location ?? null,
    via: job.via ?? null,
    description: job.description ?? null,
    salary: job.salary_range ?? null,
    workType: job.work_from_home ? 'Remote' : 'On-site',
    postedAt: job.posted_at ?? null,
    applyLink: job.apply_link ?? null,
  };
}

function mapPlaceResult(p) {
  return {
    place_id: p.id,
    name: p.displayName?.text || '',
    geometry: p.location ? { location: { lat: p.location.latitude, lng: p.location.longitude } } : null,
    vicinity: p.formattedAddress || '',
    types: p.types || [],
    rating: p.rating ?? null,
    user_ratings_total: p.userRatingCount ?? 0,
    websiteUri: p.websiteUri ?? null,
  };
}

export async function fetchNearbyPlaces(lat, lng, radius) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error('GOOGLE_PLACES_API_KEY is not configured');
  }

  const body = {
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radius,
      },
    },
  };

  const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.types,places.rating,places.userRatingCount,places.websiteUri',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to fetch nearby places');
  }

  // Normalize new API shape to match what filterAndRankPlaces expects
  return (data.places || []).map(mapPlaceResult);
}

export function filterAndRankPlaces(places, limit = MAX_PLACES_TO_SHOW) {
  return places
    .filter(place => {
      const types = place.types || [];
      const name = place.name || '';
      if (!place.place_id || !place.geometry?.location || !name) return false;
      if (types.some(type => EXCLUDED_PLACE_TYPES.has(type))) return false;
      if (EXCLUDED_NAME_PATTERNS.some(pattern => pattern.test(name))) return false;
      return true;
    })
    .sort((a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0))
    .slice(0, limit);
}

export async function searchJobsForCompany(companyName, cache, locationLabel = 'Salt Lake City, UT', targetLanes = [], avoidTerms = '', options = {}) {
  if (!process.env.SEARCH_API_KEY) {
    console.warn('[searchJobsForCompany] SEARCH_API_KEY is not configured');
    return null;
  }

  const normalizedName = normalizeCompanyName(companyName);
  const targetText = targetLanes.length > 0 ? `${targetLanes.join(' OR ')} ` : '';
  const avoidText = avoidTerms ? ` -${avoidTerms.split(',').map(term => term.trim()).filter(Boolean).join(' -')}` : '';
  const cacheKey = `jobs:company:v4:${normalizedName}:${locationLabel}:${targetLanes.join('|')}:${avoidTerms}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    console.log(`[${companyName}] SearchAPI jobs:`, {
      location: locationLabel,
      count: cached.length,
      fromCache: true,
      fromExtraction: options.fromExtraction,
    });
    return cached;
  }

  const params = new URLSearchParams({
    engine: 'google_jobs',
    q: `${companyName} ${targetText}jobs in ${locationLabel}${avoidText}`,
    location: locationLabel,
    api_key: process.env.SEARCH_API_KEY,
    num: '10',
  });

  const response = await fetch(`https://www.searchapi.io/api/v1/search?${params}`);
  const data = await response.json();

  if (!response.ok || data.error) {
    console.error(`[${companyName}] SearchAPI company job error:`, getErrorMessage(data.error || response.status));
    return null;
  }

  const rawJobs = data.jobs || data.jobs_results || [];
  console.log(`[${companyName}] SearchAPI jobs:`, {
    location: locationLabel,
    count: rawJobs.length,
    fromCache: false,
    fromExtraction: options.fromExtraction,
  });
  const jobs = rawJobs.map(job => mapSearchApiJob(job, companyName));

  // Filter jobs to only include those in the target state (allow remote jobs)
  const stateCode = locationLabel.split(',')[1]?.trim().toUpperCase();
  const filteredJobs = stateCode ? jobs.filter(job =>
    job.workType === 'Remote' ||
    !job.location ||
    job.location.toUpperCase().includes(stateCode)
  ) : jobs;

  cache.set(cacheKey, filteredJobs);
  return filteredJobs;
}

export async function reverseGeocode(lat, lng, mapboxToken = process.env.MAPBOX_TOKEN) {
  if (!mapboxToken) return null;
  try {
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${mapboxToken}&types=place,region&limit=1`;
    const res = await fetch(url);
    const data = await res.json();
    const feature = data.features?.[0];
    if (!feature) return null;
    const city = feature.text;
    const stateContext = (feature.context || []).find(c => c.id.startsWith('region.'));
    const stateCode = stateContext?.short_code?.replace('US-', '') || null;
    return stateCode ? `${city}, ${stateCode}` : city;
  } catch {
    return null;
  }
}

export async function resolveLocationLabel(lat, lng, providedLabel = null, mapboxToken = process.env.MAPBOX_TOKEN) {
  const label = String(providedLabel || '').trim();
  if (label && !/^dropped pin$/i.test(label)) return label;
  return await reverseGeocode(lat, lng, mapboxToken) || 'Salt Lake City, UT';
}

async function searchJobsByTitle({ title, locationLabel, cache }) {
  if (!process.env.SEARCH_API_KEY) return [];

  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return [];

  const cacheKey = `jobs:title:v1:${cleanTitle}:${locationLabel}`;
  const cached = cache?.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    engine: 'google_jobs',
    q: `${cleanTitle} jobs in ${locationLabel}`,
    location: locationLabel,
    api_key: process.env.SEARCH_API_KEY,
    num: '10',
  });

  const response = await fetch(`https://www.searchapi.io/api/v1/search?${params}`);
  const data = await response.json();
  if (!response.ok || data.error) {
    console.error('[Scout job discovery] SearchAPI title job error:', getErrorMessage(data.error || response.status));
    return [];
  }

  const jobs = (data.jobs || data.jobs_results || []).map(job => mapSearchApiJob(job, job.company_name));
  cache?.set(cacheKey, jobs);
  console.log('[Scout job discovery] SearchAPI jobs:', { location: locationLabel, count: jobs.length });
  return jobs;
}

async function fetchPlacesTextSearch({ query, lat, lng, radius }) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) throw new Error('GOOGLE_PLACES_API_KEY is not configured');

  const body = {
    textQuery: query,
    maxResultCount: 10,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius,
      },
    },
  };

  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.types,places.rating,places.userRatingCount,places.websiteUri',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to fetch text search places');
  }

  return (data.places || []).map(mapPlaceResult);
}

function jobToCandidate(job, title, lat, lng, locationLabel) {
  const company = String(job.company || '').trim();
  if (!company) return null;
  return {
    place_id: `job:${normalizeCompanyName(company)}`,
    name: company,
    geometry: { location: { lat, lng } },
    vicinity: job.location || locationLabel,
    types: ['job_search_result'],
    rating: null,
    user_ratings_total: 0,
    websiteUri: null,
    discoverySource: 'job_search',
    discoveryQuery: `${title} jobs in ${locationLabel}`,
    discoveryScore: 300,
    initialOpportunities: [{
      source: 'searchapi',
      kind: 'opening',
      title: job.title || title,
      url: job.applyLink || null,
      description: [job.location, job.via].filter(Boolean).join(' - ') || job.description || null,
      signalStrength: 'strong',
    }],
  };
}

function placeToCandidate(place, source, query, score) {
  return {
    ...place,
    discoverySource: source,
    discoveryQuery: query,
    discoveryScore: score,
    initialOpportunities: [],
  };
}

function mergeCandidate(existing, next) {
  existing.discoveryScore = Math.max(existing.discoveryScore || 0, next.discoveryScore || 0);
  existing.discoverySource = existing.discoverySource === 'job_search' ? existing.discoverySource : next.discoverySource;
  existing.discoveryQuery = [existing.discoveryQuery, next.discoveryQuery].filter(Boolean).join(' | ').slice(0, 500);
  existing.initialOpportunities = [
    ...(existing.initialOpportunities || []),
    ...(next.initialOpportunities || []),
  ];
  if (!existing.websiteUri && next.websiteUri) existing.websiteUri = next.websiteUri;
  if ((!existing.geometry || !existing.geometry.location) && next.geometry) existing.geometry = next.geometry;
  if (!existing.vicinity && next.vicinity) existing.vicinity = next.vicinity;
  if (String(existing.place_id || '').startsWith('job:') && next.place_id && !String(next.place_id).startsWith('job:')) {
    existing.place_id = next.place_id;
  }
  return existing;
}

function isNegativeBusiness(place, negativeBusinessTypes = []) {
  const text = `${place.name || ''} ${place.vicinity || ''} ${(place.types || []).join(' ')} ${getCategoryFromTypes(place.types) || ''}`.toLowerCase();
  return negativeBusinessTypes.some(term => text.includes(String(term).toLowerCase()));
}

export async function discoverResumeMatchedPlaces({ lat, lng, radius, locationLabel, signals = {}, cache }) {
  const clampedRadius = clampScoutRadius(radius);
  const safeRadius = Number.isFinite(clampedRadius) ? clampedRadius : 1000;
  const candidates = [];
  let jobCandidateCount = 0;
  let employerCandidateCount = 0;
  let nearbyCandidateCount = 0;
  const jobTitles = Array.isArray(signals.jobSearchTitles) && signals.jobSearchTitles.length
    ? signals.jobSearchTitles
    : signals.jobTitles || [];
  const employerQueries = Array.isArray(signals.employerSearchQueries) ? signals.employerSearchQueries : [];
  const negativeBusinessTypes = Array.isArray(signals.negativeBusinessTypes) ? signals.negativeBusinessTypes : [];

  for (const title of jobTitles.slice(0, 6)) {
    let jobs = [];
    try {
      jobs = await searchJobsByTitle({ title, locationLabel, cache });
    } catch (err) {
      console.error('[Scout job discovery] failed:', getErrorMessage(err));
      continue;
    }
    for (const job of jobs.slice(0, 10)) {
      const candidate = jobToCandidate(job, title, lat, lng, locationLabel);
      if (candidate) {
        candidates.push(candidate);
        jobCandidateCount += 1;
      }
      if (jobCandidateCount >= JOB_DISCOVERY_LIMIT) break;
    }
    if (jobCandidateCount >= JOB_DISCOVERY_LIMIT) break;
  }

  for (const queryText of employerQueries.slice(0, 8)) {
    const placeQuery = /\bnear\b|\bin\b/i.test(queryText)
      ? queryText
      : `${queryText} near ${locationLabel}`;
    let places = [];
    try {
      places = filterAndRankPlaces(await fetchPlacesTextSearch({ query: placeQuery, lat, lng, radius: safeRadius }), 10);
    } catch (err) {
      console.error('[Scout employer discovery] failed:', getErrorMessage(err));
      continue;
    }
    for (const place of places) {
      const demotion = isNegativeBusiness(place, negativeBusinessTypes) ? 40 : 0;
      candidates.push(placeToCandidate(place, 'employer_search', placeQuery, 200 - demotion));
      employerCandidateCount += 1;
      if (employerCandidateCount >= EMPLOYER_DISCOVERY_LIMIT) break;
    }
    if (employerCandidateCount >= EMPLOYER_DISCOVERY_LIMIT) break;
  }

  const minimumBeforeBackfill = Math.min(MAX_PLACES_TO_SHOW, 12);
  if ((jobCandidateCount + employerCandidateCount) < minimumBeforeBackfill) {
    let nearby = [];
    try {
      nearby = filterAndRankPlaces(await fetchNearbyPlaces(lat, lng, safeRadius));
    } catch (err) {
      console.error('[Scout nearby backfill] failed:', getErrorMessage(err));
    }
    for (const place of nearby) {
      const demotion = isNegativeBusiness(place, negativeBusinessTypes) ? 120 : 0;
      candidates.push(placeToCandidate(place, 'nearby_backfill', 'nearby places', 100 - demotion));
      nearbyCandidateCount += 1;
    }
  }

  const byPlace = new Map();
  const byName = new Map();
  for (const candidate of candidates) {
    const placeKey = normalizePlaceKey(candidate);
    const nameKey = normalizeBusinessKey(candidate.name);
    const existingKey = byPlace.has(placeKey) ? placeKey : byName.get(nameKey);
    if (existingKey && byPlace.has(existingKey)) {
      const merged = mergeCandidate(byPlace.get(existingKey), candidate);
      byPlace.set(normalizePlaceKey(merged), merged);
      continue;
    }
    byPlace.set(placeKey, candidate);
    if (nameKey) byName.set(nameKey, placeKey);
  }

  const discovered = [...new Set(byPlace.values())]
    .filter(place => place.place_id && place.geometry?.location && place.name)
    .sort((a, b) => {
      if ((b.discoveryScore || 0) !== (a.discoveryScore || 0)) return (b.discoveryScore || 0) - (a.discoveryScore || 0);
      return (b.user_ratings_total || 0) - (a.user_ratings_total || 0);
    })
    .slice(0, MAX_PLACES_TO_SHOW);

  console.log('[Scout discovery] candidates:', {
    location: locationLabel,
    counts: {
      jobSearch: jobCandidateCount,
      employerSearch: employerCandidateCount,
      nearbyBackfill: nearbyCandidateCount,
      returned: discovered.length,
    },
    topSources: discovered.slice(0, 5).map(item => item.discoverySource),
  });

  return discovered;
}

export function createNearbyJobsHandler({ cache, mapboxToken }) {
  return async function nearbyJobsHandler(req, res) {
    const lat = req.query.lat === undefined ? SALT_LAKE_CITY.lat : Number(req.query.lat);
    const lng = req.query.lng === undefined ? SALT_LAKE_CITY.lng : Number(req.query.lng);
    const radius = clampScoutRadius(req.query.radius || 1000);

    const derivedLabel = await reverseGeocode(lat, lng, mapboxToken);
    const locationLabel = derivedLabel || 'Salt Lake City, UT';

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    if (!Number.isFinite(radius) || radius < MIN_SCOUT_RADIUS_METERS) {
      return res.status(400).json({ error: `radius must be at least ${MIN_SCOUT_RADIUS_METERS} meters` });
    }

    const roundedLat = lat.toFixed(2);
    const roundedLng = lng.toFixed(2);
    const cacheKey = `nearby:v2:${roundedLat}:${roundedLng}:${radius}:${locationLabel}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ ...cached, fromCache: true });

    try {
      const places = await fetchNearbyPlaces(lat, lng, radius);
      const rankedPlaces = filterAndRankPlaces(places);
      const checkedPlaceIds = new Set(
        rankedPlaces.slice(0, MAX_COMPANIES_TO_CHECK).map(place => place.place_id)
      );

      const businesses = await Promise.all(
        rankedPlaces.map(async place => {
          const shouldCheckJobs = checkedPlaceIds.has(place.place_id);
          const jobs = shouldCheckJobs ? await searchJobsForCompany(place.name, cache, locationLabel) : null;
          const placeLat = place.geometry.location.lat;
          const placeLng = place.geometry.location.lng;
          const hasJobs = Array.isArray(jobs) && jobs.length > 0;

          return {
            placeId: place.place_id,
            name: place.name,
            category: getCategoryFromTypes(place.types),
            lat: placeLat,
            lng: placeLng,
            vicinity: place.vicinity ?? '',
            website: place.websiteUri ?? null,
            rating: place.rating ?? null,
            userRatingsTotal: place.user_ratings_total ?? 0,
            jobs,
            hasJobs,
            jobSearchStatus: hasJobs ? 'hiring' : shouldCheckJobs ? 'no_jobs_found' : 'not_checked',
          };
        })
      );

      businesses.sort((a, b) => {
        if (a.hasJobs !== b.hasJobs) return a.hasJobs ? -1 : 1;
        if (a.jobSearchStatus !== b.jobSearchStatus) {
          if (a.jobSearchStatus === 'no_jobs_found') return -1;
          if (b.jobSearchStatus === 'no_jobs_found') return 1;
        }
        return (b.userRatingsTotal || 0) - (a.userRatingsTotal || 0);
      });

      const payload = {
        businesses,
        searchCenter: { lat, lng },
        radius,
        checkedBusinessCount: checkedPlaceIds.size,
      };

      cache.set(cacheKey, payload);
      res.json({ ...payload, fromCache: false });
    } catch (err) {
      console.error('Nearby jobs error:', getErrorMessage(err));
      res.status(500).json({ error: getErrorMessage(err) || 'Failed to fetch nearby jobs' });
    }
  };
}
