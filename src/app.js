import { buildStyle } from "./style.js";
import { buildSprites, buildArrow, spriteImageData, SCALE, VEHICLE } from "./sprites.js";
import { planMotion, positionAt, trailAt } from "./motion.js";

const API = "https://api-v3.amtraker.com/v3";
const REFRESH_MS = 60_000;
const MOTION_MS = 100; // how often extrapolated positions are redrawn
const SPRITE_ZOOM = 8; // below this, trains are drawn as a slice of track instead of a sprite
const CAR_ZOOMS = [10, 11.5, 12.5, 13.25, 14, 14.75]; // zoom at which the 1st, 2nd, … car is coupled on behind the loco
const ICON_SIZE = [7, 0.6, 12, 0.95, 15, 1.6]; // [zoom, size, …] for vehicle sprites
const TRAIL_PX = 26; // on-screen length of a low-zoom train

const HEADING_DEG = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const sprites = buildSprites();
const spriteUrls = Object.fromEntries(Object.entries(sprites).map(([k, c]) => [k, c.toDataURL()]));
const arrow = buildArrow();

const state = {
  trains: [], // flattened list of train objects
  stations: {},
  selectedId: null,
  query: "",
  routes: { type: "FeatureCollection", features: [] }, // GTFS track geometry, see scripts/build_routes.py
  trainShapes: {}, // train number -> shape id
  shapeCoords: new Map(), // shape id -> [lon, lat][]
  plans: new Map(), // trainID -> dead-reckoning plan, rebuilt on every refresh
  loaded: false, // first successful fetch applies ?train= / ?station=
  theme: preferredTheme(),
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
  hash: true,
  attributionControl: { compact: true, customAttribution: 'Train data <a href="https://amtraker.com">Amtraker</a>' },
});
map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), "bottom-right");
map.addControl(new maplibregl.GeolocateControl({ trackUserLocation: false }), "bottom-right");

map.on("style.load", addOverlays);

