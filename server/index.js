import express from 'express';
import cors from 'cors';
import NodeCache from 'node-cache';
import { config } from 'dotenv';

config();

const app = express();
const cache = new NodeCache({ stdTTL: 86400 }); // 24 hour cache to respect free tier

// Rate limiter: track searches by IP to stay under 100/month free tier
const searchCounts = new Map();
const RATE_LIMIT_WINDOW = 24 * 60 * 60 * 1000; // 24 hours
const MAX_SEARCHES_PER_DAY = 3; // ~90/month with safety margin

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

const SERP_API_KEY = process.env.SERP_API_KEY;
const MAPBOX_TOKEN = process.env.MAPBOX_TOKEN;

if (!SERP_API_KEY || !MAPBOX_TOKEN) {
  console.warn('⚠️  Missing env vars. Copy .env.example to .env and fill in your keys.');
}

// Track searches for rate limiting
function trackSearch(ip) {
  const now = Date.now();
  if (!searchCounts.has(ip)) {
    searchCounts.set(ip, []);
  }

  const counts = searchCounts.get(ip);
  // Remove entries older than 24 hours
  counts.splice(0, counts.findIndex(t => now - t < RATE_LIMIT_WINDOW) || counts.length);

  return {
    count: counts.length,
    limit: MAX_SEARCHES_PER_DAY,
    remaining: Math.max(0, MAX_SEARCHES_PER_DAY - counts.length),
  };
}

function recordSearch(ip) {
  const counts = searchCounts.get(ip) || [];
  counts.push(Date.now());
  searchCounts.set(ip, counts);
}

// --- Geocode a job location string → { lat, lng } ---
async function geocodeLocation(location) {
  const cacheKey = `geo:${location}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(location)}.json?access_token=${MAPBOX_TOKEN}&limit=1&types=place,region,district,locality`;

  const res = await fetch(url);
  const data = await res.json();

  if (!data.features || data.features.length === 0) return null;

  const [lng, lat] = data.features[0].center;
  const result = { lat, lng, placeName: data.features[0].place_name };

  cache.set(cacheKey, result);
  return result;
}

// --- Search jobs via SerpApi ---
app.get('/api/jobs', async (req, res) => {
  const { query, location, chips } = req.query;

  if (!query) return res.status(400).json({ error: 'query is required' });

  const cacheKey = `jobs:${query}:${location}:${chips}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json({ jobs: cached, fromCache: true });

  // Check rate limit for new searches (only if NOT cached)
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
    const params = new URLSearchParams({
      engine: 'google_jobs',
      q: query,
      api_key: SERP_API_KEY,
      num: '20',
    });

    if (location) params.set('location', location);
    if (chips) params.set('chips', chips); // e.g. date_posted:month

    const serpRes = await fetch(`https://serpapi.com/search?${params}`);
    const serpData = await serpRes.json();

    if (serpData.error) {
      return res.status(500).json({ error: serpData.error });
    }

    const rawJobs = serpData.jobs_results || [];

    // Geocode each job location (parallel, with deduplication)
    const locationSet = [...new Set(rawJobs.map(j => j.location).filter(Boolean))];
    const geocodeResults = await Promise.all(
      locationSet.map(async loc => [loc, await geocodeLocation(loc)])
    );
    const geocodeMap = Object.fromEntries(geocodeResults.filter(([, v]) => v !== null));

    const jobs = rawJobs
      .map(job => {
        const geo = geocodeMap[job.location];
        return {
          id: job.job_id || `${job.company_name}-${job.title}-${job.location}`,
          title: job.title,
          company: job.company_name,
          location: job.location,
          via: job.via,
          description: job.description,
          salary: job.detected_extensions?.salary_range ?? null,
          workType: job.detected_extensions?.work_from_home ? 'Remote' : 'On-site',
          postedAt: job.detected_extensions?.posted_at ?? null,
          applyLink: job.apply_options?.[0]?.link ?? null,
          lat: geo?.lat ?? null,
          lng: geo?.lng ?? null,
          hasCoords: geo !== null,
        };
      });

    cache.set(cacheKey, jobs);
    recordSearch(ip); // Record successful search for rate limiting
    res.json({ jobs, fromCache: false });
  } catch (err) {
    console.error('Job search error:', err);
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

// --- Health check ---
app.get('/api/health', (_, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🗺️  jobmap server running on http://localhost:${PORT}`));
