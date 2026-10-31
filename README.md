# Amtracker

A live Amtrak train map in the spirit of [amtraker.com/map](https://amtraker.com/map), built with
[MapLibre GL JS](https://maplibre.org) on an [Overture Maps](https://overturemaps.org) basemap.

- **Basemap**: Overture `base` and `transportation` PMTiles, read straight from
  `tiles.overturemaps.org` (see `src/style.js`; bump `OVERTURE_RELEASE` for new releases). Active
  mainline is styled as freight rail unless Overture flags it passenger-only; abandoned and disused
  track is hidden. Overture's rail data starts at zoom 8.
- **Trains and stations**: the [Amtraker v3 API](https://api-v3.amtraker.com/v3/trains), refreshed every 60 s.
- **Corridors and routes**: actual track geometry from Amtrak's GTFS `shapes.txt`, prebuilt into `data/`.
- **Motion**: between refreshes each train is dead-reckoned along its track at its last reported
  speed from its last position fix, holding at its next stop (`src/motion.js`). Below zoom 8 a
  train is drawn as a short slice of its own track so it bends with the rails.
- **Stations**: click one for a departures/arrivals board.
- **Sharing**: selecting a train puts `?train=<id>` in the URL (a bare train number works too);
  `?station=<code>` opens a station's board. The `#zoom/lat/lon` part is the map view.
- **Sprites**: pixel-art locomotives and cars drawn from character grids in `src/sprites.js`; preview
  them at `sprites.html`. From zoom 8 each vehicle is its own sprite placed on the track, and cars
  are coupled on as you zoom in.

## Run

No build step. Serve the folder over HTTP (ES modules don't load from `file://`):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Speed heatmap

`.github/workflows/speed-heatmap.yml` samples live train speeds every 10 minutes
(`scripts/speed/collect.py`), snapping each moving train to a ~1 km segment of its GTFS route.
Daily totals and the 30-day average (`scripts/speed/build.py` → `speed-segments.geojson`) live on
the orphan `speed-data` branch, which is force-pushed as a single commit each run. The page reads
the heatmap straight from that branch via raw.githubusercontent.com; turn it on with the
"Speed heatmap" toggle or `?speed=1`. Samples are also bucketed into six 4-hour slices of the
day on each train's local clock, so the heatmap can show, say, evening rush hour on its own (the
"Time of day" menu, or `?speedtime=0`–`5`).

To try it with your own samples locally (a local `data/speed-segments.geojson` takes precedence
on localhost):

```sh
python3 scripts/speed/collect.py /tmp/speed        # run a few times, minutes apart
python3 scripts/speed/build.py /tmp/speed data/speed-segments.geojson
```

## Deploy

Pushes to `main` publish the site to GitHub Pages via `.github/workflows/pages.yml`
(it copies `index.html`, `sprites.html`, `src/` and `data/`; there is no build step).

## Station tracks

Some GTFS shapes miss the platform tracks a train really uses (e.g. Keystone trains at
Philadelphia 30th Street). For about 40 major stations, `data/station-tracks.geojson` holds the
active rail lines within 1.5 km, taken from Overture's transportation tiles and cleaned into a
navigable network (`scripts/clean_station_tracks.mjs`): pieces are snapped and joined across small
gaps, and yards, sidings and stray track away from Amtrak's routes are pruned. At runtime these are
chained into one straight main track per station, which every train near the station follows
instead of its GTFS shape, so trains standing side by side line up in parallel lanes. Rebuild with:

```sh
npm install && npm run station-tracks
```

To re-run only the cleanup on the existing file: `npm run station-tracks:clean`.

## Refresh route data

Amtrak's schedule changes a few times a year. Rebuild `data/routes.geojson` and
`data/train-shapes.json` from the current feed with:

```sh
python3 scripts/build_routes.py            # downloads GTFS.zip
python3 scripts/build_routes.py GTFS.zip   # or use a local copy
```
