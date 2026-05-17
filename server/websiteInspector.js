import { chromium } from 'playwright';

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
const robotsCache = new Map();

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
    const response = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': USER_AGENT },
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
  const parsed = new URL(url);
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

function extractContactEmail(text) {
  const match = String(text || '').match(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i);
  return match ? match[0].toLowerCase() : null;
}

export async function inspectWebsite(website, { maxPages = 5, timeoutMs = 20000 } = {}) {
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
  const page = await context.newPage();
  const baseUrl = normalizeUrl(website, website);
  const queue = [baseUrl, ...LIKELY_PATHS.map(path => normalizeUrl(path, baseUrl))].filter(Boolean);
  const seen = new Set();
  const evidence = [];
  const opportunities = [];
  let contactEmail = null;
  let bestSignal = 'none';

  try {
    while (queue.length > 0 && seen.size < maxPages && Date.now() - start < timeoutMs) {
      const url = queue.shift();
      if (!url || seen.has(url) || !sameDomain(url, domain)) continue;
      seen.add(url);

      try {
        if (!(await isAllowedByRobots(url))) {
          evidence.push({ url, label: 'Skipped by robots.txt', snippet: 'robots.txt disallows this path' });
          continue;
        }
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: Math.min(8000, timeoutMs) });
        const title = await page.title();
        const text = (await page.locator('body').innerText({ timeout: 3000 })).replace(/\s+/g, ' ').slice(0, 12000);
        const pageEmail = extractContactEmail(text);
        if (pageEmail && !contactEmail) contactEmail = pageEmail;
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
        evidence.push({ url, label: 'Page check failed', snippet: err.message });
      }
    }

    return {
      status: 'complete',
      signalStrength: bestSignal,
      signalSummary: summarizeSignal(bestSignal, opportunities),
      evidence,
      opportunities,
      contactEmail,
      inspectedPages: seen.size,
    };
  } catch (err) {
    return {
      status: 'failed',
      signalStrength: 'failed',
      signalSummary: 'Website inspection failed',
      evidence,
      opportunities,
      contactEmail,
      error: err.message,
    };
  } finally {
    await browser.close();
  }
}
