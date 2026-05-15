# jobmap 🗺️

**Find jobs on a map.** Job boards suck for understanding *where* you'd actually be living. This fixes that.

Search for any job title and see results plotted geographically — spot clusters, compare commutes, understand the real job landscape before you start applying.

![jobmap screenshot](screenshot.png)

## Why this exists

Every job board shows jobs as a list. But when you're making a career move, geography matters enormously — which cities have density, where can you afford to live, how does a role in Austin vs NYC vs remote actually compare? jobmap makes this visible.

## Features

- 🔍 Search any job title, role, or company
- 🌎 Jobs plotted on an interactive map with clustering  
- 📋 Sidebar list with salary, posted date, direct apply links
- 🗓️ Filter by date posted (today, 3 days, week, month)
- ⚡ 1-hour result caching so you're not burning API credits
- 🌐 Remote/unlocated jobs listed separately so nothing gets lost

## Stack

- **Frontend**: Vite + React, Mapbox GL JS
- **Backend**: Express (API key proxy + caching)
- **Job data**: [SerpApi](https://serpapi.com) → Google Jobs
- **Geocoding**: Mapbox Geocoding API

## Setup

### Prerequisites

- Node.js 18+
- A [SerpApi](https://serpapi.com) account (~$50/mo at moderate volume, free trial available)
- A [Mapbox](https://account.mapbox.com) account (free tier: 50k map loads/mo)

### Install

```bash
git clone https://github.com/yourusername/jobmap
cd jobmap
npm run install:all
```

### Configure

```bash
# Server keys
cp server/.env.example server/.env
# Fill in SERP_API_KEY and MAPBOX_TOKEN

# Client key (Mapbox public token)
cp client/.env.example client/.env.local
# Fill in VITE_MAPBOX_TOKEN
```

### Run

```bash
npm run dev
```

Open http://localhost:5173

## Project Structure

```
jobmap/
├── server/          # Express API proxy + cache
│   └── index.js     # Job search + geocoding endpoint
└── client/          # Vite + React frontend
    └── src/
        ├── App.jsx
        ├── components/
        │   ├── Map.jsx        # Mapbox GL map
        │   ├── SearchPanel.jsx
        │   └── JobList.jsx
        └── hooks/
            └── useJobs.js
```

## How geocoding works

Most job listings say "Salt Lake City, UT" not an address. The server:
1. Deduplicates all unique location strings from results
2. Geocodes them in parallel via Mapbox (city/place level)
3. Caches results for 1 hour
4. Returns `lat`/`lng` with each job for the map to plot

Jobs that can't be geocoded (fully remote, etc.) still appear in the sidebar list.

## Contributing

This is scratching a real itch — PRs welcome. Good first issues:
- [ ] Save searches / bookmark jobs
- [ ] Commute time layer (how far is each job from a given address?)
- [ ] Salary filter
- [ ] Export results as CSV
- [ ] Better remote job handling

## License

MIT
