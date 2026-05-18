import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { chromium } from 'playwright';
import { getErrorMessage } from './limits.js';

const LIKELY_PATHS = ['/careers', '/jobs', '/employment', '/join-us', '/work-with-us', '/apply', '/contact'];
const STRONG_PATTERNS = [
  /\bwe'?re hiring\b/i,
  /\bnow hiring\b/i,
  /\bopen positions?\b/i,
  /\bcurrent openings?\b/i,
  /\bjob openings?\b/i,
  /\bapply now\b/i,
  /\bcareer opportunities\b/i,
  /\bjoin our team\b/i,
];
const WEAK_PATTERNS = [
  /\bcontact us\b/i,
  /\bsend (us )?(your )?resume\b/i,
  /\bhiring@[\w.-]+\.[a-z]{2,}\b/i,
  /\bcareers@[\w.-]+\.[a-z]{2,}\b/i,
  /\bgeneral inquir(y|ies)\b/i,
];
const USER_AGENT = 'HireNear-Scout/1.0 (+https://hirenear.com/bot)';
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'font', 'media']);
const BLOCKED_HOSTNAMES = new Set(['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254']);
const HOST_LOOKUP_TTL_MS = 5 * 60 * 1000;
const PAGE_VISIT_TIMEOUT_MS = 15000;
const robotsCache = new Map();
const hostLookupCache = new Map();
const activeInspectionContexts = new Map();
const EMAIL_PATTERN = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/ig;
const EMAIL_VALIDATION_PATTERN = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export function normalizeDomain(website) {
  try {
    const url = new URL(website);
    return url.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function normalizeUrl(rawUrl, baseUrl) {
  try {
    const url = new URL(rawUrl, baseUrl);
    return url.toString();
  } catch {
    return null;
  }
}

function registerInspectionContext(runId, context) {
  if (!runId) return () => {};
  const contexts = activeInspectionContexts.get(runId) || new Set();
  contexts.add(context);
  activeInspectionContexts.set(runId, contexts);
  return () => {
    const current = activeInspectionContexts.get(runId);
    if (!current) return;
    current.delete(context);
    if (current.size === 0) {
      activeInspectionContexts.delete(runId);
    }
  };
}

export async function closeRunInspectionSessions(runId) {
  const contexts = activeInspectionContexts.get(runId);
  if (!contexts || contexts.size === 0) return 0;
  const active = [...contexts];
  activeInspectionContexts.delete(runId);
  await Promise.all(active.map(async context => {
    try {
      await context.close();
    } catch {
      // Ignore close errors during cleanup.
    }
  }));
  return active.length;
}

function isBlockedIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }

  const [first, second] = octets;
  if (first === 0 || first === 10 || first === 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  return false;
}

function isBlockedIpv6(address) {
  const normalized = address.toLowerCase();
  return normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:');
}

function isBlockedAddress(address) {
  const version = isIP(address);
  if (version === 4) return isBlockedIpv4(address);
  if (version === 6) return isBlockedIpv6(address);
  return true;
}

async function resolveHostname(hostname) {
  const cached = hostLookupCache.get(hostname);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.addresses;
  }

  let addresses;
  if (isIP(hostname)) {
    addresses = [{ address: hostname }];
  } else {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  }
  hostLookupCache.set(hostname, {
    addresses,
    expiresAt: Date.now() + HOST_LOOKUP_TTL_MS,
  });
  return addresses;
}

export async function assertSafeHttpUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are allowed');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('Blocked private or loopback hostname');
  }

  const addresses = await resolveHostname(hostname);
  if (!addresses.length) {
    throw new Error('Hostname did not resolve');
  }

  if (addresses.some(result => isBlockedAddress(result.address))) {
    throw new Error('Blocked private or loopback address');
  }

  return parsed.toString();
}

function sameDomain(url, domain) {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase() === domain;
  } catch {
    return false;
  }
}

function pathMatchesRule(pathname, rulePath) {
  if (!rulePath) return false;
  if (rulePath === '/') return true;
  return pathname.startsWith(rulePath);
}

function parseRobots(text) {
  const groups = [];
  let current = null;

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const [fieldRaw, ...valueParts] = line.split(':');
    const field = fieldRaw.trim().toLowerCase();
    const value = valueParts.join(':').trim();

    if (field === 'user-agent') {
      current = { agents: [value.toLowerCase()], disallow: [], allow: [] };
      groups.push(current);
    } else if (current && field === 'disallow') {
      current.disallow.push(value);
    } else if (current && field === 'allow') {
      current.allow.push(value);
    }
  }

  return groups;
}

