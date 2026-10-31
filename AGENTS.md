# Agent notes

A live Amtrak train map: MapLibre GL JS on an Overture Maps basemap, fed by the Amtraker v3 API.
See `README.md` for what the site does and how the data pipelines work; this file is about working
on the code.

## Layout

- `index.html` – the whole page; no framework, no bundler.
- `src/app.js` – state, data refresh, map layers, train placement (lanes, lane rails, crossovers),
  the side panel, train detail and the station board. One file, split into sections by
  `// ----` banners.
- `src/motion.js` – dead reckoning: `planMotion` snaps a train to its track and
  `positionAt(plan, now, behind)` extrapolates it (a negative `behind` is ahead of the nose).
- `src/sprites.js` – pixel-art vehicles as character grids plus a palette; `sprites.html` previews them.
- `src/icon.js` – header logo and animated favicon. `npm run icons` rewrites `favicon.svg` from it.
- `src/style.js` – the basemap style (Overture PMTiles; `OVERTURE_RELEASE` pins the release).
- `data/` – prebuilt GTFS routes, train → shape map and station tracks; rebuilt by `scripts/`.
- `scripts/speed/` – the speed-heatmap collector, run by `.github/workflows/speed-heatmap.yml`,
  which publishes to the `speed-data` branch.

## Run and check

- No build step. Serve the repo root (`python3 -m http.server 8780`) and open it. ES modules
  don't load from `file://`.
- `node --check src/app.js` catches syntax errors; there's no test suite.
- To look at the map headless, Chrome needs software WebGL or MapLibre never starts:
  `--headless=new --use-angle=swiftshader --enable-unsafe-swiftshader --virtual-time-budget=20000`.
  A view goes in the hash (`#zoom/lat/lon`) and a train in the query (`?train=99`).
- Live data changes minute to minute, so check a fix against the API
  (`https://api-v3.amtraker.com/v3/trains/<num>`) as well as on the map.

## Conventions

- Plain modern JavaScript in ES modules, no dependencies in the page beyond MapLibre and PMTiles
  from unpkg. `package.json` holds build tooling only.
- Match the surrounding style: short comments that say why, named constants for tuning numbers
  (`STATION_TRACK_M`, `SWITCH_ROWS_PER_LANE`, …), small helpers over clever one-offs.
- Fix behaviour generally, not for one station or train. Boston, New York Penn and Washington are
  good stress cases (crowded terminals, curves, odd track data), not things to special-case.
- Treat the Amtraker feed as messy: stop statuses go stale (`reconcileStops` checks them against
  the timetable), fixes scatter along platforms, and pre-departure trains can sit at their origin
  for hours.
- Theme colours are CSS custom properties on `:root`, overridden in both the
  `prefers-color-scheme: dark` block and `:root[data-theme="dark"]`; keep the two in step.
- Respect `prefers-reduced-motion` for anything animated.
- Don't commit generated caches (`__pycache__/` is ignored).
