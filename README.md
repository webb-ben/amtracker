# Amtracker

A live Amtrak train map in the spirit of [amtraker.com/map](https://amtraker.com/map), built with
[MapLibre GL JS](https://maplibre.org) on an [Overture Maps](https://overturemaps.org) basemap.

- **Basemap**: Overture `base`, `transportation` and `divisions` PMTiles, read straight from
  `tiles.overturemaps.org` (see `src/style.js`; bump `OVERTURE_RELEASE` for new releases).
- **Trains and stations**: the [Amtraker v3 API](https://api-v3.amtraker.com/v3/trains), refreshed every 60 s.
- **Corridors and routes**: actual track geometry from Amtrak's GTFS `shapes.txt`, prebuilt into `data/`.
- **Motion**: between refreshes each train is dead-reckoned along its track at its last reported
  speed from its last position fix, holding at its next stop (`src/motion.js`). Below zoom 7 a
  train is drawn as a short slice of its own track so it bends with the rails.
- **Stations**: click one for a departures/arrivals board.
- **Sharing**: selecting a train puts `?train=<id>` in the URL (a bare train number works too);
  `?station=<code>` opens a station's board. The `#zoom/lat/lon` part is the map view.
- **Sprites**: pixel-art locomotives and cars drawn from character grids in `src/sprites.js`; preview
  them at `sprites.html`. From zoom 7 each vehicle is its own sprite placed on the track, and cars
  are coupled on as you zoom in.

## Run

No build step. Serve the folder over HTTP (ES modules don't load from `file://`):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Refresh route data

Amtrak's schedule changes a few times a year. Rebuild `data/routes.geojson` and
`data/train-shapes.json` from the current feed with:

```sh
python3 scripts/build_routes.py            # downloads GTFS.zip
python3 scripts/build_routes.py GTFS.zip   # or use a local copy
```