async function getRobotsRules(origin) {
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  try {
    const robotsUrl = await assertSafeHttpUrl(`${origin}/robots.txt`);
    const response = await fetch(robotsUrl, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) {
      robotsCache.set(origin, []);
      return [];
    }
    const rules = parseRobots(await response.text());
    robotsCache.set(origin, rules);
    return rules;
  } catch {
    robotsCache.set(origin, []);
    return [];
  }
}

export async function isAllowedByRobots(url) {
  const parsed = new URL(await assertSafeHttpUrl(url));
  const groups = await getRobotsRules(parsed.origin);
  const relevant = groups.filter(group =>
    group.agents.includes('*') ||
    group.agents.some(agent => USER_AGENT.toLowerCase().startsWith(agent.replace(/\*$/, '')))
  );
  if (relevant.length === 0) return true;

  let best = { type: 'allow', length: -1 };
  for (const group of relevant) {
    for (const allow of group.allow) {
      if (pathMatchesRule(parsed.pathname, allow) && allow.length > best.length) {
        best = { type: 'allow', length: allow.length };
      }
    }
    for (const disallow of group.disallow) {
      if (pathMatchesRule(parsed.pathname, disallow) && disallow.length > best.length) {
        best = { type: 'disallow', length: disallow.length };
      }
    }
  }
  return best.type !== 'disallow';
}

export function classifyPage({ url, title, text }) {
  const strong = STRONG_PATTERNS.find(pattern => pattern.test(text));
  if (strong) {
    return {
      signalStrength: 'strong',
      opportunity: {
        source: 'website',
        kind: /contact/i.test(url) ? 'hiring_contact' : 'opening',
        title: title || 'Hiring signal',
        url,
        description: 'Hiring language found on page',
        signalStrength: 'strong',
      },
      evidence: { url, label: 'Strong hiring signal' },
    };
  }

  const weak = WEAK_PATTERNS.find(pattern => pattern.test(text));
  if (weak) {
    return {
      signalStrength: 'weak',
      opportunity: {
        source: 'website',
        kind: 'contact',
        title: title || 'Contact opportunity',
        url,
        description: 'Contact or general inquiry path found on page',
        signalStrength: 'weak',
      },
      evidence: { url, label: 'Weak contact signal' },
    };
  }

  return {
    signalStrength: 'none',
    evidence: null,
    opportunity: null,
  };
}

function signalRank(signal) {
  return { failed: -1, none: 0, weak: 1, strong: 2 }[signal] ?? 0;
}

function summarizeSignal(signal, opportunities) {
  if (signal === 'strong') return `${opportunities.filter(o => o.signalStrength === 'strong').length || 1} hiring signal found`;
  if (signal === 'weak') return 'Contact or general inquiry path found';
  if (signal === 'failed') return 'Website inspection failed';
  return 'No hiring signal found on checked pages';
}

