# HireNear

HireNear is a map-first local hiring scout, not a full job board. Paste a resume, drop a pin, choose a radius, and Scout checks nearby public business websites for hiring signals before using Claude to rank fit.

The Scout workflow is intentionally website-first. SearchAPI is only used as a fallback when a business has no website or the website evidence is weak or absent. The product is designed to help you prioritize where to look, not to exhaustively enumerate every open role.

## Features

- Scout mode for pasted resumes and dropped map pins
- Broad target lanes such as Finance, Healthcare, Hospitality, Office/Admin, and Retail
- Optional avoid terms for roles the user does not want
- Google Places nearby business discovery
- Public website inspection with Playwright
- Same-domain checks for likely hiring/contact paths
- robots.txt checks before visiting pages
- Live run updates over Server-Sent Events
- Postgres persistence for runs, businesses, inspections, opportunities, and matches
- Cached website inspections with a configurable TTL
- Business-level fit scores plus opportunity-level match records
- One batched Claude call per completed run for lower matching cost
- End-of-run save-search prompt with a lightweight local profile
- Manual delete endpoint and 30-day run retention cleanup
- Legacy keyword job search and nearby business job search remain available

## Safety Boundaries

HireNear does not:

- submit forms
- apply to jobs
- send email
- solve CAPTCHAs
- access content behind authentication
- crawl off-domain pages
- store raw HTML or full page text

Website text is used transiently for classification. Persisted evidence is limited to signal labels, classifications, and URLs.

## User Disclosure

Scout mode shows a privacy notice in the UI. The current disclosure is:

> Your resume is sent to this server and Claude's API for AI-powered matching. HireNear visits public business websites on your behalf, stores only hiring classifications and evidence URLs, and deletes scout runs after 30 days. Results sample nearby businesses and are not exhaustive.

## Stack

- Frontend: Vite, React, Mapbox GL JS
- Backend: Express, Postgres, Playwright
- Places: Google Places API
- Job fallback: SearchAPI Google Jobs
- Matching and summary: Anthropic Claude

## Prerequisites

- Node.js 18+
- Postgres running locally
- Google Places API key
- Mapbox token
- SearchAPI key
- Anthropic API key, optional for local development

Local Postgres setup assumes Postgres.app:

```bash
createdb hirenear
```

## Install

```bash
npm install
cd server && npm install && npx playwright install chromium
cd ../client && npm install
```

## Configure

Copy the server env template:

```bash
cp server/.env.example server/.env
```

Required server values:

```bash
SEARCH_API_KEY=...
MAPBOX_TOKEN=...
GOOGLE_PLACES_API_KEY=...
DATABASE_URL=postgres://localhost:5432/hirenear
```

Optional Scout values:

```bash
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-6
SCOUT_INSPECTION_CONCURRENCY=2
SCOUT_INSPECTION_TTL_HOURS=48
```

Client Mapbox value:

```bash
VITE_MAPBOX_TOKEN=...
```

## Run

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

Server health:

```text
http://localhost:3001/api/health
```

## Scout API

Create a run:

```http
POST /api/scout-runs
Content-Type: application/json

{
  "resumeText": "Pasted resume text...",
  "targetLanes": ["Finance", "Office/Admin"],
  "avoidTerms": "barista, server, cashier",
  "lat": 40.7608,
  "lng": -111.8910,
  "radius": 1000,
  "locationLabel": "Salt Lake City, UT"
}
```

Load a saved run:

```http
GET /api/scout-runs/:runId
```

Subscribe to live events:

```http
GET /api/scout-runs/:runId/events
```

Delete a run:

```http
DELETE /api/scout-runs/:runId
```

SSE event names:

- `business_queued`
- `business_update`
- `opportunity_found`
- `match_update`
- `complete`
- `error`
- `heartbeat`

## Project Structure

```text
server/
  db.js                 Postgres migrations and query helper
  geoSearch.js          Places and SearchAPI helpers
  index.js              Express API
  resumeMatcher.js      Claude matching and summary
  scoutRunner.js        Background scout orchestration
  websiteInspector.js   Playwright website classifier

client/src/
  App.jsx
  components/
    Map.jsx
    SearchPanel.jsx
    ScoutPanel.jsx
    JobList.jsx
  hooks/
    useJobs.js
    useGeoJobs.js
    useScout.js
```

## Verification

```bash
npm run build
node --check server/index.js
node --check server/scoutRunner.js
node --check server/websiteInspector.js
node --check server/resumeMatcher.js
```

## Notes

- `npm run dev:server` starts the server without `node --watch`; watch mode hit local file descriptor limits in this repo.
- Without `ANTHROPIC_API_KEY`, Scout still runs and uses a simple heuristic fit score.
- Re-running the same area can reuse fresh inspection cache rows from `business_inspections`.

## License

MIT
