# HireNear Scout — Website-First Neighborhood Job Scout

## Vision

The founder's origin story: laid off from Paramount in 2024, manually walked Google Maps street-by-street through Santa Monica, visiting every local business's career page to find matches. This feature digitizes that exact experience.

**Product framing:** A game that helps you job hunt. People already spend hours on Indeed/LinkedIn — this redirects that time into something spatial and momentum-driven. The map is the game board. Each business is a door to knock on. The user is the player making real decisions, not watching a bot run.

**Long-term arc:** A Steam-released walking sim where your avatar literally pounds the pavement through a real neighborhood. The browser MVP must nail the core interaction loop first.

**The "do you want to visit?" moment is the handshake.** It puts the user in control, throttles crawling naturally at human speed, and makes each result feel earned — like actually walking up to a door.

---

## Core Interaction Loop (turn-based)

1. Scout finds the next nearby business, pre-fetches basic info
2. User sees a card: name, type, rating, distance — **"Visit this place?"**
3. User clicks Visit → browser inspects the website in the background
4. Result appears: hiring signal + resume fit score + suggested next step
5. User chooses: **Apply** / **Save** / **Keep walking**
6. Scout walks to the next business

---

## V1 Scope

- Resume input = paste text only (no PDF upload)
- Website inspection = rules-based browser checks (no LLM browsing)
- LLM = resume-fit ranking only
- No form submission, no apply actions
- Hirenear sends a single notification email to businesses where a candidate scores 80% fit or above, if a contact email was found on their public website. No email is sent more than once per business per scout run.
- SearchAPI = fallback/supplement when website evidence is weak
- Report persists in Postgres; inspection results cached by domain with 48h TTL
- User-paced: Playwright only fires when user clicks Visit

---

## Privacy & Ethics Hard Rules

- Never submit forms
- Never bypass auth or solve CAPTCHAs
- Never follow links off the business domain
- Respect `robots.txt` — check before visiting any path
- User-Agent: `HireNear-Scout/1.0 (+https://hirenear.com/bot)`
- Resume text: never log, auto-delete from DB after 30 days
- Disclose in UI: "Your resume is sent to Claude's API for matching and deleted after 30 days"

---

## Infrastructure

### Postgres (Postgres.app, run `createdb hirenear` once)

**`scout_runs`**
```sql
id SERIAL PRIMARY KEY,
resume_text TEXT,
lat DOUBLE PRECISION,
lng DOUBLE PRECISION,
radius INTEGER,
location_label TEXT,
status TEXT DEFAULT 'queued',  -- queued | running | done | failed
created_at TIMESTAMPTZ DEFAULT now(),
completed_at TIMESTAMPTZ
```

**`scout_businesses`**
```sql
id SERIAL PRIMARY KEY,
run_id INTEGER REFERENCES scout_runs(id),
place_id TEXT,
name TEXT,
website_url TEXT,
vicinity TEXT,
lat DOUBLE PRECISION,
lng DOUBLE PRECISION,
rating NUMERIC,
inspection_status TEXT DEFAULT 'queued',  -- queued | checking | done | failed | skipped
hiring_signal TEXT,                        -- strong | weak | none
fit_score INTEGER,                         -- 0-100
fit_reason TEXT,
next_step TEXT,
evidence_urls JSONB,
created_at TIMESTAMPTZ DEFAULT now(),
updated_at TIMESTAMPTZ DEFAULT now()
```

**`business_inspections`** (cross-run cache by domain)
```sql
domain TEXT PRIMARY KEY,
hiring_signal TEXT,
evidence_urls JSONB,
raw_text_excerpt TEXT,
inspected_at TIMESTAMPTZ DEFAULT now(),
ttl_hours INTEGER DEFAULT 48
```

---

## New Server Files

### `server/db.js`
- `pg` client reading `DATABASE_URL`
- Query helper + getters per table
- Idempotent `CREATE TABLE IF NOT EXISTS` migrations on startup

### `server/websiteInspector.js`
- `inspectBusiness(websiteUrl)` — Playwright chromium, headless
- Budget: max 5 pages, max 20 seconds, same domain only
- Page sequence: homepage → `/careers`, `/jobs`, `/work-with-us`, `/join`, `/about/careers`, `/contact`, `/apply`
- Strong signals: "current openings", "apply now", "we're hiring", resume upload form
- Weak signals: contact page, "send your resume", `hiring@` email visible
- Returns `{ hiringSignal, evidenceUrls, rawTextExcerpt }`
- Graceful fallback on timeout/bot-block: `{ hiringSignal: 'none', evidenceUrls: [], rawTextExcerpt: '' }`