async function readPageText(page, context, url, timeoutMs) {
  await assertSafeHttpUrl(url);

  let closedForTimeout = false;
  let pageVisitTimeoutId = null;
  const visitPromise = (async () => {
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    await assertSafeHttpUrl(page.url() || response?.url() || url);
    const title = await page.title();
    const text = (await page.locator('body').innerText({ timeout: Math.min(3000, timeoutMs) }))
      .replace(/\s+/g, ' ')
      .slice(0, 12000);
    return { title, text };
  })().catch(err => {
    if (closedForTimeout) return null;
    throw err;
  });

  const timeoutPromise = new Promise((_, reject) => {
    pageVisitTimeoutId = setTimeout(() => {
      closedForTimeout = true;
      void context.close().catch(() => {});
      reject(new Error(`Page visit timed out after ${Math.round(timeoutMs / 1000)} seconds`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([visitPromise, timeoutPromise]);
    if (closedForTimeout || !result) {
      throw new Error(`Page visit timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    }
    return result;
  } finally {
    clearTimeout(pageVisitTimeoutId);
  }
}

function firstValidEmail(text) {
  if (!text) return null;
  const matches = text.match(EMAIL_PATTERN) || [];
  for (const match of matches) {
    const value = String(match || '').trim().toLowerCase();
    if (!value) continue;
    if (EMAIL_VALIDATION_PATTERN.test(value)) return value;
  }
  return null;
}

function firstMailtoEmail(hrefs) {
  for (const href of hrefs || []) {
    if (!href) continue;
    try {
      const parsed = new URL(href, 'https://placeholder.local');
      if (parsed.protocol !== 'mailto:') continue;
      const decoded = decodeURIComponent(parsed.pathname || '').trim();
      const parts = decoded.split(',').map(item => item.trim()).filter(Boolean);
      for (const part of parts) {
        const value = part.toLowerCase();
        if (EMAIL_VALIDATION_PATTERN.test(value)) return value;
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function inspectWebsite(website, { maxPages = 5, timeoutMs = PAGE_VISIT_TIMEOUT_MS, runId } = {}) {
  const domain = normalizeDomain(website);
  if (!website || !domain) {
    return {
      status: 'failed',
      signalStrength: 'failed',
      signalSummary: 'No valid website available',
      evidence: [],
      opportunities: [],
      error: 'missing_website',
    };
  }

  const start = Date.now();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const unregisterContext = registerInspectionContext(runId, context);
  await context.route('**/*', async route => {
    const request = route.request();
    if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
      return route.abort();
    }

    try {
      await assertSafeHttpUrl(request.url());
      return route.continue();
    } catch {
      return route.abort();
    }
  });
  const page = await context.newPage();
  const baseUrl = normalizeUrl(website, website);
  const queue = [baseUrl, ...LIKELY_PATHS.map(path => normalizeUrl(path, baseUrl))].filter(Boolean);
  const seen = new Set();
  const evidence = [];
  const opportunities = [];
  let bestSignal = 'none';
  const overallTimeoutMs = timeoutMs * maxPages;
  let contactEmail = null;

  try {
    await assertSafeHttpUrl(baseUrl);

    while (queue.length > 0 && seen.size < maxPages && Date.now() - start < overallTimeoutMs) {
      const url = queue.shift();
      if (!url || seen.has(url) || !sameDomain(url, domain)) continue;
      seen.add(url);

      try {
        if (!(await isAllowedByRobots(url))) {
          evidence.push({ url, label: 'Skipped by robots.txt', snippet: 'robots.txt disallows this path' });
          continue;
        }
        const { title, text } = await readPageText(page, context, url, timeoutMs);
        const mailtoLinks = await page.locator('a[href^="mailto:"]').evaluateAll(links =>
          links.map(link => link.getAttribute('href')).filter(Boolean)
        );
        if (!contactEmail) {
          contactEmail = firstMailtoEmail(mailtoLinks) || firstValidEmail(text);
        }
        const classification = classifyPage({ url, title, text });

        if (classification.evidence) evidence.push(classification.evidence);
        if (classification.opportunity && !opportunities.some(item => item.url === classification.opportunity.url && item.kind === classification.opportunity.kind)) {
          opportunities.push(classification.opportunity);
        }
        if (signalRank(classification.signalStrength) > signalRank(bestSignal)) {
          bestSignal = classification.signalStrength;
        }

        if (seen.size === 1) {
          const hrefs = await page.locator('a[href]').evaluateAll(links => links
            .map(link => ({ href: link.getAttribute('href'), text: link.textContent || '' }))
            .filter(link => /(career|jobs?|employment|join.?us|work.?with.?us|apply|contact)/i.test(`${link.text} ${link.href}`))
            .map(link => link.href)
          );
          for (const href of hrefs) {
            const nextUrl = normalizeUrl(href, url);
            if (nextUrl && sameDomain(nextUrl, domain) && !seen.has(nextUrl) && queue.length < 12) {
              queue.push(nextUrl);
            }
          }
        }
      } catch (err) {
        if (String(err?.message || '').includes('timed out after')) {
          throw err;
        }
        evidence.push({ url, label: 'Page check failed', snippet: err.message });
      }
    }

    return {
      status: 'complete',
      signalStrength: bestSignal,
      signalSummary: summarizeSignal(bestSignal, opportunities),
      evidence,
      opportunities,
      contactEmail: contactEmail || null,
      inspectedPages: seen.size,
    };
  } catch (err) {
    return {
      status: 'failed',
      signalStrength: 'failed',
      signalSummary: 'Website inspection failed',
      evidence,
      opportunities,
      contactEmail: contactEmail || null,
      error: getErrorMessage(err),
    };
  } finally {
    unregisterContext();
    await browser.close();
  }
}
