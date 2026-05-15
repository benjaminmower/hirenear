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

const MAX_PLACES_TO_SHOW = 20;
const MAX_COMPANIES_TO_CHECK = 5;

function normalizeCompanyName(name) {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.formattedAddress,places.types,places.rating,places.userRatingCount',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || 'Failed to fetch nearby places');
  }

  // Normalize new API shape to match what filterAndRankPlaces expects
  return (data.places || []).map(p => ({
    place_id: p.id,
    name: p.displayName?.text || '',
    geometry: { location: { lat: p.location.latitude, lng: p.location.longitude } },
    vicinity: p.formattedAddress || '',
    types: p.types || [],
    rating: p.rating ?? null,
    user_ratings_total: p.userRatingCount ?? 0,
  }));
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

export async function searchJobsForCompany(companyName, cache, locationLabel = 'Salt Lake City, UT') {
  const normalizedName = normalizeCompanyName(companyName);
  const cacheKey = `jobs:company:${normalizedName}:${locationLabel}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    engine: 'google_jobs',
    q: `${companyName} jobs`,
    location: locationLabel,
    api_key: process.env.SEARCH_API_KEY,
    num: '10',
  });

  const response = await fetch(`https://www.searchapi.io/api/v1/search?${params}`);
  const data = await response.json();

  if (!response.ok || data.error) {
    console.error(`[${companyName}] SearchAPI company job error:`, data.error || response.status);
    return null;
  }

  const rawJobs = data.jobs || data.jobs_results || [];
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

export function createNearbyJobsHandler({ cache, trackSearch, recordSearch }) {
  return async function nearbyJobsHandler(req, res) {
    const lat = req.query.lat === undefined ? SALT_LAKE_CITY.lat : Number(req.query.lat);
    const lng = req.query.lng === undefined ? SALT_LAKE_CITY.lng : Number(req.query.lng);
    const radius = Number(req.query.radius || 1000);
    const locationLabel = req.query.locationLabel || 'Salt Lake City, UT';

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    if (!Number.isFinite(radius) || radius < 100 || radius > 5000) {
      return res.status(400).json({ error: 'radius must be between 100 and 5000 meters' });
    }

    const roundedLat = lat.toFixed(2);
    const roundedLng = lng.toFixed(2);
    const cacheKey = `nearby:v2:${roundedLat}:${roundedLng}:${radius}:${locationLabel}`;
    const cached = cache.get(cacheKey);
    if (cached) return res.json({ ...cached, fromCache: true });

    const ip = req.ip || req.connection.remoteAddress;
    const rateStatus = trackSearch(ip);

    if (rateStatus.count >= rateStatus.limit) {
      return res.status(429).json({
        error: 'Search limit reached. Please try again tomorrow.',
        rateLimit: {
          limit: rateStatus.limit,
          remaining: 0,
          resetIn: '24 hours',
        },
      });
    }

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
            lat: placeLat,
            lng: placeLng,
            vicinity: place.vicinity ?? '',
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
      recordSearch(ip);
      res.json({ ...payload, fromCache: false });
    } catch (err) {
      console.error('Nearby jobs error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch nearby jobs' });
    }
  };
}
