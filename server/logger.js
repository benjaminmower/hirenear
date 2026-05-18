import { randomUUID } from 'crypto';

const APP_LOGGER_NAME = 'hirenear-api';

function normalizeError(error) {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: process.env.NODE_ENV === 'production' ? undefined : error.stack,
    };
  }
  return { message: String(error) };
}

function cleanValue(value) {
  if (value === undefined) return undefined;
  if (value instanceof Error) return normalizeError(value);
  if (Array.isArray(value)) return value.map(cleanValue);
  if (!value || typeof value !== 'object') return value;

  const redactedKeys = new Set([
    'authorization',
    'cookie',
    'email',
    'seekerEmail',
    'businessContactEmail',
    'business_contact_email',
    'resumeText',
    'resume_text',
    'SMTP_PASS',
    'ANTHROPIC_API_KEY',
    'GOOGLE_PLACES_API_KEY',
    'MAPBOX_TOKEN',
    'SEARCH_API_KEY',
  ]);

  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key, redactedKeys.has(key) ? '[redacted]' : cleanValue(item)])
      .filter(([, item]) => item !== undefined)
  );
}

function write(level, event, details = {}) {
  const payload = cleanValue({
    severity: level.toUpperCase(),
    logger: APP_LOGGER_NAME,
    event,
    ...details,
    timestamp: new Date().toISOString(),
  });
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function createRequestId() {
  return randomUUID();
}

export function logInfo(event, details) {
  write('info', event, details);
}

export function logWarn(event, details) {
  write('warn', event, details);
}

export function logError(event, details = {}) {
  write('error', event, {
    ...details,
    error: normalizeError(details.error),
  });
}
