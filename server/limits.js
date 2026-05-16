export const MIN_SCOUT_RADIUS_METERS = 100;
export const MAX_SCOUT_RADIUS_METERS = 5000;
export const MAX_RESUME_BYTES = 15 * 1024;
export const MAX_SSE_CONNECTIONS_PER_IP = 3;
export const SSE_CONNECTION_TTL_MS = 10 * 60 * 1000;

export function clampScoutRadius(value) {
  const radius = Number(value);
  if (!Number.isFinite(radius)) return NaN;
  return Math.min(radius, MAX_SCOUT_RADIUS_METERS);
}

export function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

export function getErrorMessage(err) {
  if (err instanceof Error) return err.message;
  return String(err || 'Unknown error');
}
