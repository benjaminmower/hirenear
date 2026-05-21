# Hire Near

Hire Near is a map-first local hiring scout, not a full job board. Paste a resume, drop a pin, choose a radius, and work nearby businesses one at a time. You decide which doors are worth opening, and Hire Near checks public business websites for hiring signals before using Claude to rank fit.

The Scout workflow is intentionally website-first and human-paced. The run view shows a single next business with preview links for the website, Maps, and any social links already discovered. SearchAPI is only used as a fallback when a business has no website or the website evidence is weak or absent. The product is designed to help you prioritize where to look, not to exhaustively enumerate every open role.

## Features

- Scout mode for pasted resumes and dropped map pins
- Mobile-first map UI with city search (Mapbox autocomplete) and anchored pin CTA
- Swipe-style next-door card with `Match us` and `Skip`
- Step-by-step inspection feedback shown in a modal overlay during a run
- Broad target lanes such as Finance, Healthcare, Hospitality, Office/Admin, and Retail
- Optional avoid terms for roles the user does not want
- Google Places nearby business discovery
- Public website inspection with Playwright
- Same-domain checks for likely hiring/contact paths
- robots.txt checks before visiting pages
- Single business notification email for 80%+ fit with discovered contact email
- Live run updates over Server-Sent Events
- Postgres persistence for runs, businesses, inspections, opportunities, and matches
- Cached website inspections with a configurable TTL
- Business-level fit scores plus opportunity-level match records
- Cached company profile blurbs generated inside the existing batched Claude matching call
- Google Places rating, category, hours, Maps links, and preview links on the active door card
- One batched Claude call per completed run for lower matching cost
- End-of-run save-search prompt with a lightweight local profile
- Inspection history view for prior runs
- Manual delete endpoint and 30-day run retention cleanup
- SMB-facing pages: For Businesses landing, business signup, and per-business detail
- Privacy Policy and Terms of Service pages linked from a public footer

## Safety Boundaries

Hire Near does not:

- submit forms
- apply to jobs
- solve CAPTCHAs
- access content behind authentication
- crawl off-domain pages
- store raw HTML or full page text

Website text is used transiently for classification and company profile generation. Persisted evidence is limited to signal labels, classifications, URLs, and structured company profile fields.

Hirenear sends a single notification email to businesses where a candidate scores 80% fit or above, if a contact email was found on their public website. No email is sent more than once per business per scout run.

## User Disclosure

The setup and run controls show privacy notices in the UI. The core disclosure is:

> Resume text is sent to this server and Claude's API for matching. Hire Near checks public business websites only after you click `Match us`, stores hiring classifications and evidence URLs, and deletes scout runs after 30 days.

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

Copy the client env template:

```bash
cp client/.env.example client/.env
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
  analytics.js          Lightweight event logging
  budgetGuard.js        Per-run cost and call ceilings
  db.js                 Postgres migrations and query helper
  geoSearch.js          Places and SearchAPI helpers
  index.js              Express API
  limits.js             Rate and usage limits
  logger.js             Structured logging
  notifier.js           Business notification email
  resumeMatcher.js      Claude matching and summary
  scoutRunner.js        Background scout orchestration
  websiteInspector.js   Playwright website classifier

client/src/
  App.jsx
  constants.js
  components/
    Map.jsx
    SearchPanel.jsx
    ScoutPanel.jsx
    JobList.jsx
    MatchPages.jsx
    ForBusinessesPage.jsx
    BusinessSignupPage.jsx
    PrivacyPage.jsx
    TermsPage.jsx
    PublicFooter.jsx
  hooks/
    useGeoJobs.js
    useJobs.js
    useScout.js
    useMediaQuery.js
```

## Deployment

The server ships as a container via `Dockerfile` and `cloudbuild.yaml` for Google Cloud Run. The client is configured for Netlify via `netlify.toml`.

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
- The matching flow is one business at a time; duplicate `Match us` requests are ignored while a business is already being checked.
- Older keyword job search API code remains in the backend, but the current UI is centered on the Scout workflow.

## License

MIT
