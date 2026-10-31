import { buildStyle } from "./style.js";
import { buildSprites, buildArrow, buildSpeedLoco, spriteImageData, SCALE, VEHICLE } from "./sprites.js";
import { planMotion, positionAt, trailAt, hasArrived, travelledAt, metersAheadTo, sliceTrack } from "./motion.js";
import { animateIcon } from "./icon.js";

const API = "https://api-v3.amtraker.com/v3";
const REFRESH_MS = 60_000;
const MOTION_MS = 100; // how often extrapolated positions are redrawn
const SPRITE_ZOOM = 8; // below this, trains are drawn as a slice of track instead of a sprite
const CAR_ZOOMS = [10, 11.5, 12.5, 13.25, 14, 14.75]; // zoom at which the 1st, 2nd, … car is coupled on behind the loco
const ICON_SIZE = [7, 0.6, 12, 0.95, 15, 1.6]; // [zoom, size, …] for vehicle sprites
const TRAIL_PX = 26; // on-screen length of a low-zoom train

// [mph, color] stops for the speed heatmap: slow is deep purple, fast is bright yellow.
const SPEED_RAMP = [
  [15, "#4a1486"],
  [35, "#9c179e"],
  [55, "#d8576b"],
  [75, "#f89540"],
  [100, "#f0f921"],
];

const AMTRAK_RED = "#c8102e";
const STALE_MIN = 10; // a position fix older than this many minutes is flagged as stale
const STALE_OPACITY = ["case", ["get", "stale"], 0.45, 1]; // stale trains are faded on the map
const ARRIVING_M = 1500; // a moving train this close to its next stop is "now arriving"
const NUMBER_ZOOM = 11; // from here the train number is painted on the first car instead of labelled beside it
const NUMBER_SIZE = [NUMBER_ZOOM, 10, 12, 12, 15, 21]; // [zoom, text size, …] for the painted number
// Tried in order when trains overlap. Trains only ever step to their own right (positive lanes
// are right of travel), so they never cut across each other: two trains heading opposite ways
// pass on opposite sides, like right-hand running.
const LANES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
// Stopped trains never cross anything, so in a crowded station they pack in on either side.
const PARKED_LANES = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6];
// Lanes are worked out as if the map were at this zoom, so a train keeps its lane while you
// zoom instead of shuffling as on-screen distances shrink and grow.
const LANE_REF_ZOOM = 14;
// Trains are drawn with the narrow sprites and thin trails so side-by-side lanes pack tightly.
const CAR_PX = 12; // drawn car width in icon pixels (8 art px × 1.5)
const LANE_ICON_PX = 12.5; // lane spacing for sprites, in icon pixels (scaled by icon-size): cars almost touching
const TRAIL_PX_WIDTH = 4; // low-zoom trail casing width
const LANE_TRAIL_PX = 5; // lane spacing for low-zoom trails, in screen pixels
const NARROW_TEXT = 0.75; // painted-number size on the narrow cars, relative to NUMBER_SIZE
// Crossovers, in art pixels along the train (a car is 21 rows, the loco 23).
// Length of the crossover each vehicle runs through, per lane crossed, so it never swings more
// than about 10° off the track (a lane is 12.5 / 1.5 ≈ 8 art px across; smoothstep's steepest
// slope is 1.5× its average).
const SWITCH_ROWS_PER_LANE = 70;
const SWITCH_STALL_ROWS_PER_S = 40; // how fast a crossover finishes once the train has stopped
const TRAIN_ROWS = 23 + 6 * 21; // longest train (loco + six cars), bounds when a crossover is done
const SETTLE_MS = 3000; // lanes snap into place (no crossovers) this long after the first draw
const HEAD_ICON_SIZE = 0.55; // icon-size of the low-zoom direction arrow

const HEADING_DEG = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const sprites = buildSprites();
const spriteUrls = Object.fromEntries(Object.entries(sprites).map(([k, c]) => [k, c.toDataURL()]));

// Direction arrows are coloured by the train's current speed on the heatmap ramp (one image per
// 10 mph band) and stack more chevrons as it speeds up; a stopped train gets a flat grey bar.
const ARROW_STEP = 10;
const CHEVRON_MPH = [40, 70]; // a second chevron from 40 mph, a third from 70
// Each also has a "-narrow" variant for trains drawn side by side.
const arrows = {};
for (const thin of [false, true]) {
  const suffix = thin ? "-narrow" : "";
  arrows[`arrow-stopped${suffix}`] = buildArrow("#9aa3b2", 0, { thin });
  for (let mph = 0; mph <= SPEED_RAMP.at(-1)[0]; mph += ARROW_STEP) {
    arrows[`arrow-${mph}${suffix}`] = buildArrow(speedColor(mph), 1 + CHEVRON_MPH.filter((m) => mph >= m).length, { thin });
  }
}

// Zoomed in, a moving loco is painted the same speed colour (one image per 10 mph band).
for (let mph = 0; mph <= SPEED_RAMP.at(-1)[0]; mph += ARROW_STEP) arrows[`loco-speed-${mph}`] = buildSpeedLoco(speedColor(mph));

function speedLocoImage(t) {
  return `loco-speed-${Math.min(SPEED_RAMP.at(-1)[0], Math.round(Math.max(0, t.velocity ?? 0) / ARROW_STEP) * ARROW_STEP)}`;
}

// Parked at a station: nothing in front of the train. Stopped elsewhere: a flat bar.
function arrowImage(t) {
  const mph = t.velocity ?? 0;
  if (!isMoving(t)) return stopContext(t, false).at ? null : "arrow-stopped";
  return `arrow-${Math.min(SPEED_RAMP.at(-1)[0], Math.round(mph / ARROW_STEP) * ARROW_STEP)}`;
}

