import { logWarn } from './logger.js';

const counters = new Map();

const DEFAULT_DAILY_LIMITS = {
  anthropic: 200,
  googlePlaces: 300,
  mapbox: 500,
  searchApi: 80,
  scoutRuns: 25,
};

function envLimit(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function getDailyLimit(provider) {
  return {
    anthropic: envLimit('DAILY_ANTHROPIC_LIMIT', DEFAULT_DAILY_LIMITS.anthropic),
    googlePlaces: envLimit('DAILY_GOOGLE_PLACES_LIMIT', DEFAULT_DAILY_LIMITS.googlePlaces),
    mapbox: envLimit('DAILY_MAPBOX_LIMIT', DEFAULT_DAILY_LIMITS.mapbox),
    searchApi: envLimit('DAILY_SEARCHAPI_LIMIT', DEFAULT_DAILY_LIMITS.searchApi),
    scoutRuns: envLimit('DAILY_SCOUT_RUN_LIMIT', DEFAULT_DAILY_LIMITS.scoutRuns),
  }[provider] ?? 0;
}

function dayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function getDailyUsage(provider) {
  return counters.get(`${dayKey()}:${provider}`) || 0;
}

export function reserveDailyUsage(provider, metadata = {}) {
  const limit = getDailyLimit(provider);
  if (limit === 0) {
    logWarn('provider_budget_blocked', { provider, limit, used: getDailyUsage(provider), ...metadata });
    throw new Error(`${provider} daily limit is set to 0`);
  }

  const key = `${dayKey()}:${provider}`;
  const used = counters.get(key) || 0;
  if (used >= limit) {
    logWarn('provider_budget_exhausted', { provider, limit, used, ...metadata });
    throw new Error(`${provider} daily limit reached`);
  }

  counters.set(key, used + 1);
  return { provider, limit, used: used + 1, remaining: Math.max(0, limit - used - 1) };
}
