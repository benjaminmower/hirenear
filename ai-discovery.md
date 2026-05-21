# Hire Near AI Discovery Plan

## Goal

Make Hire Near understandable, indexable, and citable by AI search systems by publishing stable public pages that return substantive HTML in the initial response body. React hydration may enhance the pages, but crawlers must not need JavaScript to understand them.

## Release Gate

This release is not done unless deployed `curl` can see the substance:

```bash
curl -fsS https://hirenear.app/method/v1    | grep -i "resume-to-business"
curl -fsS https://hirenear.app/how-it-works | grep -i "does Hire Near apply"
curl -fsS https://hirenear.app/stats        | grep -i "notification fit threshold"
curl -fsS https://hirenear.app/             | grep -i "map-first local hiring scout"
curl -fsS https://hirenear.app/method/v1    | grep -i '<title>'
curl -fsS https://hirenear.app/method/v1    | grep -i 'application/ld+json'
```

If `curl` cannot see the substance, AI citation systems may not either.

## Scope

In:

- `/method/v1` canonical technical methodology page
- `/how-it-works` plain-language mechanism page
- `/stats` structural operating parameters page
- `GET /api/stats`
- Crawlable definition block on `/`
- Build-time static rendering for public routes via Vite SSR
- Initial-HTML `<title>`, description, canonical, Open Graph, Twitter card, and schema.org JSON-LD
- `robots.txt`, `llms.txt`, `sitemap.xml`
- Footer links to How it works, Methodology, Stats
- `/method` 301 redirect to `/method/v1`
- README pointer to `/method/v1`
- Post-deploy AI citation baseline test

Out:

- About/founder page
- Glossary
- Live operating counts on `/stats`
- `llms-full.txt`
- Press/blog/marketing pages
- Any claim not directly supported by code or docs

## Routes

Prerender these routes:

```text
/
/for-businesses
/how-it-works
/method/v1
/stats
/privacy
/terms
```

Optional but recommended: prerender `/for-businesses/signup` to avoid fallback flicker, but exclude it from `sitemap.xml`.

`/method` is a Netlify 301 redirect, not a duplicate page.

## Files

Create:

```text
shared/statsPayload.mjs
client/src/entry-server.jsx
client/src/routes.js
client/src/lib/head.js
client/src/components/MethodologyPage.jsx
client/src/components/HowItWorksPage.jsx
client/src/components/StatsPage.jsx
client/src/components/HomeIntro.jsx
client/scripts/prerender.mjs
client/scripts/build-fixtures.mjs
client/public/robots.txt
client/public/llms.txt
client/public/sitemap.xml
```

Modify:

```text
Dockerfile
README.md
netlify.toml
server/index.js
server/websiteInspector.js
client/index.html
client/package.json
client/src/App.jsx
client/src/main.jsx
client/src/components/ForBusinessesPage.jsx
client/src/components/PublicFooter.jsx
```

## Shared Stats Payload

`shared/statsPayload.mjs` is pure ESM:

- no React
- no DOM
- no Vite
- no Node-only APIs
- shape builder only

It exports:

```js
buildStatsPayload({
  generatedAt,
  targetLanes,
  inspectionCacheTtlHours,
  model,
  signals,
  radiusMin,
  radiusMax,
  maxPagesPerSite,
  maxBusinessesPerRun,
})
```

The server injects live constants/env. The prerender script injects build fixtures.

## Server Container

Because `server/index.js` imports `../shared/statsPayload.mjs`, update `Dockerfile`:

```dockerfile
COPY shared ./shared
COPY server ./server
```

Without this, Cloud Run will fail at startup.

## Client HTML Template

`client/index.html` must become a prerender template. The prerender script replaces `%HEAD%`, `%ROOT%`, and `%PRERENDER_PATH%`.

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    %HEAD%
    <link href="https://api.mapbox.com/mapbox-gl-js/v3.3.0/mapbox-gl.css" rel="stylesheet" />
  </head>
  <body>
    <div id="root" data-prerender-path="%PRERENDER_PATH%">%ROOT%</div>
    <script src="/runtime-config.js"></script>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

The build must fail if any placeholder remains in prerendered output.

## Client Hydration

Modify `client/src/main.jsx` to hydrate prerendered routes and replace SPA fallback routes safely.

```jsx
import React from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

function normalizePath(pathname) {
  return pathname.replace(/\/+$/, '') || '/';
}

const root = document.getElementById('root');
const app = (
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

const prerenderPath = root?.dataset?.prerenderPath;
const currentPath = normalizePath(window.location.pathname);

if (prerenderPath && normalizePath(prerenderPath) === currentPath) {
  hydrateRoot(root, app);
} else {
  createRoot(root).render(app);
}
```

The prerender script must emit `data-prerender-path` for each generated file. For SPA fallback routes like `/match/...`, Netlify may serve homepage HTML. The path guard prevents React from hydrating the wrong DOM; it replaces it.