// Interpolated hex colour for a speed, matching the heatmap's line-color expression.
function speedColor(mph) {
  const i = SPEED_RAMP.findIndex(([stop]) => mph <= stop);
  if (i <= 0) return SPEED_RAMP[i < 0 ? SPEED_RAMP.length - 1 : 0][1];
  const [[m0, c0], [m1, c1]] = [SPEED_RAMP[i - 1], SPEED_RAMP[i]];
  const u = (mph - m0) / (m1 - m0);
  const rgb = (c) => [1, 3, 5].map((j) => parseInt(c.slice(j, j + 2), 16));
  const [a, b] = [rgb(c0), rgb(c1)];
  return (
    "#" +
    a
      .map((v, j) =>
        Math.round(v + (b[j] - v) * u)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

const state = {
  trains: [], // flattened list of train objects
  stations: {},
  selectedId: null,
  query: "",
  routes: { type: "FeatureCollection", features: [] }, // GTFS track geometry, see scripts/build_routes.py
  trainShapes: {}, // train number -> shape id
  shapeCoords: new Map(), // shape id -> [lon, lat][]
  plans: new Map(), // trainID -> dead-reckoning plan, rebuilt on every refresh
  stationTrackFeatures: [], // rail lines around major stations, from data/station-tracks.geojson
  stationTracks: [], // one main track per station, built from those once the stations load
  lanes: new Map(), // trainID -> lane it was drawn in last frame, so lanes stick
  laneAnims: new Map(), // trainID -> { from, to, start } crossover between lanes
  settleUntil: 0, // crossovers are skipped until this time, so the first layout just snaps
  crossing: false, // any crossover in progress (animate every frame)
  loaded: false, // first successful fetch applies ?train= / ?station=
  speed: null, // 30-day speed heatmap, fetched the first time it's switched on
  showSpeed: false,
  speedPeriod: "", // heatmap time of day: "" all day, or "0".."5" (see SPEED_PERIODS)
  showTrains: true,
  theme: preferredTheme(),
  trip: null, // { trainID, from, to, follow, fromAuto, editing } while tracking a trip (see "My trip")
  me: null, // { lon, lat } from the browser while a trip uses your location
  meError: null,
};

// A shared link may carry its own view (#zoom/lat/lon); read this before MapLibre writes a default.
const linkHasView = /^#[\d.]+\/[-\d.]+\/[-\d.]+/.test(location.hash);

// ---------------------------------------------------------------------------
// Map

const map = new maplibregl.Map({
  container: "map",
  style: buildStyle(state.theme),
  center: [-96, 39],
  zoom: 3.6,
  minZoom: 2,
  maxZoom: 15,
  // Overture tiles are detailed and heavy; keep only a screenful or so of them per source
  // instead of MapLibre's default of five zoom levels' worth.
  maxTileCacheSize: 30,
  maxTileCacheZoomLevels: 1,
  hash: true,
  attributionControl: { compact: true, customAttribution: 'Train data <a href="https://amtraker.com">Amtraker</a>' },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "bottom-right");

map.on("style.load", addOverlays);

function addOverlays() {
  for (const [id, canvas] of Object.entries(sprites)) {
    if (!id.startsWith("side-") && id !== "station" && !map.hasImage(id)) {
      map.addImage(id, spriteImageData(canvas), { pixelRatio: SCALE / 1.5 });
    }
  }

  map.addSource("corridors", { type: "geojson", data: state.routes });
  map.addSource("route", { type: "geojson", data: routeGeoJSON() });
  map.addSource("stations", { type: "geojson", data: stationsGeoJSON() });
  for (const [id, canvas] of Object.entries(arrows)) {
    if (!map.hasImage(id)) map.addImage(id, spriteImageData(canvas), { pixelRatio: SCALE / 1.5 });
  }

  const { points, trails, vehicles } = trainFeatures();
  map.addSource("trains", { type: "geojson", data: points });
  map.addSource("train-trails", { type: "geojson", data: trails });
  map.addSource("train-vehicles", { type: "geojson", data: vehicles });

  const dark = state.theme === "dark";
  const accent = dark ? "#7ea2ff" : "#2f5bc4";
  // Amtrak corridors from GTFS, visible at every zoom; sits under basemap labels.
  map.addLayer(
    {
      id: "corridors",
      type: "line",
      source: "corridors",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": dark ? "#55638a" : "#8d9ccb",
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 3, 0.9, 10, 0.6],
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 1.2, 8, 2, 13, 3],
      },
    },
    "water-labels",
  );
  // 30-day average speed per ~1 km of track, from scripts/speed (see the speed-heatmap workflow).
  map.addSource("speed", { type: "geojson", data: state.speed ?? { type: "FeatureCollection", features: [] } });
  map.addLayer(
    {
      id: "speed-heatmap",
      type: "line",
      source: "speed",
      filter: ["has", speedProp()],
      layout: { "line-join": "round", "line-cap": "round", visibility: state.showSpeed ? "visible" : "none" },
      paint: {
        "line-color": speedColorExpr(),
        "line-width": ["interpolate", ["linear"], ["zoom"], 3, 2.5, 8, 4, 13, 7],
      },
    },
    "water-labels",
  );
  map.addLayer(
    {
      id: "route-casing",
      type: "line",
      source: "route",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": dark ? "#0f1116" : "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 5, 12, 9] },
    },
    "water-labels",
  );
  const routeWidth = ["interpolate", ["linear"], ["zoom"], 3, 2.5, 12, 5];
  map.addLayer(
    {
      id: "route-line",
      type: "line",
      source: "route",
      filter: ["!", ["get", "approx"]],
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": accent, "line-width": routeWidth },
    },
    "water-labels",
  );
  map.addLayer(
    {
      id: "route-line-approx",
      type: "line",
      source: "route",
      filter: ["get", "approx"],
      paint: { "line-color": accent, "line-width": routeWidth, "line-dasharray": [1, 1.5] },
    },
    "water-labels",
  );
  // Your leg of a tracked trip, bolder than the rest of the route (which fades; see applyTripStyle).
  map.addSource("trip-leg", { type: "geojson", data: tripLegGeoJSON() });
  map.addLayer(
    {
      id: "trip-leg-casing",
      type: "line",
      source: "trip-leg",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": dark ? "#0f1116" : "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 3, 8, 12, 14] },
    },
    "water-labels",
  );
  map.addLayer(
    {
      id: "trip-leg",
      type: "line",
      source: "trip-leg",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": accent, "line-width": ["interpolate", ["linear"], ["zoom"], 3, 5, 12, 9] },
    },
    "water-labels",
  );
  map.addLayer({
    id: "stations",
    type: "circle",
    source: "stations",
    paint: {
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        3,
        ["case", ["get", "tripEnd"], 6, ["get", "onRoute"], 4, 1.6],
        10,
        ["case", ["get", "tripEnd"], 10, ["get", "onRoute"], 7, 5],
      ],
      "circle-color": ["case", ["get", "onRoute"], ["get", "stopColor"], dark ? "#cfd3dc" : "#ffffff"],
      "circle-stroke-color": dark ? "#0f1116" : "#2b2f3a",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 3, 0.6, 10, 1.5],
    },
  });
  map.addLayer({
    id: "station-labels",
    type: "symbol",
    source: "stations",
    minzoom: 7,
    layout: {
      "text-field": ["get", "code"],
      "text-font": ["Noto Sans Medium"],
      "text-size": 11,
      "text-offset": [0, 1.1],
      "text-anchor": "top",
    },
    paint: { "text-color": dark ? "#d6d6dc" : "#2b2f3a", "text-halo-color": dark ? "#0f1116" : "#ffffff", "text-halo-width": 1.4 },
  });
  // Low zoom: each train is a short stretch of its own track, so it bends with the rails.
  map.addLayer({
    id: "train-trail-casing",
    type: "line",
    source: "train-trails",
    maxzoom: SPRITE_ZOOM,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#141a28",
      "line-width": ["+", ["get", "trailWidth"], ["case", ["get", "selected"], 2, 0]],
      "line-offset": ["get", "lineOffset"],
      "line-opacity": STALE_OPACITY,
    },
  });
  map.addLayer({
    id: "train-trail",
    type: "line",
    source: "train-trails",
    maxzoom: SPRITE_ZOOM,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#2f5bc4",
      "line-width": ["+", ["*", ["get", "trailWidth"], 0.65], ["case", ["get", "selected"], 1.5, 0]],
      "line-offset": ["get", "lineOffset"],
      "line-opacity": STALE_OPACITY,
    },
  });
  map.addLayer({
    id: "train-trail-stripe",
    type: "line",
    source: "train-trails",
    maxzoom: SPRITE_ZOOM,
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": "#e9edf3", "line-width": ["*", ["get", "trailWidth"], 0.17], "line-offset": ["get", "lineOffset"], "line-opacity": STALE_OPACITY },
  });
  map.addLayer({
    id: "train-heads",
    type: "symbol",
    source: "trains",
    maxzoom: SPRITE_ZOOM,
    layout: {
      "icon-image": ["coalesce", ["get", "arrow"], ""], // no arrow while parked at a station
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-size": HEAD_ICON_SIZE,
      "icon-offset": ["coalesce", ["get", "headOffset"], ["literal", [0, 0]]], // unset for trains outside the view
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "text-field": ["get", "trainNum"],
      "text-font": ["Noto Sans Medium"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 10, 12],
      "text-radial-offset": 1.6,
      "text-variable-anchor": ["top", "bottom", "left", "right"],
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: {
      "text-color": ["get", "textColor"],
      "text-halo-color": ["get", "iconColor"],
      "text-halo-width": 3,
      "icon-opacity": STALE_OPACITY,
    },
  });
  // Zoomed in: one sprite per vehicle, each placed on the track at its own bearing.
  map.addLayer({
    id: "train-vehicles",
    type: "symbol",
    source: "train-vehicles",
    minzoom: SPRITE_ZOOM,
    layout: {
      "icon-image": ["get", "image"],
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-size": ["interpolate", ["linear"], ["zoom"], ...ICON_SIZE],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "symbol-sort-key": ["case", ["get", "selected"], 1, 0],
      "symbol-z-order": "source",
    },
    paint: { "icon-opacity": STALE_OPACITY },
  });
  // Train number painted on the first car in Amtrak red, once the cars are big enough to hold it.
  // The font server has no bold weight, so a white-outlined copy sits under a copy whose red halo
  // thickens the strokes.
  const numberLayout = {
    "text-field": ["get", "trainNum"],
    "text-font": ["Noto Sans Medium"],
    // Scaled down so the number fits across the narrow cars.
    "text-size": ["interpolate", ["linear"], ["zoom"], ...NUMBER_SIZE.map((v, i) => (i % 2 ? v * NARROW_TEXT : v))],
    "text-rotate": ["get", "textRotate"],
    "text-rotation-alignment": "map",
    "text-allow-overlap": true,
    "text-ignore-placement": true,
  };
  const numberLayer = (id, paint) => ({
    id,
    type: "symbol",
    source: "train-vehicles",
    minzoom: NUMBER_ZOOM,
    filter: ["==", ["get", "numbered"], true],
    layout: numberLayout,
    paint,
  });
  map.addLayer(
    numberLayer("train-numbers-outline", { "text-color": AMTRAK_RED, "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.6, "text-opacity": STALE_OPACITY }),
  );
  map.addLayer(numberLayer("train-numbers", { "text-color": AMTRAK_RED, "text-halo-color": AMTRAK_RED, "text-halo-width": 0.6, "text-opacity": STALE_OPACITY }));
  // Train number label beside the train, until it's painted on the first car instead.
  map.addLayer({
    id: "trains",
    type: "symbol",
    source: "trains",
    minzoom: SPRITE_ZOOM,
    maxzoom: NUMBER_ZOOM,
    layout: {
      "text-field": ["get", "trainNum"],
      "text-font": ["Noto Sans Medium"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 3, 9, 10, 12],
      "text-radial-offset": 1.6,
      "text-variable-anchor": ["top", "bottom", "left", "right"],
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: {
      "text-color": ["get", "textColor"],
      "text-halo-color": ["get", "iconColor"],
      "text-halo-width": 3,
    },
  });
  // You, while a trip uses your location: on top of everything.
  map.addSource("me", { type: "geojson", data: meGeoJSON() });
  map.addLayer({ id: "me-halo", type: "circle", source: "me", paint: { "circle-radius": 16, "circle-color": "#1a73e8", "circle-opacity": 0.18 } });
  map.addLayer({
    id: "me",
    type: "circle",
    source: "me",
    paint: { "circle-radius": 7, "circle-color": "#1a73e8", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 },
  });
  applyTrainVisibility();
  applyTripStyle();
}

const TRAIN_LAYERS = ["train-vehicles", "trains", "train-heads", "train-trail-casing"];
const TRAIN_DRAW_LAYERS = [
  "train-trail-casing",
  "train-trail",
  "train-trail-stripe",
  "train-heads",
  "train-vehicles",
  "train-numbers-outline",
  "train-numbers",
  "trains",
];

function applyTrainVisibility() {
  for (const id of TRAIN_DRAW_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", state.showTrains ? "visible" : "none");
}
for (const layer of [...TRAIN_LAYERS, "stations"]) {
  map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
}

for (const layer of TRAIN_LAYERS) {
  map.on("click", layer, (e) => {
    const f = e.features[0];
    if (f) selectTrain(f.properties.trainID);
  });
}
map.on("click", "stations", (e) => {
  const trainLayers = TRAIN_LAYERS.filter((l) => map.getLayer(l));
  if (map.queryRenderedFeatures(e.point, { layers: trainLayers }).length) return;
  const f = e.features[0];
  if (f) showStation(f.properties.code);
});

// ---------------------------------------------------------------------------
// Data

async function refresh() {
  try {
    const [trainsRes, stationsRes] = await Promise.all([
      fetch(`${API}/trains`),
      Object.keys(state.stations).length ? null : fetch(`${API}/stations`),
      state.routes.features.length ? null : loadRoutes(),
    ]);
    const trains = await trainsRes.json();
    if (stationsRes) {
      state.stations = await stationsRes.json();
      state.stationTracks = stationSpines(state.stationTrackFeatures);
    }
    state.trains = Object.values(trains)
      .flat()
      .filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lon));
    state.trains.forEach((t) => reconcileStops(t));
    buildPlans();
    if (!state.loaded) {
      state.loaded = true;
      applyUrl();
    }
    setStatus(`${state.trains.length} trains · updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
  } catch (err) {
    console.error(err);
    setStatus("Couldn't reach the Amtraker API, retrying…");
  }
  render();
}

// The feed sometimes leaves stops stuck at "Station" after the train has left them: train 99
// can report Boston through New Rochelle as in-station while it's south of Baltimore. Check the
// statuses against the timetable before anything reads them. A stop is departed when a later stop
// already is, or when it's "Station" but its departure time (estimated, else scheduled) has
// passed and the train is nowhere near it; a far-off "Station" stop still to come is en route.
// A train that hasn't set off is left alone: the feed keeps late or cancelled ones at their
// origin with every stop "Station".
const STUCK_STATION_M = 2_000;

function reconcileStops(t, now = Date.now()) {
  const stops = t.stations ?? [];
  if (t.trainState === "Predeparture") return;
  const lastDeparted = stops.findLastIndex((s) => s.status === "Departed");
  stops.forEach((s, i) => {
    if (s.status === "Departed") return;
    const st = state.stations[s.code];
    const away = st && Number.isFinite(st.lat) ? metersBetween(t, st) > STUCK_STATION_M : false;
    const leaves = Date.parse(s.dep || s.schDep || s.arr || s.schArr);
    if (i < lastDeparted || (s.status === "Station" && away && leaves < now)) s.status = "Departed";
    else if (s.status === "Station" && away) s.status = "Enroute";
  });
}

function metersBetween(a, b) {
  return Math.hypot((b.lon - a.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (b.lat - a.lat) * 110_540);
}

async function loadRoutes() {
  try {
    const [routes, trainShapes] = await Promise.all([fetch("data/routes.geojson").then((r) => r.json()), fetch("data/train-shapes.json").then((r) => r.json())]);
    state.routes = routes;
    state.trainShapes = trainShapes;
    state.shapeCoords = new Map(routes.features.map((f) => [f.properties.shape, f.geometry.coordinates]));
    map.getSource("corridors")?.setData(routes);
  } catch (err) {
    console.warn("Route geometry unavailable; run scripts/build_routes.py", err);
  }
  try {
    state.stationTrackFeatures = (await fetch("data/station-tracks.geojson").then((r) => r.json())).features;
  } catch {
    state.stationTrackFeatures = []; // optional; built by `npm run station-tracks`
  }
}

function shapeFor(t) {
  return state.shapeCoords.get(state.trainShapes[t.trainNum]);
}

// Within a major station, the station's main track (see stationSpines) takes priority over the
// train's GTFS route shape, so every train there runs along the same straight line and the
// lanes stack them neatly side by side instead of each following a different shape.
function buildPlans() {
  state.plans = new Map(state.trains.map((t) => [t.trainID, planFor(t)]));
}

function planFor(t) {
  const next = nextStop(t);
  const st = next && state.stations[next.code];
  const stop = st && Number.isFinite(st.lat) ? st : undefined;
  const local = stationTrackFor(t);
  if (local) {
    const plan = planMotion(t, local, stop, HEADING_DEG[t.heading]);
    if (plan.kind === "track") return plan;
  }
  return planMotion(t, shapeFor(t), stop, HEADING_DEG[t.heading]);
}

const STATION_TRACK_M = 250; // how far a train may be from a station's main track to use it
const SPINE_CENTER_M = 200; // a station's main track must pass this close to the station
const CHAIN_TURN = 0.15; // radians; sharper joins are turnouts, not the same track

// Distance (m) from a [lon, lat] point to a line.
function distanceToLine([lon, lat], line) {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180);
  const here = [lon * kx, lat * 110_540];
  let d = Infinity;
  for (let i = 0; i < line.length - 1; i++) {
    d = Math.min(d, segmentDistance(here, here, [line[i][0] * kx, line[i][1] * 110_540], [line[i + 1][0] * kx, line[i + 1][1] * 110_540]));
  }
  return d;
}

// Nearest station main track to the train, if it's at one of the stations.
function stationTrackFor(t) {
  let best = null;
  for (const track of state.stationTracks) {
    const d = distanceToLine([t.lon, t.lat], track);
    if (d < STATION_TRACK_M && (!best || d < best.d)) best = { track, d };
  }
  return best?.track ?? null;
}

// One main track per station: the longest straight run of chained track passing by the station.
function stationSpines(features) {
  const byStation = Map.groupBy(features, (f) => f.properties.station);
  const spines = [];
  for (const [code, group] of byStation) {
    const st = state.stations[code];
    if (!st) continue;
    const center = [st.lon, st.lat];
    const length = (line) => line.slice(1).reduce((sum, c, i) => sum + Math.hypot((c[0] - line[i][0]) * Math.cos((c[1] * Math.PI) / 180), c[1] - line[i][1]), 0);
    const through = chainTracks(group)
      .flatMap(splitAtKinks)
      .filter((line) => distanceToLine(center, line) < SPINE_CENTER_M);
    const spine = through.sort((a, b) => length(b) - length(a))[0];
    if (spine) spines.push(spine);
  }
  return spines;
}

// Some extracted pieces fold back on themselves (New York Penn's run east, back west for over a
// kilometre, then east again), which would lay a train around a hairpin. Cut a line wherever it
// turns sharper than KINK_TURN between one segment and the next.
const KINK_TURN = Math.PI / 4;

function splitAtKinks(line) {
  const heading = (a, b) => Math.atan2((b[0] - a[0]) * Math.cos((a[1] * Math.PI) / 180), b[1] - a[1]);
  const parts = [[line[0], line[1]]];
  for (let i = 2; i < line.length; i++) {
    const turn = Math.abs(((heading(line[i - 1], line[i]) - heading(line[i - 2], line[i - 1]) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
    if (turn > KINK_TURN) parts.push([line[i - 1]]);
    parts.at(-1).push(line[i]);
  }
  return parts.filter((part) => part.length >= 2);
}

// The extracted station tracks arrive as short pieces (Overture segments, cut at tile edges).
// Join pieces that meet end to end and carry on in nearly the same direction, so a train has
// a continuous track through the station instead of running off the end of a 50 m stub.
function chainTracks(features) {
  const key = ([lon, lat]) => `${lon.toFixed(5)},${lat.toFixed(5)}`;
  const pieces = features.map((f) => f.geometry.coordinates);
  const ends = new Map(); // endpoint key -> pieces touching it
  pieces.forEach((p, i) => {
    for (const end of [p[0], p.at(-1)]) {
      const k = key(end);
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const heading = (a, b) => Math.atan2(b[0] - a[0], b[1] - a[1]);
  const used = new Set();
  // Extend `line` from its last point with the straightest unused piece that continues it.
  const extend = (line) => {
    for (;;) {
      const tip = line.at(-1);
      const dir = heading(line.at(-2), tip);
      let best = null;
      for (const j of ends.get(key(tip)) ?? []) {
        if (used.has(j)) continue;
        const p = key(pieces[j][0]) === key(tip) ? pieces[j] : [...pieces[j]].reverse();
        const turn = Math.abs(((heading(p[0], p[1]) - dir + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (turn < CHAIN_TURN && (!best || turn < best.turn)) best = { j, p, turn };
      }
      if (!best) return line;
      used.add(best.j);
      line.push(...best.p.slice(1));
    }
  };
  const tracks = [];
  pieces.forEach((p, i) => {
    if (used.has(i)) return;
    used.add(i);
    const forward = extend([...p]);
    tracks.push(extend(forward.reverse()));
  });
  return tracks;
}

function trainPosition(t, now = Date.now()) {
  const plan = state.plans.get(t.trainID);
  return plan ? positionAt(plan, now) : { lon: t.lon, lat: t.lat, bearing: HEADING_DEG[t.heading] ?? 0 };
}

// Point features drive the sprites, arrows and labels; line features are the low-zoom trains.
function iconSizeAt(zoom) {
  for (let i = 0; i < ICON_SIZE.length - 2; i += 2) {
    const [z0, s0, z1, s1] = ICON_SIZE.slice(i, i + 4);
    if (zoom <= z1) return s0 + (s1 - s0) * Math.max(0, (zoom - z0) / (z1 - z0));
  }
  return ICON_SIZE.at(-1);
}

function carsAt(zoom) {
  return CAR_ZOOMS.filter((z) => zoom >= z).length;
}

function numberSizeAt(zoom) {
  const [z0, s0, z1, s1, z2, s2] = NUMBER_SIZE;
  if (zoom <= z1) return s0 + (s1 - s0) * Math.max(0, (zoom - z0) / (z1 - z0));
  return s1 + (s2 - s1) * Math.min(1, (zoom - z1) / (z2 - z1));
}

// Locomotive plus however many cars this zoom allows, strung nose to tail along the train's
// lane rail (see laneRail): each vehicle is a chord whose ends both sit on the rail, so the
// consist bends with the track and stays coupled on the inside and outside of a curve alike.
// `laneOf(rows)` is the (possibly mid-crossover) lane `rows` art px behind the nose.
// `centreM` (stopped trains) is where the middle of the train goes, meters ahead of its position.
function vehicleFeatures(t, plan, now, zoom, metersPerPx, properties, laneOf, centreM = null) {
  const cars = carsAt(zoom);
  const pxPerArtPx = 1.5 * iconSizeAt(zoom);
  const trainRows = VEHICLE.locoLength + cars * (VEHICLE.gap + VEHICLE.carLength);
  // A moving train's position is its nose; a stopped one is centred (see parkedCentre), so
  // trains standing at a station sit side by side, engines at opposite ends.
  const lead = centreM === null ? 0 : trainRows / 2 + centreM / (pxPerArtPx * metersPerPx);
  const rail = laneRail(plan ?? { kind: "free", ...trainPosition(t, now), speed: 0, t0: now }, now, pxPerArtPx * metersPerPx, LANE_ICON_PX * iconSizeAt(zoom), laneOf, trainRows, lead);
  const suffix = "-narrow";
  const state = (properties.moving ? "move" : "idle") + suffix;
  const out = [];
  let at = rail.start;
  const place = (image, length, extra = {}) => {
    const rear = rail.chord(at, length * pxPerArtPx);
    const nose = map.unproject(at.point);
    const tail = map.unproject(rear.point);
    const kx = Math.cos((nose.lat * Math.PI) / 180);
    const bearing = ((Math.atan2((nose.lng - tail.lng) * kx, nose.lat - tail.lat) * 180) / Math.PI + 360) % 360;
    const center = map.unproject([(at.point[0] + rear.point[0]) / 2, (at.point[1] + rear.point[1]) / 2]);
    // The number runs along the car, turned so it never reads upside down. Near-vertical text
    // always reads bottom-to-top (flip window is 160–340°, not 180–360°) so a number like 89
    // can't wobble between orientations and read as 68.
    const flipped = bearing >= 160 && bearing < 340;
    const textRotate = flipped ? bearing + 90 : bearing - 90;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [center.lng, center.lat] },
      properties: { ...properties, ...extra, image, bearing, textRotate },
    });
    at = rear;
  };
  place(properties.moving ? speedLocoImage(t) : `loco-${state}`, VEHICLE.locoLength);
  for (let i = 0; i < cars; i++) {
    at = rail.along(at, VEHICLE.gap * pxPerArtPx);
    place(i === cars - 1 ? `car-tail-${state}` : `car-${state}`, VEHICLE.carLength, { numbered: i === 0 });
  }
  return out;
}

// Where a stopped train's middle is drawn, in meters ahead of its position along its track: on
// the station it's standing at, so every train at a platform lines up across it, or else on its
// own position. GPS fixes at a station scatter along the platforms and beyond.
const PARK_SNAP_M = 800;

function parkedCentre(t, plan, now) {
  const { at } = stopContext(t, false);
  const st = at && state.stations[at.code];
  const d = st && Number.isFinite(st.lat) ? metersAheadTo(plan, now, st) : null;
  return d !== null && Math.abs(d) <= PARK_SNAP_M ? d : 0;
}

const RAIL_STEP_ROWS = 3; // art px of track between samples of a lane rail

// The line a train's vehicles are laid along, in screen pixels: its track behind the nose,
// shifted sideways by its lane (positive lanes to the right of travel; the lane can vary along
// the train mid-crossover). Where the track bends tighter than the shift, the inside of the
// shifted line would loop back on itself, so the loop is cut off where the line crosses itself,
// leaving the sharp corner a parallel track would have. The rail is sampled lazily as far back
// as the vehicles need. Positions on it are { i, point }: a point on segment i. The rail starts
// `lead` art px ahead of the train's position, where the nose is drawn.
function laneRail(plan, now, metersPerArtPx, lanePx, laneOf, trainRows, lead = 0) {
  const turn = map.getBearing();
  const pts = [];
  let rows = 0; // behind the nose
  const sample = () => {
    const p = positionAt(plan, now, (rows - lead) * metersPerArtPx);
    const s = map.project([p.lon, p.lat]);
    const a = ((p.bearing - turn) * Math.PI) / 180; // right of travel on screen is (cos a, sin a)
    const off = laneOf(rows) * lanePx;
    const q = [s.x + Math.cos(a) * off, s.y + Math.sin(a) * off];
    rows += RAIL_STEP_ROWS;
    const last = pts.at(-1);
    if (last && off) {
      for (let k = pts.length - 3; k >= 0; k--) {
        const x = segmentCrossing(pts[k], pts[k + 1], last, q);
        if (x) {
          pts.length = k + 1;
          pts.push(x);
          break;
        }
      }
    }
    pts.push(q);
  };
  // Sample past the train's length up front, with room for what a loop on the inside of a bend
  // cuts off, so later samples don't cut back into a stretch a vehicle already sits on.
  const shiftRows = (Math.max(Math.abs(laneOf(0)), Math.abs(laneOf(trainRows))) * LANE_ICON_PX) / 1.5;
  const reach = trainRows * 1.25 + 4 * shiftRows;
  while (rows <= reach + RAIL_STEP_ROWS) sample();
  const ensure = (i) => {
    while (pts.length < i + 2 && rows < reach * 4) sample();
    return i + 1 < pts.length;
  };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return {
    start: { i: 0, point: pts[0] },
    // The first position further back whose straight-line distance from `from` is `length`.
    chord(from, length) {
      for (let i = from.i; ensure(i); i++) {
        const [a, b] = [pts[i], pts[i + 1]];
        if (dist(from.point, b) < length) continue;
        // Solve |a + u(b - a) - from| = length for the far root on this segment.
        const d = [b[0] - a[0], b[1] - a[1]];
        const f = [a[0] - from.point[0], a[1] - from.point[1]];
        const A = d[0] ** 2 + d[1] ** 2;
        const B = 2 * (f[0] * d[0] + f[1] * d[1]);
        const C = f[0] ** 2 + f[1] ** 2 - length ** 2;
        const u = A ? Math.min(1, Math.max(0, (-B + Math.sqrt(Math.max(0, B * B - 4 * A * C))) / (2 * A))) : 1;
        return { i, point: [a[0] + u * d[0], a[1] + u * d[1]] };
      }
      return { i: pts.length - 2, point: pts.at(-1) };
    },
    // The position `length` further back along the rail.
    along(from, length) {
      let left = length;
      let p = from.point;
      for (let i = from.i; ensure(i); i++) {
        const step = dist(p, pts[i + 1]);
        if (step >= left) {
          const u = step ? left / step : 0;
          return { i, point: [p[0] + u * (pts[i + 1][0] - p[0]), p[1] + u * (pts[i + 1][1] - p[1])] };
        }
        left -= step;
        p = pts[i + 1];
      }
      return { i: pts.length - 2, point: pts.at(-1) };
    },
  };
}

// Where segments ab and cd cross, or null if they don't.
function segmentCrossing(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const denom = r[0] * s[1] - r[1] * s[0];
  if (!denom) return null;
  const u = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denom;
  const v = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denom;
  return u > 0 && u < 1 && v > 0 && v < 1 ? [a[0] + u * r[0], a[1] + u * r[1]] : null;
}

// Lane changes play out like a real crossover. The switch sits where the nose was when the
// change began, and the train runs through it: the lane is a smooth S-curve along the train
// (lane(rows) for a point `rows` art px behind the nose), so the engine swings over first and
// every car follows it through the same spot; vehicleFeatures lays the cars along that curve. The switch point moves back along the train only as far
// as the train actually travels (in art px at the current zoom, so zooming doesn't jump it); a
// train held at a stop finishes at SWITCH_STALL_ROWS_PER_S. Only a moving train that was already
// on screen starts one (i.e. one that ran into another train); on first load, when a train comes
// into view, or for a stopped train, the lane just snaps.
//
// Returns laneOf(rows) -> the lane `rows` art px behind the nose, and whether the crossover is
// still in progress.
function laneTransition(id, lane, now, plan, metersPerArtPx, animate) {
  let anim = state.laneAnims.get(id);
  const travel = travelledAt(plan, now);
  if (anim && !anim.done) {
    // Advance the switch point by how far the train moved since last frame. A refresh rebuilds
    // the plan (and restarts its travel), so that frame counts as no movement.
    const moved = anim.plan === plan ? Math.max(0, travel - anim.travel) / metersPerArtPx : 0;
    anim.switchAt += moved > 0 || anim.plan !== plan ? moved : ((now - anim.now) / 1000) * SWITCH_STALL_ROWS_PER_S;
    Object.assign(anim, { plan, travel, now });
    if (anim.switchAt > TRAIN_ROWS + anim.length) Object.assign(anim, { done: true, prev: null });
  }
  if (!anim || (anim.done && anim.to !== lane && !animate)) {
    anim = { to: lane, done: true };
  } else if (anim.to !== lane) {
    // A new target mid-crossover starts from the curve the train is on now, so nothing jumps.
    const length = SWITCH_ROWS_PER_LANE * Math.abs(lane - anim.to);
    anim = { prev: anim.done ? null : anim, from: anim.to, to: lane, length, switchAt: 0, plan, travel, now, done: false };
  }
  state.laneAnims.set(id, anim);
  return { laneOf: (rows) => laneAlong(anim, rows), active: !anim.done };
}

// Lane at a point `rows` behind the nose. Positive lanes are to the right of travel.
function laneAlong(anim, rows) {
  if (anim.done) return anim.to;
  const base = anim.prev ? laneAlong(anim.prev, rows) : anim.from;
  const u = Math.min(1, Math.max(0, (anim.switchAt - rows) / anim.length));
  return base + (anim.to - base) * u * u * (3 - 2 * u); // smoothstep
}

// Give overlapping trains different lanes. Works in screen space on each train's drawn path
// (a polyline through its cars, head first), so curved trains whose tails swing across a
// neighbour are caught, and it adapts to zoom.
//
// Stopped trains are placed first and keep whatever lane they already have, so moving trains
// pass around them. After that lanes are sticky: trains already holding a lane are placed
// before newcomers, so an arriving train goes around a waiting one instead of shoving it aside.
// Moving incumbents try the centre again (to drift back once it clears), then their old lane.
// Within each group moving trains go first, then the selected train, then by ID.
function assignLanes(entries, zoom) {
  const sprite = zoom >= SPRITE_ZOOM;
  const scale = sprite ? iconSizeAt(zoom) : 1;
  const width = sprite ? CAR_PX * scale : TRAIL_PX_WIDTH; // drawn train width in px
  const spacing = sprite ? LANE_ICON_PX * scale : LANE_TRAIL_PX;
  const previous = state.lanes;
  const group = (e) => (!previous.has(e.t.trainID) ? 2 : previous.get(e.t.trainID) === 0 ? 0 : 1);
  const parked = (e) => !e.properties.moving;
  entries.sort(
    (a, b) =>
      parked(b) - parked(a) ||
      group(a) - group(b) ||
      b.properties.moving - a.properties.moving ||
      b.properties.selected - a.properties.selected ||
      a.t.trainID.localeCompare(b.t.trainID),
  );
  const placed = [];
  state.lanes = new Map();
  for (const e of entries) {
    const normals = rightNormals(e.path);
    const prior = previous.get(e.t.trainID);
    // A stopped train stays put in the lane it already has; a moving one drifts back toward
    // the centre when it's free.
    const order = parked(e) ? [...(prior === undefined ? [] : [prior]), ...PARKED_LANES.filter((l) => l !== prior)] : prior === undefined ? LANES : [0, prior, ...LANES.filter((l) => l !== 0 && l !== prior)];
    const shiftedFor = (lane) => e.path.map(([x, y], i) => [x + normals[i][0] * lane * spacing, y + normals[i][1] * lane * spacing]);
    const clearanceCache = new Map();
    const clearanceOf = (lane) => {
      if (!clearanceCache.has(lane)) clearanceCache.set(lane, Math.min(Infinity, ...placed.map((other) => polylineDistance(shiftedFor(lane), other))));
      return clearanceCache.get(lane);
    };
    // A moving train can't cross over another train's track: a lane only counts if every lane
    // between where it is now and it is clear too. Stopped trains and newcomers just snap into
    // place, so any free lane will do.
    const base = prior ?? 0;
    const reachable = (lane) => {
      if (prior === undefined || parked(e)) return true;
      const [lo, hi] = lane > base ? [base + 1, lane - 1] : [lane + 1, base - 1];
      for (let l = lo; l <= hi; l++) if (clearanceOf(l) < width) return false;
      return true;
    };
    // Take the first reachable lane that's fully clear; if none is (a crowded terminal), take
    // the reachable one with the most room rather than overlapping blindly.
    let best = { clearance: -Infinity, lane: base };
    for (const lane of order) {
      if (!reachable(lane)) continue;
      const clearance = clearanceOf(lane);
      if (clearance > best.clearance) best = { clearance, lane };
      if (clearance >= width) break;
    }
    e.lane = best.lane;
    placed.push(shiftedFor(best.lane).slice(e.ahead)); // others avoid its body, not its look-ahead
    state.lanes.set(e.t.trainID, e.lane);
  }
}

// Unit normal pointing to the right of travel at each point of a head-first screen polyline
// (screen y points down, so "right" of a direction (dx, dy) is (-dy, dx)). Neighbours are
// searched outward past coincident points so a bunched tail still gets a direction.
function rightNormals(path) {
  let last = [0, 0];
  return path.map((p, i) => {
    let lo = i;
    let hi = i;
    while (lo > 0 && Math.hypot(path[lo][0] - p[0], path[lo][1] - p[1]) < 0.5) lo--;
    while (hi < path.length - 1 && Math.hypot(path[hi][0] - p[0], path[hi][1] - p[1]) < 0.5) hi++;
    const [hx, hy] = path[lo]; // toward the head
    const [tx, ty] = path[hi];
    const len = Math.hypot(hx - tx, hy - ty);
    if (len < 0.5) return last;
    last = [-(hy - ty) / len, (hx - tx) / len];
    return last;
  });
}

function polylineDistance(a, b) {
  let best = Infinity;
  for (let i = 0; i < a.length - 1; i++) for (let j = 0; j < b.length - 1; j++) best = Math.min(best, segmentDistance(a[i], a[i + 1], b[j], b[j + 1]));
  return best;
}

function segmentDistance(a, b, c, d) {
  const cross = (o, p, q) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0; // they cross
  const pointSeg = ([px, py], [ax, ay], [bx, by]) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const u = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - ax - u * dx, py - ay - u * dy);
  };
  return Math.min(pointSeg(a, c, d), pointSeg(b, c, d), pointSeg(c, a, b), pointSeg(d, a, b));
}

function trainFeatures() {
  const now = Date.now();
  const zoom = map.getZoom();
  const points = [];
  const trails = [];
  const vehicles = [];
  // Vehicles and trails are rebuilt every frame while zooming, so only bother with what's near the view.
  const b = map.getBounds();
  const padX = (b.getEast() - b.getWest()) * 0.25;
  const padY = (b.getNorth() - b.getSouth()) * 0.25;
  const nearView = (p) => p.lon > b.getWest() - padX && p.lon < b.getEast() + padX && p.lat > b.getSouth() - padY && p.lat < b.getNorth() + padY;

  const entries = [];
  for (const t of state.trains) {
    const pos = trainPosition(t, now);
    const properties = {
      trainID: t.trainID,
      trainNum: t.trainNum,
      iconColor: t.iconColor || "#888",
      textColor: t.textColor || "#000",
      bearing: pos.bearing,
      moving: isMoving(t, now),
      selected: t.trainID === state.selectedId,
      arrow: arrowImage(t),
      stale: (now - Date.parse(t.lastValTS)) / 60_000 >= STALE_MIN,
    };
    const point = { type: "Feature", geometry: { type: "Point", coordinates: [pos.lon, pos.lat] }, properties };
    points.push(point);
    if (!nearView(pos)) continue;
    const plan = state.plans.get(t.trainID);
    const metersPerPx = (78271.517 * Math.cos((pos.lat * Math.PI) / 180)) / 2 ** zoom;
    // Sample the train head to tail (about one point per car) as it would be drawn at
    // LANE_REF_ZOOM, in that zoom's pixels, so the lane check sees curves and doesn't depend
    // on the current zoom.
    const ref = LANE_REF_ZOOM;
    const refScale = 2 ** (ref - zoom);
    const lengthM = (VEHICLE.locoLength + carsAt(ref) * (VEHICLE.carLength + VEHICLE.gap)) * 1.5 * iconSizeAt(ref) * (metersPerPx / refScale);
    // A moving train also looks one train length ahead of its nose, so it starts switching
    // lanes before it reaches a train in its way rather than once they've collided.
    // A stopped train is drawn centred on its station (see vehicleFeatures), so its samples are too.
    const samples = carsAt(ref) + 2;
    const ahead = properties.moving && plan ? samples - 1 : 0;
    const centreM = properties.moving ? null : parkedCentre(t, plan, now);
    const leadM = centreM === null ? 0 : lengthM / 2 + centreM;
    const path = Array.from({ length: ahead + samples }, (_, i) => {
      const p = plan ? positionAt(plan, now, (lengthM * (i - ahead)) / (samples - 1) - leadM) : pos;
      const s = map.project([p.lon, p.lat]);
      return [s.x * refScale, s.y * refScale];
    });
    entries.push({ t, pos, plan, metersPerPx, properties, point, path, ahead, centreM });
  }
  const onScreen = new Set(state.lanes.keys()); // trains drawn last frame
  assignLanes(entries, LANE_REF_ZOOM);
  if (!state.settleUntil && entries.length) state.settleUntil = now + SETTLE_MS;

  let crossing = false;
  for (const e of entries) {
    const { t, plan, metersPerPx, point, lane } = e;
    const animate = e.properties.moving && onScreen.has(t.trainID) && now >= state.settleUntil;
    const metersPerArtPx = 1.5 * iconSizeAt(zoom) * metersPerPx;
    const { laneOf, active } = laneTransition(t.trainID, lane, now, plan, metersPerArtPx, animate);
    crossing ||= active;
    const head = laneOf(VEHICLE.locoLength / 2);
    const properties = e.properties;
    const arrow = properties.arrow && `${properties.arrow}-narrow`;
    point.properties = { ...properties, arrow, headOffset: [(head * LANE_TRAIL_PX) / HEAD_ICON_SIZE, 0] };
    if (zoom >= SPRITE_ZOOM) vehicles.push(...vehicleFeatures(t, plan, now, zoom, metersPerPx, properties, laneOf, e.centreM));
    else if (plan) {
      const coords = trailAt(plan, now, TRAIL_PX * metersPerPx);
      trails.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coords },
        properties: { ...properties, lineOffset: head * LANE_TRAIL_PX, trailWidth: TRAIL_PX_WIDTH },
      });
    }
  }
  const fc = (features) => ({ type: "FeatureCollection", features });
  return { points: fc(points), trails: fc(trails), vehicles: fc(vehicles), crossing };
}

function updateTrains() {
  const { points, trails, vehicles, crossing } = trainFeatures();
  state.crossing = crossing; // keep redrawing every frame until crossovers finish
  map.getSource("trains")?.setData(points);
  map.getSource("train-trails")?.setData(trails);
  map.getSource("train-vehicles")?.setData(vehicles);
}

function stationsGeoJSON() {
  const train = selectedTrain();
  const onRoute = new Map((train?.stations ?? []).map((s) => [s.code, s]));
  return {
    type: "FeatureCollection",
    features: Object.values(state.stations)
      .filter((s) => Number.isFinite(s.lat))
      .map((s) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [s.lon, s.lat] },
        properties: {
          code: s.code,
          name: s.name,
          onRoute: onRoute.has(s.code),
          tripEnd: !!state.trip && (s.code === state.trip.from || s.code === state.trip.to),
          stopColor: onRoute.get(s.code)?.stopIconColor || "#2f5bc4",
        },
      })),
  };
}

// Highlight the selected train's GTFS track shape. Trains without one (VIA, Brightline, …)
// fall back to a dashed line connecting their stops in order.
function routeGeoJSON() {
  const train = selectedTrain();
  const shape = train && shapeFor(train);
  if (shape) {
    return { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: shape }, properties: { approx: false } }] };
  }
  const coords = (train?.stations ?? [])
    .map((s) => state.stations[s.code])
    .filter((s) => s && Number.isFinite(s.lat))
    .map((s) => [s.lon, s.lat]);
  return {
    type: "FeatureCollection",
    features: coords.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: { approx: true } }] : [],
  };
}

function selectedTrain() {
  return state.trains.find((t) => t.trainID === state.selectedId);
}

function render() {
  updateTrains();
  map.getSource("stations")?.setData(stationsGeoJSON());
  map.getSource("route")?.setData(routeGeoJSON());
  map.getSource("trip-leg")?.setData(tripLegGeoJSON());
  renderList();
  if (state.trip) renderTrip();
  else if (state.selectedId) renderDetail();
  if (boardCode) renderBoard();
}

animateIcon(document.querySelector(".logo"), document.getElementById("favicon")); // $ isn't defined yet
refresh();
setInterval(refresh, REFRESH_MS);

// Slide trains along between refreshes. Reduced-motion users get a slow step instead.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let lastMotion = 0;
let zooming = false;
function animate(ts) {
  // Car spacing and trail length depend on zoom, so redraw every frame while zooming (otherwise
  // they lag behind icon-size and the cars bounce), and while any train is crossing lanes.
  if (zooming || state.crossing || ts - lastMotion >= (reduceMotion ? 10_000 : MOTION_MS)) {
    lastMotion = ts;
    zooming = false;
    updateTrains();
    if (state.trip?.follow && !map.isEasing()) followTrain();
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
map.on("zoom", () => (zooming = true));
map.on("moveend", (e) => !e.tripFollow && (lastMotion = 0)); // pick up trains panned into view

// The side view and the trip card depend on the extrapolated position (e.g. "Now arriving"),
// so refresh them between API updates too.
setInterval(() => (state.trip ? renderTrip() : state.selectedId && renderDetail()), 5_000);

// ---------------------------------------------------------------------------
// Panel

const $ = (sel) => document.querySelector(sel);
const listEl = $("#train-list");
const detailEl = $("#detail");
const searchEl = $("#search");

searchEl.addEventListener("input", () => {
  state.query = searchEl.value.trim().toLowerCase();
  renderList();
});

$("#theme-toggle").addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem("theme", state.theme);
  } catch {}
  applyTheme();
});

$("#panel-toggle").addEventListener("click", () => document.body.classList.toggle("panel-collapsed"));

const trainsToggle = $("#trains-toggle");
trainsToggle.addEventListener("change", () => setShowTrains(trainsToggle.checked));

function setShowTrains(on) {
  state.showTrains = on;
  trainsToggle.checked = on;
  setUrlParam("trains", on ? null : "0");
  applyTrainVisibility();
}

const speedToggle = $("#speed-toggle");
speedToggle.addEventListener("change", () => setSpeedHeatmap(speedToggle.checked));

async function setSpeedHeatmap(on) {
  state.showSpeed = on;
  speedToggle.checked = on;
  setUrlParam("speed", on ? "1" : null);
  const info = $("#speed-info");
  info.hidden = !on;
  if (on && !state.speed) {
    info.textContent = "Loading speeds…";
    state.speed = (await loadSpeedSegments()) ?? { type: "FeatureCollection", features: [] };
    map.getSource("speed")?.setData(state.speed);
  }
  if (on) renderSpeedInfo();
  if (map.getLayer("speed-heatmap")) map.setLayoutProperty("speed-heatmap", "visibility", on ? "visible" : "none");
}

// The collector workflow publishes straight to the speed-data branch, so read it from there
// (raw.githubusercontent.com allows cross-origin reads and caches for ~5 minutes). When running
// locally, a hand-built data/speed-segments.geojson takes precedence.
const SPEED_URL = "https://raw.githubusercontent.com/webb-ben/amtracker/speed-data/speed-segments.geojson";

async function loadSpeedSegments() {
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  for (const url of local ? ["data/speed-segments.geojson", SPEED_URL] : [SPEED_URL]) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {}
  }
  return null;
}

// Time of day for the heatmap: "" for all day, or a 4-hour slice of the train's local time
// (scripts/speed/build.py writes mph0..mph5 alongside the all-day mph).
const SPEED_PERIODS = ["12–4 am", "4–8 am", "8 am–12 pm", "12–4 pm", "4–8 pm", "8 pm–12 am"];
const speedProp = () => (state.speedPeriod === "" ? "mph" : `mph${state.speedPeriod}`);
const speedColorExpr = () => ["interpolate", ["linear"], ["get", speedProp()], ...SPEED_RAMP.flat()];

function setSpeedPeriod(period) {
  state.speedPeriod = period;
  setUrlParam("speedtime", period === "" ? null : period);
  if (map.getLayer("speed-heatmap")) {
    map.setFilter("speed-heatmap", ["has", speedProp()]);
    map.setPaintProperty("speed-heatmap", "line-color", speedColorExpr());
  }
  renderSpeedInfo();
}

function renderSpeedInfo() {
  const meta = state.speed?.metadata;
  const info = $("#speed-info");
  if (!state.speed?.features.length) {
    info.textContent = "No speed samples yet — the collector needs a few runs.";
    return;
  }
  const stops = SPEED_RAMP.map(([mph, color]) => `${color} ${((mph - SPEED_RAMP[0][0]) / (SPEED_RAMP.at(-1)[0] - SPEED_RAMP[0][0])) * 100}%`).join(", ");
  info.innerHTML = `
    <div class="ramp" style="background: linear-gradient(90deg, ${stops})"></div>
    <div class="ramp-labels"><span>${SPEED_RAMP[0][0]} mph</span><span>${SPEED_RAMP.at(-1)[0]}+</span></div>
    <div>Average moving speed${meta?.days ? ` · ${meta.days} day${meta.days > 1 ? "s" : ""} of samples` : ""}</div>
    <label class="speed-period">Time of day
      <select id="speed-period">
        <option value="">All day</option>
        ${SPEED_PERIODS.map((label, i) => `<option value="${i}"${String(i) === state.speedPeriod ? " selected" : ""}>${label}</option>`).join("")}
      </select>
    </label>
    ${state.speedPeriod !== "" && !state.speed.features.some((f) => speedProp() in f.properties) ? "<div>Not enough samples for this time of day yet.</div>" : ""}`;
  $("#speed-period").addEventListener("change", (e) => setSpeedPeriod(e.target.value));
}

function preferredTheme() {
  try {
    const saved = localStorage.getItem("theme");
    if (saved) return saved;
  } catch {}
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  // diff: false forces a full reload so "style.load" fires and addOverlays re-adds the
  // sprites, sources and layers that aren't part of the basemap style.
  map.setStyle(buildStyle(state.theme), { diff: false });
  if (state.selectedId) renderDetail(); // the side view's headlight follows the theme
}
document.documentElement.dataset.theme = state.theme;

function matches(t, q) {
  if (!q) return true;
  return [t.trainNum, t.routeName, t.origName, t.destName, t.origCode, t.destCode, t.provider].some((v) =>
    String(v ?? "")
      .toLowerCase()
      .includes(q),
  );
}

function renderList() {
  const trains = state.trains.filter((t) => matches(t, state.query)).sort((a, b) => a.routeName.localeCompare(b.routeName) || Number(a.trainNum) - Number(b.trainNum));
  if (!trains.length) {
    listEl.innerHTML = `<p class="empty">${state.trains.length ? "No trains match." : "Loading trains…"}</p>`;
    return;
  }
  listEl.innerHTML =
    resumeTripRow() +
    trains
      .map(
        (t) => `
      <button class="train-row${t.trainID === state.selectedId ? " active" : ""}" data-id="${esc(t.trainID)}">
        <span class="badge" style="background:${esc(t.iconColor)};color:${esc(t.textColor)}">${esc(t.trainNum)}</span>
        <span class="row-main">
          <span class="row-title">${esc(t.routeName)}</span>
          <span class="row-sub">${esc(t.origCode)} → ${esc(t.destCode)} · ${esc(timeliness(t).label)}</span>
        </span>
      </button>`,
      )
      .join("");
}

// The trip remembered on this device, while its train is still on the way to your stop.
function resumeTripRow() {
  const saved = savedTrip();
  const t = saved && !state.trip && state.trains.find((x) => x.trainID === saved.trainID);
  if (!t || !t.stations.some((s) => s.code === saved.from) || !t.stations.some((s) => s.code === saved.to)) return "";
  if (tripStatus(t, saved).phase === "arrived") return "";
  return `<button class="trip-resume" data-action="resume-trip">
    <span class="badge" style="background:${esc(t.iconColor)};color:${esc(t.textColor)}">${esc(t.trainNum)}</span>
    <span class="row-main"><span class="row-title">Back to my trip</span><span class="row-sub">${esc(saved.from)} → ${esc(saved.to)} · ${esc(t.routeName)}</span></span>
  </button>`;
}

listEl.addEventListener("click", (e) => {
  if (e.target.closest("[data-action=resume-trip]")) {
    const { trainID, from, to } = savedTrip();
    return startTrip(trainID, { from, to });
  }
  const row = e.target.closest(".train-row");
  if (row) selectTrain(row.dataset.id, { fly: true });
});

function selectTrain(id, { fly = false, fit = false } = {}) {
  if (state.trip && id !== state.trip.trainID) exitTrip(); // picking another train leaves the trip (it's remembered)
  state.selectedId = id;
  const t = selectedTrain();
  if (!t) return;
  document.body.classList.add("has-detail");
  document.body.classList.remove("panel-collapsed");
  render();
  setUrlParam("train", t.trainID);
  const pos = trainPosition(t);
  if (fit) fitRoute(t);
  else if (fly) map.flyTo({ center: [pos.lon, pos.lat], zoom: Math.max(map.getZoom(), 8), speed: 1.4 });
}

function clearSelection() {
  state.selectedId = null;
  document.body.classList.remove("has-detail");
  setUrlParam("train", null);
  render();
}

function fitRoute(t) {
  const coords = routeGeoJSON().features[0]?.geometry.coordinates ?? [[t.lon, t.lat]];
  const bounds = coords.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(coords[0], coords[0]));
  const left = window.innerWidth > 640 ? 380 : 40;
  map.fitBounds(bounds, { padding: { top: 60, bottom: 60, left, right: 60 }, maxZoom: 11, duration: 0 });
}

// Shareable state lives in the query string (?train=…, ?station=…); MapLibre owns the #hash view.
function setUrlParam(key, value) {
  const url = new URL(location.href);
  if (value) url.searchParams.set(key, value);
  else url.searchParams.delete(key);
  history.replaceState(null, "", url);
}

function applyUrl() {
  const params = new URLSearchParams(location.search);
  // Accept a full train ID ("66-29") or just a number ("66"); IDs roll over daily.
  const findTrain = (wanted) => state.trains.find((x) => x.trainID === wanted) ?? state.trains.find((x) => x.trainNum === wanted.split("-")[0]);
  const trip = params.get("trip") && findTrain(params.get("trip"));
  const wanted = params.get("train");
  if (trip) startTrip(trip.trainID, { from: params.get("from")?.toUpperCase(), to: params.get("to")?.toUpperCase() });
  else if (wanted) {
    const t = findTrain(wanted);
    if (t) selectTrain(t.trainID, { fit: !linkHasView });
  }
  const period = params.get("speedtime");
  if (/^[0-5]$/.test(period ?? "")) state.speedPeriod = period;
  if (params.get("speed") === "1") setSpeedHeatmap(true);
  if (params.get("trains") === "0") setShowTrains(false);
  const station = params.get("station");
  if (station && state.stations[station.toUpperCase()]) showStation(station.toUpperCase());
}

async function copyLink(button) {
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = "Link copied";
  } catch {
    button.textContent = "Copy the address bar";
  }
  setTimeout(() => (button.textContent = label), 2000);
}

function renderDetail() {
  const t = selectedTrain();
  if (!t) {
    detailEl.innerHTML = `<button class="back" data-action="back">← All trains</button><p class="empty">This train is no longer reporting.</p>`;
    return;
  }
  const moving = isMoving(t);
  const arrived = arrivedByReckoning(t);
  const status = timeliness(t);
  const next = nextStop(t);
  const { at, arriving, last, upcoming } = stopContext(t, moving);
  const platform = at ?? arriving;
  const side = sprites[`side-${moving ? "move" : "idle"}`];
  const dark = state.theme === "dark"; // the headlight only shines in dark mode
  const stationArt = platform
    ? `<img class="station" src="${spriteUrls.station}" alt="" style="width:${(sprites.station.width / side.width) * 100}%" />
       <span class="station-sign" style="bottom:${(sprites.station.height / side.height) * 100}%">${esc(platform.name)}</span>`
    : "";
  // A fix older than STALE_MIN means the speed shown is a last-known value, not live.
  const fixAge = (Date.now() - Date.parse(t.lastValTS)) / 60_000;
  const stale = fixAge >= STALE_MIN;
  const tag = stale
    ? `No update for ${fmtAge(fixAge)}`
    : arriving
      ? "Now arriving"
      : moving
        ? `Moving · ${Math.round(t.velocity)} mph`
        : arrived && at
          ? "Arrived"
          : at
            ? "At station"
            : "Stopped";
  const tagClass = stale ? " stale" : arriving || (arrived && at) ? " arriving" : moving ? " moving" : "";
  detailEl.innerHTML = `
    <button class="back" data-action="back">← All trains</button>
    <div class="sprite-stage${platform ? " at-station" : ""}">
      <span class="motion-tag${tagClass}">${tag}</span>
      <div class="train-wrap">
        ${stationArt}
        <img class="train" src="${spriteUrls[`side-${moving ? "move" : "idle"}${dark ? "" : "-unlit"}`]}" alt="" />
        <span class="car-number">${esc(t.trainNum)}</span>
        ${moving && dark ? `<span class="side-beam"></span>` : ""}
      </div>
      <div class="track${moving ? " moving" : ""}"></div>
      <div class="stage-stops">
        ${stageStop(last, "last")}
        ${stageStop(upcoming, "upcoming")}
      </div>
    </div>
    <h2><span class="badge" style="background:${esc(t.iconColor)};color:${esc(t.textColor)}">${esc(t.trainNum)}</span> ${esc(t.routeName)}</h2>
    <p class="od">${esc(t.origName)} → ${esc(t.destName)}</p>
    <dl class="facts">
      <div><dt>Status</dt><dd>${esc(status.label)}</dd></div>
      <div><dt>${stale ? "Last speed" : "Speed"}</dt><dd>${moving ? `${Math.round(t.velocity)} mph ${esc(t.heading ?? "")}` : "Stopped"}</dd></div>
      <div><dt>Next stop</dt><dd>${next ? `${esc(next.name)} · ${fmtTime(next.arr || next.dep, next.tz)}` : "—"}</dd></div>
      <div><dt>Operator</dt><dd>${esc(t.provider ?? "Amtrak")}</dd></div>
      <div class="${stale ? "stale" : ""}"><dt>Last update</dt><dd>${Number.isFinite(fixAge) ? `${fmtAge(fixAge)} ago · ${fmtClock(Date.parse(t.lastValTS), t.eventTZ)}` : "—"}</dd></div>
    </dl>
    <button class="trip-start" data-action="trip">Track my trip on this train</button>
    <div class="links">
      <a href="https://amtraker.com/trains/${encodeURIComponent(t.trainNum)}/${encodeURIComponent(t.trainID.split("-")[1] ?? "")}" target="_blank" rel="noopener">Amtraker ↗</a>
      <button class="share" data-action="share">Share link</button>
    </div>
    ${t.statusMsg?.trim() ? `<p class="alert">${esc(t.statusMsg)}</p>` : ""}
    ${(t.alerts ?? []).map((a) => `<p class="alert">${esc(a.message ?? a)}</p>`).join("")}
    <ol class="timeline">
      ${t.stations
        .map((s) => {
          const done = s.status === "Departed";
          const here = next && s.code === next.code;
          const sch = s.schArr || s.schDep;
          const act = s.arr || s.dep;
          return `<li class="${done ? "done" : ""}${here ? " next" : ""}" data-code="${esc(s.code)}">
            <span class="dot" style="border-color:${esc(s.stopIconColor || "#888")}"></span>
            <span class="stop-name">${esc(s.name)} <span class="code">${esc(s.code)}</span></span>
            <span class="stop-time">${fmtTime(act || sch, s.tz)}${sch && act && sch !== act ? ` <s>${fmtTime(sch, s.tz)}</s>` : ""}</span>
          </li>`;
        })
        .join("")}
    </ol>`;
  slideInChanges(t.trainID);
}

// The detail panel is re-rendered every few seconds; slide in (left to right) only the pieces
// whose text actually changed since the last render of the same train.
const SLIDE_TARGETS = [".motion-tag", ".train-wrap .station", ".station-sign", ".stage-stops .last", ".stage-stops .upcoming", ".facts dd"];
let lastShown = { id: null, texts: [] };

function slideInChanges(id) {
  const els = SLIDE_TARGETS.flatMap((sel) => [...detailEl.querySelectorAll(sel)].map((el) => ({ key: sel, el })));
  const texts = els.map(({ key, el }) => `${key}|${el.textContent}`);
  if (lastShown.id === id) {
    const previous = new Set(lastShown.texts);
    els.forEach(({ el }, i) => {
      if (!previous.has(texts[i])) el.classList.add("slide-in");
    });
  }
  lastShown = { id, texts };
}

detailEl.addEventListener("click", (e) => {
  if (e.target.closest("[data-action=back]")) return clearSelection();
  if (e.target.closest("[data-action=trip]")) return startTrip(state.selectedId);
  const share = e.target.closest("[data-action=share]");
  if (share) return copyLink(share);
  const li = e.target.closest("li[data-code]");
  const st = li && state.stations[li.dataset.code];
  if (st) map.flyTo({ center: [st.lon, st.lat], zoom: 11 });
});

// ---------------------------------------------------------------------------
// Station departures board

const boardEl = $("#board");
let boardCode = null;
let boardMode = "departures";

function showStation(code) {
  boardCode = code;
  boardEl.hidden = false;
  setUrlParam("station", code);
  renderBoard();
}

function closeBoard() {
  boardCode = null;
  boardEl.hidden = true;
  setUrlParam("station", null);
}

function boardRows(code, mode) {
  const now = Date.now();
  const rows = [];
  for (const t of state.trains) {
    const i = t.stations.findIndex((s) => s.code === code);
    if (i < 0) continue;
    const stop = t.stations[i];
    const isOrigin = i === 0;
    const isDest = i === t.stations.length - 1;
    if (mode === "departures" ? isDest : isOrigin) continue;
    const sch = Date.parse(mode === "departures" ? stop.schDep || stop.schArr : stop.schArr || stop.schDep);
    const est = Date.parse(mode === "departures" ? stop.dep || stop.arr : stop.arr || stop.dep);
    if (!Number.isFinite(sch)) continue;
    const gone = stop.status === "Departed";
    // Like a station board: keep departed trains up briefly, then drop them.
    if (gone && now - (Number.isFinite(est) ? est : sch) > 10 * 60_000) continue;
    rows.push({ t, stop, sch, est, gone, place: mode === "departures" ? t.destName : t.origName });
  }
  return rows.sort((a, b) => a.sch - b.sch).slice(0, 14);
}

function boardStatus({ stop, sch, est, gone }, mode) {
  if (gone) return { text: mode === "departures" ? "Departed" : "Arrived", cls: "muted" };
  if (stop.status === "Station") return { text: mode === "departures" ? "Boarding" : "Arrived", cls: "ok" };
  if (!Number.isFinite(est)) return { text: "—", cls: "" };
  const mins = Math.round((est - sch) / 60000);
  if (mins < 2) return { text: "On Time", cls: "ok" };
  return { text: `Late ${fmtClock(est, stop.tz)}`, cls: mins >= 30 ? "bad" : "warn" };
}

function renderBoard() {
  const st = state.stations[boardCode];
  if (!st) return;
  const rows = boardRows(boardCode, boardMode);
  const placeHead = boardMode === "departures" ? "To" : "From";
  boardEl.innerHTML = `
    <div class="board-card" role="dialog" aria-label="${esc(st.name)} ${boardMode}">
      <header class="board-head">
        <div>
          <div class="board-title">${boardMode === "departures" ? "Departures" : "Arrivals"}</div>
          <div class="board-station">${esc(st.name)} <span>${esc(st.code)}</span></div>
        </div>
        <div class="board-clock">${fmtClock(Date.now(), st.tz)}</div>
        <button class="board-close" data-action="close" aria-label="Close">✕</button>
      </header>
      <div class="board-tabs" role="tablist">
        <button role="tab" data-mode="departures" aria-selected="${boardMode === "departures"}">Departures</button>
        <button role="tab" data-mode="arrivals" aria-selected="${boardMode === "arrivals"}">Arrivals</button>
      </div>
      <table class="board-table">
        <thead><tr><th>Time</th><th>Train</th><th>${placeHead}</th><th>Status</th><th>Track</th></tr></thead>
        <tbody>
          ${
            rows.length
              ? rows
                  .map((r) => {
                    const status = boardStatus(r, boardMode);
                    return `<tr data-id="${esc(r.t.trainID)}" class="${r.gone ? "gone" : ""}">
                      <td class="time">${fmtClock(r.sch, r.stop.tz)}</td>
                      <td class="train"><span class="num">${esc(r.t.trainNum)}</span><span class="route">${esc(r.t.routeName)}</span></td>
                      <td class="place">${esc(r.place)}</td>
                      <td class="status ${status.cls}">${esc(status.text)}</td>
                      <td class="trk">${esc(r.stop.platform || "—")}</td>
                    </tr>`;
                  })
                  .join("")
              : `<tr><td colspan="5" class="none">No active trains scheduled</td></tr>`
          }
        </tbody>
      </table>
      <footer class="board-foot">${esc([st.city, st.state].filter(Boolean).join(", "))} · tap a train to follow it</footer>
    </div>`;
}

boardEl.addEventListener("click", (e) => {
  if (e.target === boardEl || e.target.closest("[data-action=close]")) return closeBoard();
  const tab = e.target.closest("[data-mode]");
  if (tab) {
    boardMode = tab.dataset.mode;
    return renderBoard();
  }
  const row = e.target.closest("tr[data-id]");
  if (row) {
    closeBoard();
    selectTrain(row.dataset.id, { fly: true });
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !boardEl.hidden) closeBoard();
});
setInterval(() => !boardEl.hidden && renderBoard(), 15_000);

// ---------------------------------------------------------------------------
// My trip: one train from the stop you get on at to the stop you get off at, with the map
// following the train. It lives in the URL (?trip=<train>&from=<code>&to=<code>) and is
// remembered on this device, so a reload or a bookmark picks it straight back up.

const tripEl = $("#trip");
const TRIP_ZOOM = 13;
const AT_STATION_M = 200; // you're "at the station" this close to it
const ON_BOARD_M = 400; // and "on the train" this close to it once it's left your stop
const NEAR_STOP_M = 5_000; // a location fix this close to an upcoming stop picks it as yours
let wakeLock = null;
let locationWatch = null;

function tripTrain() {
  return state.trip ? state.trains.find((t) => t.trainID === state.trip.trainID) : undefined;
}

function startTrip(trainID, { from, to } = {}) {
  const t = state.trains.find((x) => x.trainID === trainID);
  if (!t) return;
  const codes = t.stations.map((s) => s.code);
  const chosen = codes.slice(0, -1).includes(from);
  const fromCode = chosen ? from : defaultBoarding(t);
  const toCode = codes.indexOf(to) > codes.indexOf(fromCode) ? to : codes.at(-1);
  state.trip = { trainID, from: fromCode, to: toCode, follow: true, fromAuto: !chosen, editing: false };
  state.selectedId = trainID;
  document.body.classList.add("has-detail", "trip-mode");
  document.body.classList.remove("panel-collapsed");
  saveTrip();
  applyTripStyle();
  render();
  followTrain(true);
  keepAwake();
  if (readPref("tripLocation") === "1" && locationWatch === null) toggleLocation();
}

function exitTrip() {
  state.trip = null;
  document.body.classList.remove("trip-mode");
  for (const key of ["trip", "from", "to"]) setUrlParam(key, null);
  if (locationWatch !== null) navigator.geolocation.clearWatch(locationWatch);
  locationWatch = null;
  state.me = null;
  map.getSource("me")?.setData(meGeoJSON());
  wakeLock?.release();
  map.setPadding({ top: 0, right: 0, bottom: 0, left: 0 });
  applyTripStyle();
  render();
}

function setTripStops(from, to) {
  const t = tripTrain();
  if (!t) return;
  const codes = t.stations.map((s) => s.code);
  if (codes.indexOf(to) <= codes.indexOf(from)) to = codes.at(-1);
  Object.assign(state.trip, { from, to, fromAuto: false });
  saveTrip();
  render();
}

// Where you'd most likely get on: the upcoming stop nearest you if we know where you are, else
// the stop the train is at or heading for.
function defaultBoarding(t) {
  const upcoming = t.stations.slice(0, -1).filter((s) => s.status !== "Departed");
  return (state.me && nearestStop(upcoming, state.me)) || (upcoming[0] ?? t.stations[0]).code;
}

function nearestStop(stops, point) {
  let best = null;
  for (const s of stops) {
    const st = state.stations[s.code];
    const d = st && Number.isFinite(st.lat) ? metersBetween(point, st) : Infinity;
    if (d < NEAR_STOP_M && (!best || d < best.d)) best = { code: s.code, d };
  }
  return best?.code ?? null;
}

function saveTrip() {
  const { trainID, from, to } = state.trip;
  setUrlParam("train", trainID);
  setUrlParam("trip", trainID);
  setUrlParam("from", from);
  setUrlParam("to", to);
  writePref("trip", JSON.stringify({ trainID, from, to }));
}

function savedTrip() {
  try {
    return JSON.parse(readPref("trip") ?? "null");
  } catch {
    return null;
  }
}

function readPref(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

// Where the trip stands: waiting for the train at your stop, boarding, riding, or arrived.
function tripStatus(t, trip, now = Date.now()) {
  const stops = t.stations;
  const iFrom = stops.findIndex((s) => s.code === trip.from);
  const iTo = stops.findIndex((s) => s.code === trip.to);
  const nextIdx = stops.findIndex((s) => s.status !== "Departed");
  const { at } = stopContext(t, isMoving(t, now));
  const atIdx = at ? stops.indexOf(at) : -1;
  let phase;
  if (nextIdx < 0 || nextIdx > iTo || atIdx === iTo) phase = "arrived";
  else if (nextIdx > iFrom) phase = "riding";
  else if (atIdx === iFrom) phase = "boarding";
  else phase = "waiting";
  return { phase, iFrom, iTo, nextIdx, from: stops[iFrom], to: stops[iTo], next: stops[nextIdx] ?? null };
}

// A stop's estimated arrival or departure (falling back to the timetable) and how late that is.
function stopTime(s, kind) {
  return Date.parse(kind === "arr" ? s.arr || s.schArr || s.dep || s.schDep : s.dep || s.schDep || s.arr || s.schArr);
}

function stopLateness(s, kind) {
  const sch = Date.parse(kind === "arr" ? s.schArr || s.schDep : s.schDep || s.schArr);
  const mins = Math.round((stopTime(s, kind) - sch) / 60_000);
  if (!Number.isFinite(mins)) return "";
  if (Math.abs(mins) < 2) return "on time";
  return mins > 0 ? `${fmtAge(mins)} late` : `${fmtAge(-mins)} early`;
}

// The trip card's big line: a countdown with its caption, or `due` (e.g. "Due now") once it's up.
function countdown(ms, caption, due) {
  const min = (ms - Date.now()) / 60_000;
  if (!Number.isFinite(min)) return "—";
  return min < 1 ? due : `${fmtAge(min)} <span>${caption}</span>`;
}

function fmtDistance(m) {
  const mi = m / 1609.34;
  return m < 300 ? `${Math.round((m * 3.281) / 50) * 50 || 50} ft` : `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
}

function renderTrip() {
  if (!state.trip) return;
  // Re-rendering would close a stop menu someone has open.
  if (document.activeElement?.tagName === "SELECT" && tripEl.contains(document.activeElement)) return;
  const t = tripTrain();
  if (!t) {
    tripEl.innerHTML = `<button class="back" data-action="exit-trip">← All trains</button><p class="empty">This train is no longer reporting.</p>`;
    return;
  }
  const trip = tripStatus(t, state.trip);
  const { phase, from, to, next } = trip;
  const platform = from.platform ? ` · Track ${esc(from.platform)}` : "";
  const departs = `Departs ${fmtClock(stopTime(from, "dep"), from.tz)} · ${stopLateness(from, "dep")}${platform}`;
  const away = trip.iFrom - trip.nextIdx;
  const hero = {
    waiting: {
      kicker: `Waiting at ${esc(from.name)}`,
      big: countdown(stopTime(from, "arr"), "until the train gets here", "Due now"),
      sub: departs,
      note:
        t.trainState === "Predeparture"
          ? `Not yet left ${esc(t.origName)}`
          : away === 0
            ? "Your stop is next"
            : `${away} stop${away > 1 ? "s" : ""} away · next ${esc(next?.name)}`,
    },
    boarding: {
      kicker: `Boarding at ${esc(from.name)}`,
      big: countdown(stopTime(from, "dep"), "until departure", "Leaving now"),
      sub: departs,
      note: "The train is in the station",
    },
    riding: {
      kicker: `On board · ${trip.iTo - trip.nextIdx + 1} stop${trip.iTo - trip.nextIdx ? "s" : ""} to go`,
      big: countdown(stopTime(to, "arr"), `to ${esc(to.name)}`, `Arriving at ${esc(to.name)}`),
      sub: `Arrives ${fmtClock(stopTime(to, "arr"), to.tz)} · ${stopLateness(to, "arr")}`,
      note: trip.nextIdx === trip.iTo ? "Your stop is next" : `Next: ${esc(next?.name)} · ${fmtClock(stopTime(next, "arr"), next.tz)}`,
    },
    arrived: { kicker: "Trip complete", big: `Arrived <span>at ${esc(to.name)}</span>`, sub: fmtClock(stopTime(to, "arr"), to.tz), note: "" },
  }[phase];
  const start = stopTime(from, "dep");
  const progress = phase === "arrived" ? 1 : phase === "riding" ? Math.min(1, Math.max(0, (Date.now() - start) / (stopTime(to, "arr") - start))) : 0;
  const stops = t.stations.slice(trip.iFrom, trip.iTo + 1);
  tripEl.innerHTML = `
    <button class="back" data-action="exit-trip">← Train details</button>
    <h2><span class="badge" style="background:${esc(t.iconColor)};color:${esc(t.textColor)}">${esc(t.trainNum)}</span> ${esc(t.routeName)}</h2>
    <p class="od">${esc(from.name)} → ${esc(to.name)}</p>
    <section class="trip-hero ${phase}">
      <div class="trip-kicker">${hero.kicker}</div>
      <div class="trip-big">${hero.big}</div>
      <div class="trip-sub">${hero.sub}</div>
      ${phase === "riding" || phase === "arrived" ? `<div class="trip-progress"><span style="width:${(progress * 100).toFixed(1)}%"></span></div>` : ""}
      ${hero.note ? `<div class="trip-note">${hero.note}</div>` : ""}
      ${tripLocationNote(t, trip)}
    </section>
    <div class="trip-actions">
      <button data-action="follow" aria-pressed="${state.trip.follow}">${state.trip.follow ? "Following the train" : "Centre on the train"}</button>
      <button data-action="locate" aria-pressed="${locationWatch !== null}">${locationWatch !== null ? "Location on" : "Use my location"}</button>
      <button data-action="share">Share trip</button>
    </div>
    ${t.statusMsg?.trim() ? `<p class="alert">${esc(t.statusMsg)}</p>` : ""}
    <ol class="timeline trip-stops">
      ${stops
        .map((s, i) => {
          const end = i === 0 ? "Get on" : i === stops.length - 1 ? "Get off" : "";
          const done = s.status === "Departed";
          const kind = i === 0 ? "dep" : "arr";
          return `<li class="${done ? "done" : ""}${next && s.code === next.code ? " next" : ""}">
            <span class="dot" style="border-color:${esc(s.stopIconColor || "#888")}"></span>
            <span class="stop-name">${esc(s.name)}${end ? ` <span class="trip-end">${end}</span>` : ""}</span>
            <span class="stop-time">${fmtClock(stopTime(s, kind), s.tz)}</span>
          </li>`;
        })
        .join("")}
    </ol>
    <details class="trip-edit"${state.trip.editing ? " open" : ""}>
      <summary>Change my stops</summary>
      <label>Get on at <select data-stop="from">${stopOptions(t.stations.slice(0, -1), state.trip.from)}</select></label>
      <label>Get off at <select data-stop="to">${stopOptions(t.stations.slice(trip.iFrom + 1), state.trip.to)}</select></label>
    </details>`;
}

function stopOptions(stops, selected) {
  return stops.map((s) => `<option value="${esc(s.code)}"${s.code === selected ? " selected" : ""}>${esc(s.name)}</option>`).join("");
}

function tripLocationNote(t, trip) {
  if (state.meError) return `<div class="trip-me">${esc(state.meError)}</div>`;
  if (!state.me || trip.phase === "arrived") return "";
  let text;
  if (trip.phase === "riding") {
    const d = metersBetween(state.me, trainPosition(t));
    text = d < ON_BOARD_M ? "You're on the train" : `You're ${fmtDistance(d)} from the train`;
  } else {
    const st = state.stations[trip.from.code];
    const d = st ? metersBetween(state.me, st) : Infinity;
    text = !Number.isFinite(d) ? "" : d < AT_STATION_M ? `You're at ${esc(trip.from.name)}` : `You're ${fmtDistance(d)} from ${esc(trip.from.name)}`;
  }
  return text ? `<div class="trip-me">${text}</div>` : "";
}

tripEl.addEventListener("click", (e) => {
  if (e.target.closest("[data-action=exit-trip]")) return exitTrip();
  if (e.target.closest("[data-action=follow]")) {
    state.trip.follow = !state.trip.follow;
    if (state.trip.follow) followTrain(true);
    return renderTrip();
  }
  if (e.target.closest("[data-action=locate]")) return toggleLocation();
  const share = e.target.closest("[data-action=share]");
  if (share) copyLink(share);
});
tripEl.addEventListener("change", (e) => {
  const which = e.target.dataset.stop;
  if (!which) return;
  e.target.blur(); // let renderTrip redraw
  const { from, to } = state.trip;
  if (which === "from") setTripStops(e.target.value, to);
  else setTripStops(from, e.target.value);
});
// <details> toggles don't bubble, so listen while the event is on its way down.
tripEl.addEventListener("toggle", (e) => state.trip && (state.trip.editing = e.target.open), true);

// Keep the train centred in the part of the map the panel doesn't cover. The map holds still
// until the train drifts FOLLOW_SLACK_PX off centre and then glides back: moving it every frame
// starves tile loading and runs down a phone's battery.
const FOLLOW_SLACK_PX = 40;

function followTrain(fly = false) {
  const t = tripTrain();
  if (!t || !state.trip.follow) return;
  const pos = trainPosition(t);
  const panel = $("#panel").getBoundingClientRect();
  const padding = window.innerWidth > 640 ? { top: 0, right: 0, bottom: 0, left: panel.right } : { top: 0, right: 0, bottom: window.innerHeight - panel.top, left: 0 };
  const camera = { center: [pos.lon, pos.lat], padding };
  if (fly) return map.flyTo({ ...camera, zoom: Math.max(map.getZoom(), TRIP_ZOOM), speed: 1.6 }, { tripFollow: true });
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const at = map.project(camera.center);
  const drift = Math.hypot(at.x - (padding.left + (w - padding.left) / 2), at.y - (h - padding.bottom) / 2);
  if (drift > FOLLOW_SLACK_PX) map.easeTo({ ...camera, duration: reduceMotion ? 0 : 1000 }, { tripFollow: true });
}

// Dragging the map is a sign you want to look around: stop following until asked again.
map.on("dragstart", () => {
  if (!state.trip?.follow) return;
  state.trip.follow = false;
  renderTrip();
});

function toggleLocation() {
  if (locationWatch !== null) {
    navigator.geolocation.clearWatch(locationWatch);
    locationWatch = null;
    state.me = null;
    writePref("tripLocation", "0");
  } else if (!navigator.geolocation) {
    state.meError = "Location isn't available in this browser.";
  } else {
    state.meError = null;
    writePref("tripLocation", "1");
    locationWatch = navigator.geolocation.watchPosition(onLocation, onLocationError, { enableHighAccuracy: true, maximumAge: 15_000 });
  }
  map.getSource("me")?.setData(meGeoJSON());
  renderTrip();
}

function onLocation(p) {
  state.me = { lon: p.coords.longitude, lat: p.coords.latitude };
  map.getSource("me")?.setData(meGeoJSON());
  // The first fix can pick the stop you're waiting at, unless you chose one yourself.
  const t = tripTrain();
  if (t && state.trip.fromAuto && ["waiting", "boarding"].includes(tripStatus(t, state.trip).phase)) {
    state.trip.fromAuto = false;
    const near = nearestStop(t.stations.slice(0, -1).filter((s) => s.status !== "Departed"), state.me);
    if (near && near !== state.trip.from) return setTripStops(near, state.trip.to);
  }
  renderTrip();
}

function onLocationError(err) {
  state.meError = err.code === err.PERMISSION_DENIED ? "Location permission was turned down." : "Couldn't find your location.";
  if (err.code === err.PERMISSION_DENIED) {
    navigator.geolocation.clearWatch(locationWatch);
    locationWatch = null;
    writePref("tripLocation", "0");
  }
  renderTrip();
}

function meGeoJSON() {
  return {
    type: "FeatureCollection",
    features: state.me ? [{ type: "Feature", geometry: { type: "Point", coordinates: [state.me.lon, state.me.lat] }, properties: {} }] : [],
  };
}

// Your leg of the route, from the stop you get on at to the one you get off at.
function tripLegGeoJSON() {
  const t = tripTrain();
  const empty = { type: "FeatureCollection", features: [] };
  if (!t) return empty;
  const { iFrom, iTo } = tripStatus(t, state.trip);
  const ends = [state.stations[state.trip.from], state.stations[state.trip.to]];
  if (ends.some((s) => !s || !Number.isFinite(s.lat))) return empty;
  const leg =
    sliceTrack(shapeFor(t), ...ends) ??
    t.stations
      .slice(iFrom, iTo + 1)
      .map((s) => state.stations[s.code])
      .filter((s) => s && Number.isFinite(s.lat))
      .map((s) => [s.lon, s.lat]);
  return leg.length > 1 ? { type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "LineString", coordinates: leg }, properties: {} }] } : empty;
}

// On a trip the rest of the train's route fades back so your leg stands out.
function applyTripStyle() {
  for (const id of ["route-casing", "route-line", "route-line-approx"]) {
    if (map.getLayer(id)) map.setPaintProperty(id, "line-opacity", state.trip ? 0.35 : 1);
  }
  map.getSource("trip-leg")?.setData(tripLegGeoJSON());
}

// Keep the screen on while a trip is open (where the browser allows it), and catch up on the
// train as soon as the page is looked at again.
async function keepAwake() {
  if (!state.trip || wakeLock || document.visibilityState !== "visible" || !("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => (wakeLock = null));
  } catch {}
}
document.addEventListener("visibilitychange", () => {
  if (!state.trip || document.visibilityState !== "visible") return;
  keepAwake();
  refresh();
});

// ---------------------------------------------------------------------------
// Helpers

function nextStop(t) {
  return t.stations.find((s) => s.status !== "Departed") ?? null;
}

// One end of the side view's stop row: the name shrinks with an ellipsis, the time never does,
// and the time is left out when the API has none for that stop.
function stageStop(stop, kind) {
  if (!stop) return `<span class="stop ${kind}"></span>`;
  const iso = kind === "last" ? stop.dep || stop.arr : stop.arr || stop.dep;
  const time = fmtClock(Date.parse(iso), stop.tz);
  const name = `<span class="name">${esc(stop.name)}</span>`;
  const when = time ? `<span class="time">· ${time}</span>` : "";
  return kind === "last" ? `<span class="stop last">◀ ${name}${when}</span>` : `<span class="stop upcoming">${name}${when} ▶</span>`;
}

// The stop a train is standing at (if any), the one it last left and the one it's heading for.
// "At" means the API says it's in the station, or it's stopped within 800 m of its next stop.
// "Arriving" means it's still moving but in the station already or within ARRIVING_M of it.
// A train counts as moving if it reported speed and dead reckoning hasn't yet carried it up to
// its next stop; once it gets there it's treated as stopped (arrived) until a fresh fix.
function isMoving(t, now = Date.now()) {
  return (t.velocity ?? 0) > 1 && !arrivedByReckoning(t, now);
}

function arrivedByReckoning(t, now = Date.now()) {
  return hasArrived(state.plans.get(t.trainID), now);
}

function stopContext(t, moving) {
  const stops = t.stations;
  const nextIdx = stops.findIndex((s) => s.status !== "Departed");
  const stationIdx = stops.findIndex((s) => s.status === "Station");
  const toNext = nextIdx >= 0 ? distanceToStop(t, stops[nextIdx]) : Infinity;
  if (moving) {
    const arrivingIdx = stationIdx >= 0 ? stationIdx : toNext < ARRIVING_M ? nextIdx : -1;
    if (arrivingIdx >= 0) return { at: null, arriving: stops[arrivingIdx], last: stops[arrivingIdx - 1] ?? null, upcoming: stops[arrivingIdx + 1] ?? null };
  } else {
    const atIdx = stationIdx >= 0 ? stationIdx : toNext < 800 ? nextIdx : -1;
    if (atIdx >= 0) return { at: stops[atIdx], arriving: null, last: stops[atIdx - 1] ?? null, upcoming: stops[atIdx + 1] ?? null };
  }
  const lastIdx = nextIdx < 0 ? stops.length - 1 : nextIdx - 1;
  return { at: null, arriving: null, last: stops[lastIdx] ?? null, upcoming: nextIdx >= 0 ? stops[nextIdx] : null };
}

function distanceToStop(t, stop) {
  const st = state.stations[stop.code];
  if (!st || !Number.isFinite(st.lat)) return Infinity;
  return metersBetween(trainPosition(t), st);
}

function timeliness(t) {
  if (t.trainState === "Predeparture") return { label: "Not departed" };
  const s = nextStop(t) ?? t.stations.at(-1);
  if (!s) return { label: "—" };
  const sch = Date.parse(s.schArr || s.schDep);
  const act = Date.parse(s.arr || s.dep);
  if (!Number.isFinite(sch) || !Number.isFinite(act)) return { label: "—" };
  const mins = Math.round((act - sch) / 60000);
  if (Math.abs(mins) < 2) return { label: "On time" };
  const h = Math.floor(Math.abs(mins) / 60);
  const m = Math.abs(mins) % 60;
  const span = h ? `${h}h ${m}m` : `${m}m`;
  return { label: mins > 0 ? `${span} late` : `${span} early` };
}

function fmtTime(iso, tz) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return "";
  try {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" });
  } catch {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

// "<1 min", "4 min", "1h 12m" for an age in minutes.
function fmtAge(minutes) {
  if (minutes < 1) return "<1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}

function fmtClock(ms, tz) {
  if (!Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: tz });
  } catch {
    return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
}

function setStatus(text) {
  $("#status").textContent = text;
}

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