function addOverlays() {
  for (const [id, canvas] of Object.entries(sprites)) {
    if (!id.startsWith("side-") && !map.hasImage(id)) {
      map.addImage(id, spriteImageData(canvas), { pixelRatio: SCALE / 1.5 });
    }
  }

  map.addSource("corridors", { type: "geojson", data: state.routes });
  map.addSource("route", { type: "geojson", data: routeGeoJSON() });
  map.addSource("stations", { type: "geojson", data: stationsGeoJSON() });
  if (!map.hasImage("arrow")) map.addImage("arrow", spriteImageData(arrow), { pixelRatio: SCALE / 1.5 });

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
  map.addLayer({
    id: "stations",
    type: "circle",
    source: "stations",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 3, ["case", ["get", "onRoute"], 4, 1.6], 10, ["case", ["get", "onRoute"], 7, 5]],
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
    paint: { "line-color": "#141a28", "line-width": ["case", ["get", "selected"], 9, 7] },
  });
  map.addLayer({
    id: "train-trail",
    type: "line",
    source: "train-trails",
    maxzoom: SPRITE_ZOOM,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#2f5bc4", "line-width": ["case", ["get", "selected"], 6, 4.5] },
  });
  map.addLayer({
    id: "train-trail-stripe",
    type: "line",
    source: "train-trails",
    maxzoom: SPRITE_ZOOM,
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: { "line-color": "#e9edf3", "line-width": 1.2 },
  });
  map.addLayer({
    id: "train-heads",
    type: "symbol",
    source: "trains",
    maxzoom: SPRITE_ZOOM,
    layout: {
      "icon-image": "arrow",
      "icon-rotate": ["get", "bearing"],
      "icon-rotation-alignment": "map",
      "icon-size": 0.55,
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
  });
  // Train number label at the head.
  map.addLayer({
    id: "trains",
    type: "symbol",
    source: "trains",
    minzoom: SPRITE_ZOOM,
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
}

const TRAIN_LAYERS = ["train-vehicles", "trains", "train-heads", "train-trail-casing"];
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
    if (stationsRes) state.stations = await stationsRes.json();
    state.trains = Object.values(trains)
      .flat()
      .filter((t) => Number.isFinite(t.lat) && Number.isFinite(t.lon));
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
}

function shapeFor(t) {
  return state.shapeCoords.get(state.trainShapes[t.trainNum]);
}

function buildPlans() {
  state.plans = new Map(
    state.trains.map((t) => {
      const next = nextStop(t);
      const st = next && state.stations[next.code];
      return [t.trainID, planMotion(t, shapeFor(t), st && Number.isFinite(st.lat) ? st : undefined, HEADING_DEG[t.heading])];
    }),
  );
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

// Locomotive plus however many cars this zoom allows, each centred on the track `behind`
// meters back from the nose so the consist follows curves.
function vehicleFeatures(t, plan, now, zoom, metersPerPx, properties) {
  const cars = CAR_ZOOMS.filter((z) => zoom >= z).length;
  const metersPerArtPx = (SCALE / (SCALE / 1.5)) * iconSizeAt(zoom) * metersPerPx;
  const state = properties.moving ? "move" : "idle";
  const out = [];
  const place = (image, rowsBehind) => {
    const p = plan ? positionAt(plan, now, rowsBehind * metersPerArtPx) : trainPosition(t, now);
    out.push({ type: "Feature", geometry: { type: "Point", coordinates: [p.lon, p.lat] }, properties: { ...properties, image, bearing: p.bearing } });
  };
  place(`loco-${state}`, VEHICLE.locoCenter);
  for (let i = 0; i < cars; i++) {
    const center = VEHICLE.locoLength + i * (VEHICLE.carLength + VEHICLE.gap) + VEHICLE.carLength / 2;
    place(i === cars - 1 ? `car-tail-${state}` : `car-${state}`, center);
  }
  return out;
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
  for (const t of state.trains) {
    const pos = trainPosition(t, now);
    const properties = {
      trainID: t.trainID,
      trainNum: t.trainNum,
      iconColor: t.iconColor || "#888",
      textColor: t.textColor || "#000",
      bearing: pos.bearing,
      moving: (t.velocity ?? 0) > 1,
      selected: t.trainID === state.selectedId,
    };
    points.push({ type: "Feature", geometry: { type: "Point", coordinates: [pos.lon, pos.lat] }, properties });
    if (!nearView(pos)) continue;
    const plan = state.plans.get(t.trainID);
    const metersPerPx = (78271.517 * Math.cos((pos.lat * Math.PI) / 180)) / 2 ** zoom;
    if (zoom >= SPRITE_ZOOM) vehicles.push(...vehicleFeatures(t, plan, now, zoom, metersPerPx, properties));
    else if (plan) trails.push({ type: "Feature", geometry: { type: "LineString", coordinates: trailAt(plan, now, TRAIL_PX * metersPerPx) }, properties });
  }
  const fc = (features) => ({ type: "FeatureCollection", features });
  return { points: fc(points), trails: fc(trails), vehicles: fc(vehicles) };
}

function updateTrains() {
  const { points, trails, vehicles } = trainFeatures();
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
  renderList();
  if (state.selectedId) renderDetail();
  if (boardCode) renderBoard();
}

refresh();
setInterval(refresh, REFRESH_MS);

// Slide trains along between refreshes. Reduced-motion users get a slow step instead.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
let lastMotion = 0;
let zooming = false;
function animate(ts) {
  // Car spacing and trail length depend on zoom, so redraw every frame while zooming;
  // otherwise they lag behind icon-size and the cars bounce.
  if (zooming || ts - lastMotion >= (reduceMotion ? 10_000 : MOTION_MS)) {
    lastMotion = ts;
    zooming = false;
    updateTrains();
  }
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
map.on("zoom", () => (zooming = true));
map.on("moveend", () => (lastMotion = 0)); // pick up trains panned into view

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
  listEl.innerHTML = trains
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

listEl.addEventListener("click", (e) => {
  const row = e.target.closest(".train-row");
  if (row) selectTrain(row.dataset.id, { fly: true });
});

function selectTrain(id, { fly = false, fit = false } = {}) {
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
  const wanted = params.get("train");
  if (wanted) {
    // Accept a full train ID ("66-29") or just a number ("66"); IDs roll over daily.
    const num = wanted.split("-")[0];
    const t = state.trains.find((x) => x.trainID === wanted) ?? state.trains.find((x) => x.trainNum === num);
    if (t) selectTrain(t.trainID, { fit: !linkHasView });
  }
  const station = params.get("station");
  if (station && state.stations[station.toUpperCase()]) showStation(station.toUpperCase());
}

async function copyLink(button) {
  try {
    await navigator.clipboard.writeText(location.href);
    button.textContent = "Link copied";
  } catch {
    button.textContent = "Copy the address bar";
  }
  setTimeout(() => (button.textContent = "Share link"), 2000);
}

function renderDetail() {
  const t = selectedTrain();
  if (!t) {
    detailEl.innerHTML = `<button class="back" data-action="back">← All trains</button><p class="empty">This train is no longer reporting.</p>`;
    return;
  }
  const moving = (t.velocity ?? 0) > 1;
  const status = timeliness(t);
  const next = nextStop(t);
  detailEl.innerHTML = `
    <button class="back" data-action="back">← All trains</button>
    <div class="sprite-stage">
      <span class="motion-tag${moving ? " moving" : ""}">${moving ? `Moving · ${Math.round(t.velocity)} mph` : "Stopped"}</span>
      <img src="${spriteUrls[`side-${moving ? "move" : "idle"}`]}" alt="" />
      <div class="track${moving ? " moving" : ""}"></div>
    </div>
    <h2><span class="badge" style="background:${esc(t.iconColor)};color:${esc(t.textColor)}">${esc(t.trainNum)}</span> ${esc(t.routeName)}</h2>
    <p class="od">${esc(t.origName)} → ${esc(t.destName)}</p>
    <dl class="facts">
      <div><dt>Status</dt><dd>${esc(status.label)}</dd></div>
      <div><dt>Speed</dt><dd>${moving ? `${Math.round(t.velocity)} mph ${esc(t.heading ?? "")}` : "Stopped"}</dd></div>
      <div><dt>Next stop</dt><dd>${next ? `${esc(next.name)} · ${fmtTime(next.arr || next.dep, next.tz)}` : "—"}</dd></div>
      <div><dt>Operator</dt><dd>${esc(t.provider ?? "Amtrak")}</dd></div>
    </dl>
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
            <span class="stop-time">${fmtTime(act, s.tz)}${sch && act && sch !== act ? ` <s>${fmtTime(sch, s.tz)}</s>` : ""}</span>
          </li>`;
        })
        .join("")}
    </ol>`;
}

detailEl.addEventListener("click", (e) => {
  if (e.target.closest("[data-action=back]")) return clearSelection();
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
// Helpers

function nextStop(t) {
  return t.stations.find((s) => s.status !== "Departed") ?? null;
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

function fmtClock(ms, tz) {
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