### `server/resumeMatcher.js`
- `matchResumeToJob(resumeText, business, evidence, anthropicClient)`
- System prompt: "You are a hyper-local job scout. Respond with JSON only."
- Response shape: `{ matchLevel, fitScore, reason, nextStep }`
- Resume text sent with `cache_control: { type: 'ephemeral' }` — cached across the whole run
- Model: `ANTHROPIC_MODEL` env var, default `claude-sonnet-4-6`

### `server/scoutRunner.js`

**Phase 1 — `initScout(runId, db, cache, emitter)`** (auto, on run creation)
1. `fetchNearbyPlaces` → `filterAndRankPlaces` (reuse from `geoSearch.js`)
2. Insert all places as `scout_businesses` with status `queued`
3. Emit SSE `{ type: 'businesses_loaded', businesses: [...] }`

**Phase 2 — `inspectBusiness(runId, placeId, db, cache, emitter)`** (user-triggered)
1. Set status `checking`; emit SSE
2. Check `business_inspections` cache by domain — reuse if fresh
3. Run `websiteInspector.inspectBusiness()` if not cached
4. Fallback to `searchJobsForCompany()` if signal is weak/none
5. Run `resumeMatcher.matchResumeToJob()`
6. Save to DB; emit SSE `{ type: 'business_update', business: {...} }`

**`skipBusiness(runId, placeId, db)`** (user-triggered)
- Sets status `skipped`; no Playwright, no Claude

---

## New API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/scout-runs` | Create run, return `{ runId }` |
| `GET` | `/api/scout-runs/:runId` | Full run + businesses (for page refresh) |
| `GET` | `/api/scout-runs/:runId/events` | SSE stream |
| `POST` | `/api/scout-runs/:runId/visit/:placeId` | Trigger website inspection |
| `POST` | `/api/scout-runs/:runId/skip/:placeId` | Mark skipped |

SSE event types: `businesses_loaded`, `business_update`, `heartbeat`

---

## New Client Files

### `client/src/hooks/useScout.js`
- State: `resumeText`, `status`, `businesses[]`, `runId`
- `startScout()` → POST → SSE connection
- Upserts businesses on each `business_update` event
- `visit(placeId)` / `skip(placeId)` → POST the action endpoints
- `loadRun(runId)` → GET for page-refresh restore

### `client/src/components/ScoutPanel.jsx`

**Idle:** Resume textarea + radius picker + "Scout this area" button

**Running:**
- Top card: next business waiting for decision — **Visit** / **Skip**
- While inspecting: "Knocking on door..." animation
- On result: hiring signal badge + fit score + reason + next step + **Apply** / **Save** / **Keep walking**
- Below: scrollable log of visited/skipped businesses

**Done:** Ranked report (saved → strong → moderate → weak → none → skipped) + Claude summary

---

## Files to Modify

| File | Change |
|---|---|
| `server/index.js` | Add scout routes, import db/scoutRunner, add `ANTHROPIC_API_KEY` env check |
| `server/geoSearch.js` | Add `websiteUri` to `X-Goog-FieldMask`; expose on normalized place object |
| `client/src/App.jsx` | Add `'scout'` mode; wire `useScout` hook |
| `client/src/components/SearchPanel.jsx` | Add "Scout" pill to mode toggle |
| `client/src/components/Map.jsx` | Color-coded markers per scout status |
| `client/src/components/JobList.jsx` | Render `ScoutPanel` in scout mode |

---

## Map Marker Colors

| Status | Color |
|---|---|
| `queued` | gray |
| `checking` | amber |
| `strong` | green |
| `weak` | blue |
| `none` | light gray |
| `skipped` | white/outline |
| `failed` | red |

---

## Dependencies to Add

**Server:** `@anthropic-ai/sdk`, `playwright`, `pg`

**New env vars:**
```
ANTHROPIC_API_KEY=...
ANTHROPIC_MODEL=claude-sonnet-4-6
DATABASE_URL=postgres://localhost:5432/hirenear
```

---

## Test Plan

- Unit: website classifier with HTML fixtures (strong/weak/none/no-signal pages)
- Unit: resume-fit prompt parser with mocked Claude response
- Integration: scout run creation + Postgres persistence
- Integration: SSE emits correct event sequence
- Manual: paste resume → drop SLC pin → scout → verify live map updates + report persists on refresh