## Homepage Handoff

The server and first client render must match.

`App.jsx` must render the same shell for `/` that SSR renders:

```jsx
if (normalizedPath === '/') {
  return <HomeStaticShell />;
}
```

`HomeStaticShell` must not render `ScoutApp` during the first client render. Use mounted state:

```jsx
function HomeStaticShell() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  return (
    <>
      <HomeIntro />
      <div id="scout-app-root">
        {mounted ? <ScoutApp /> : null}
      </div>
    </>
  );
}
```

Server render and first client render both output `HomeIntro` plus an empty mount div. The map mounts after hydration. `HomeIntro` stays visible; this is not cloaking.

## SSR Entry

`client/src/entry-server.jsx` must not import `App.jsx`; `App.jsx` reads `window.location.pathname`.

Use a path switch:

```jsx
export async function renderRoute(path, context) {
  const Component = pickComponent(path);
  const html = renderToString(<Component {...componentProps(path, context)} />);
  const head = getHead(path, context);
  return { html, head };
}
```

Keep `entry-server.jsx` from importing `Map.jsx`, `ScoutApp`, or any module that reads browser globals at module load time.

## Prerender Script

`client/scripts/prerender.mjs`:

- runs after `vite build`
- uses Vite SSR loader
- reads `dist/index.html` as the template
- replaces `%HEAD%`, `%ROOT%`, and `%PRERENDER_PATH%`
- writes one `index.html` per prerendered route
- closes Vite in `finally`

```js
const vite = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
});
const { renderRoute } = await vite.ssrLoadModule('/src/entry-server.jsx');
```

Package scripts:

```json
{
  "scripts": {
    "build": "vite build && node scripts/prerender.mjs",
    "prerender": "node scripts/prerender.mjs",
    "preview": "vite preview"
  }
}
```

`prerender` does not invoke `vite build`; this avoids double-build or recursive script traps.

## Route Table

`client/src/routes.js`:

```js
export const PUBLIC_ROUTES = [
  { path: '/', component: 'HomeStaticShell', prerender: true },
  { path: '/for-businesses', component: 'ForBusinessesPage', prerender: true },
  { path: '/how-it-works', component: 'HowItWorksPage', prerender: true },
  { path: '/method/v1', component: 'MethodologyPage', prerender: true },
  { path: '/stats', component: 'StatsPage', prerender: true },
  { path: '/privacy', component: 'PrivacyPage', prerender: true },
  { path: '/terms', component: 'TermsPage', prerender: true },
  { path: '/for-businesses/signup', component: 'BusinessSignupPage', prerender: false },
];
```

`App.jsx` consumes this table for client-side public routing. `/method` is handled by Netlify before React.

## Head Data

`client/src/lib/head.js` exports:

```js
getHead(path, context)
applyHead(head)
serializeHead(head)
```

Rules:

- `getHead` is pure.
- `applyHead` updates browser head on client navigation.
- `serializeHead` writes initial HTML.
- `serializeHead` must HTML-escape text attributes.
- JSON-LD is emitted as `script[type="application/ld+json"][data-managed="head"]`.
- `datePublished` is fixed once `/method/v1` first deploys.
- `dateModified` is `context.buildDate`.

## Pages

### `/`

Initial HTML body includes:

```text
Hire Near is a map-first local hiring scout. A job seeker pastes a resume, drops a pin, and Hire Near identifies nearby businesses by inspecting public websites, classifying hiring and contact signals, and scoring resume-to-business fit. Hire Near respects robots.txt, never submits forms or applies to jobs, and never stores raw HTML.
```

JSON-LD: `WebSite` + `Organization`.

### `/method/v1`

Canonical technical record:

- Methodology v1
- fixed `datePublished`
- build `dateModified`
- system overview
- resume signal extraction
- business discovery
- website inspection
- signal classification
- fit scoring
- notification gate
- persistence and retention
- safety boundaries
- changelog

JSON-LD: `TechArticle`.

### `/how-it-works`

Plain-language explanation:

- what Hire Near is
- five-step mechanism
- inspected pages
- what Hire Near never does
- link to `/method/v1`

JSON-LD: `WebPage` + `FAQPage`.

### `/stats`

`StatsPage({ initialStats })`:

- initializes state from `initialStats`
- refetches `/api/stats` in `useEffect`
- fetch failure shows subdued "Showing build-time values; live refresh unavailable."
- does not import `buildStatsPayload`

JSON-LD: `Dataset`.

## API

`GET /api/stats` in `server/index.js`:

- imports radius bounds from `server/limits.js`
- imports signal labels from `server/websiteInspector.js`
- imports `buildStatsPayload` from `../shared/statsPayload.mjs`
- hardcodes `TARGET_LANES` for now with a comment pointing to `client/src/constants.js`
- sets `Cache-Control: public, max-age=3600`

Payload shape:

```js
{
  generatedAt,
  targetLanes,
  scoutRadiusMeters: { min, max },
  inspectionCacheTtlHours,
  runRetentionDays: 30,
  inspectionRetentionDays: 180,
  notificationFitThreshold: 80,
  matchBands: { high: 75, medium: 45 },
  maxPagesPerSite: 9,
  maxBusinessesPerRun: 20,
  model,
  signals: { strong, weak },
  persisted: ['evidence url+label', 'signal classification', 'company profile fields'],
  notPersisted: ['raw HTML', 'full page text', 'pages beyond same-domain hiring/about set'],
}
```

## Static Files

### `client/public/robots.txt`

```txt
User-agent: *
Allow: /

User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-User
Allow: /

User-agent: Claude-SearchBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: HireNear-Scout
Disallow: /

Sitemap: https://hirenear.app/sitemap.xml
```

`Google-Extended` is not required for indexing; it is included for explicit policy. Re-check vendor bot names roughly every six months.

### `client/public/llms.txt`

Include:

- short Hire Near definition
- `https://hirenear.app/method/v1`
- `https://hirenear.app/how-it-works`
- `https://hirenear.app/stats`
- safety boundaries

### `client/public/sitemap.xml`

Valid XML, canonical public HTML pages:

```text
https://hirenear.app/
https://hirenear.app/for-businesses
https://hirenear.app/how-it-works
https://hirenear.app/method/v1
https://hirenear.app/stats
https://hirenear.app/privacy
https://hirenear.app/terms
```

Exclude `/method`, `/for-businesses/signup`, and `/llms.txt`.

## Netlify

Add before the SPA fallback:

```toml
[[redirects]]
  from = "/method"
  to = "/method/v1"
  status = 301
  force = true
```

Keep the `/api/*` proxy before the fallback.

## SSR Safety

- `entry-server.jsx` must not import `App.jsx`.
- `App.jsx` must render `HomeStaticShell` for `/`.
- Refactor `ForBusinessesPage.jsx` away from JS media-query style branching.
- Browser-only work stays in `useEffect`.
- `BusinessSignupPage.jsx` can remain unchanged unless prerendered.

## Build Assertions

Fail the build if:

- `%HEAD%`, `%ROOT%`, or `%PRERENDER_PATH%` remains
- `data-prerender-path` is missing
- required body strings are missing
- there is not exactly one `<title>`
- there is not exactly one canonical link
- emitted JSON-LD script contents are not parseable JSON
- render throws browser-global `ReferenceError`
- fixture constants drift from server constants

Fixture drift test should cover:

- radius min/max
- signal labels
- target lanes
- score thresholds
- max pages per site
- max businesses per run
- retention days
- notification fit threshold

## Verification

Local:

```bash
npm install
npm run build
node --check server/index.js
npm run preview
```

Static checks:

```bash
grep -l "Methodology v1" client/dist/method/v1/index.html
grep -l "Does Hire Near apply" client/dist/how-it-works/index.html
grep -l "notification fit threshold" client/dist/stats/index.html
grep -l "map-first local hiring scout" client/dist/index.html
grep -l 'application/ld+json' client/dist/method/v1/index.html
grep -l 'data-prerender-path="/method/v1"' client/dist/method/v1/index.html
```

Preview checks:

- `/stats` has no error banner.
- `/` keeps intro visible after the map mounts.
- Browser console has no hydration warnings.
- Fallback routes like `/match/test-token` replace homepage fallback cleanly.

Post-deploy:

- run the release-gate `curl` checks
- verify `/method` returns 301
- verify `/method/v1` returns 200
- confirm raw JSON-LD and canonical tags
- submit sitemap to Google Search Console and Bing Webmaster Tools
- run Google Rich Results Test for `/method/v1` and `/how-it-works`

## AI Citation Baseline

Within 24 hours of deploy, ask:

```text
What is Hire Near and how does it work?
```

Record responses from:

- ChatGPT with browsing
- Claude with web search
- Perplexity
- Google Search / AI Overview

Record whether `/method/v1` or `/how-it-works` is cited by URL. Re-run monthly.

## Plain-English Explanation

Right now, Hire Near is like a book that only shows its real pages after a browser presses a special JavaScript button. People with normal browsers can read it, but some search robots and AI tools may open the book and only see a mostly blank first page.

This plan prints the important pages before anyone visits. When a robot opens `/method/v1`, it immediately sees the explanation of how Hire Near works. When a person opens the same page, React still wakes up afterward and makes the app interactive.

The important rule is that the first page React sees in the browser must match the page we printed ahead of time. If they do not match, React may throw away the printed page. That is why the homepage renders a small explanation first, then mounts the map only after hydration.

Static HTML is for discovery. Hydration is for interactivity. The same content is visible to crawlers and humans.

## Next Milestone

External corroboration:

- README link to `/method/v1`
- public launch/update post
- directory/profile pages using the same definition and canonical methodology link

The static public record creates the source. External references make it more likely to be cited.
