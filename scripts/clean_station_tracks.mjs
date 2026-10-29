// Turn the raw station track extract into a navigable track network.
//
// Overture's rail segments arrive cut at tile edges, with near-misses at switches and plenty of
// yard and industrial track Amtrak never runs on. For each station this:
//   1. snaps vertices within SNAP_M together and drops duplicated pieces,
//   2. joins dead ends that face each other across a gap, and extends dead ends that stop just
//      short of another track (a missed switch) onto it,
//   3. prunes track Amtrak never runs on: stretches far from every Amtrak route, yards and
//      sidings (peeled off dead end by dead end), tiny stubs, and pieces that never reach a
//      route, and
//   4. merges what's left into one line per stretch between junctions.
// Each output line carries `from` and `to` node ids, and lines meeting at a node share its exact
// coordinates, so the result can be walked as a graph.
//
// Used by build_station_tracks.mjs; run on its own to clean the existing file in place:
//   npm run station-tracks:clean

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SNAP_M = 1; // vertices closer than this are the same point
const GAP_M = 200; // two dead ends facing each other this close are one track with a gap
const GAP_ANGLE = 12; // degrees either end may point off the line joining them
const EXTEND_M = 30; // how far a dead end may be extended to meet another track
const EXTEND_ANGLE = 35; // degrees off the end's own direction an extension may bend
const JOIN_M = 3; // a dead end this close to a track joins it whatever the direction
const EDGE_M = 30; // dead ends this close to the extract's edge just leave the box; leave them
const ON_ROUTE_M = 25; // track this close to an Amtrak route is track Amtrak runs on
const KEEP_M = 120; // a stretch of track straying further than this from every route is pruned
const YARD_M = 60; // a dead-end track ending further than this from a route is yard or siding
const STUB_M = 40; // dead-end stubs shorter than this (and off the route) are trimmed
const PRECISION = 6;

/**
 * @param features  LineString features with a `station` property
 * @param routes    Amtrak route LineString features (data/routes.geojson)
 * @param centers   station code -> [lon, lat]; each extract is a box `radius` meters each way
 * @returns cleaned LineString features: { station, from, to, length_m }
 */
export function cleanTracks(features, routes, centers, radius) {
  const byStation = Map.groupBy(features, (f) => f.properties.station);
  const out = [];
  for (const [station, group] of byStation) {
    if (!centers[station]) continue;
    // A second pass settles the points the first one added (they snap to their neighbours once
    // they're ordinary vertices), so cleaning the output again leaves it unchanged.
    const once = cleanStation(station, group, routes, centers[station], radius);
    out.push(...cleanStation(station, once, routes, centers[station], radius));
  }
  return out;
}

function cleanStation(station, group, routes, [lon0, lat0], radius) {
  // Work in local meters around the station. The box is the extract's own (not the extent of
  // what's left of it), so cleaning an already-cleaned file changes nothing.
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110_540;
  const toXY = ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky];
  const toLonLat = ([x, y]) => [+(lon0 + x / kx).toFixed(PRECISION), +(lat0 + y / ky).toFixed(PRECISION)];
  const box = { w: -radius, e: radius, s: -radius, n: radius };
  const nearEdge = ([x, y]) => x - box.w < EDGE_M || box.e - x < EDGE_M || y - box.s < EDGE_M || box.n - y < EDGE_M;

  // 1. Snap vertices into shared points and collect the undirected segments between them.
  const points = [];
  const grid = new Map();
  const cell = ([x, y]) => `${Math.floor(x / SNAP_M)},${Math.floor(y / SNAP_M)}`;
  const pointId = (p) => {
    const [cx, cy] = cell(p).split(",").map(Number);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const id of grid.get(`${cx + dx},${cy + dy}`) ?? []) if (dist(points[id], p) < SNAP_M) return id;
      }
    }
    return addPoint(p);
  };
  // A new point, findable by later snapping but not snapped itself.
  const addPoint = (p) => {
    points.push(p);
    const k = cell(p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(points.length - 1);
    return points.length - 1;
  };
  const adj = new Map(); // point id -> Set of neighbour ids
  const link = (a, b) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  };
  const unlink = (a, b) => {
    adj.get(a)?.delete(b);
    adj.get(b)?.delete(a);
    if (adj.get(a)?.size === 0) adj.delete(a);
    if (adj.get(b)?.size === 0) adj.delete(b);
  };
  for (const f of group) {
    const ids = f.geometry.coordinates.map((c) => pointId(toXY(c)));
    for (let i = 1; i < ids.length; i++) link(ids[i - 1], ids[i]);
  }
  const segments = () => {
    const segs = [];
    for (const [a, ns] of adj) for (const b of ns) if (a < b) segs.push([a, b]);
    return segs;
  };

  // Steps 2 and 3 repeat until nothing changes: pruning can expose new dead ends to join or
  // trim, and doing it here means cleaning an already-cleaned file leaves it as it is.
  const signature = () => segments().map((s) => s.join("-")).sort().join(",");
  const tidy = () => {
    // 2. Close gaps: first between dead ends that face each other along the same line (a stretch
    // missing from the extract), then from dead ends onto a track just ahead (a missed switch).
    const deadEnds = () => [...adj].filter(([v, ns]) => ns.size === 1 && !nearEdge(points[v])).map(([v]) => ({ v, d: unit(sub(points[v], points[walkBack(adj, points, v, 10)])) }));
    const facing = Math.cos((GAP_ANGLE * Math.PI) / 180);
    const gaps = [];
    const ends = deadEnds();
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        const { v: u, d: du } = ends[i];
        const { v, d: dv } = ends[j];
        const w = sub(points[v], points[u]);
        const len = Math.hypot(...w);
        if (len > GAP_M || len < 1e-6) continue;
        if ((w[0] * du[0] + w[1] * du[1]) / len < facing || -(w[0] * dv[0] + w[1] * dv[1]) / len < facing) continue;
        gaps.push({ u, v, len });
      }
    }
    for (const { u, v } of gaps.sort((a, b) => a.len - b.len)) if (adj.get(u)?.size === 1 && adj.get(v)?.size === 1) link(u, v);

    const segs = segments();
    for (const { v, d } of deadEnds()) {
      let best = null;
      for (const [a, b] of segs) {
        if (!adj.get(a)?.has(b)) continue; // split since
        if (a === v || b === v) continue;
        const p = closestOnSegment(points[v], points[a], points[b]);
        const w = sub(p, points[v]);
        const len = Math.hypot(...w);
        if (len > EXTEND_M) continue;
        const ahead = len < 1e-6 ? 1 : (w[0] * d[0] + w[1] * d[1]) / len;
        if (len > JOIN_M && ahead < Math.cos((EXTEND_ANGLE * Math.PI) / 180)) continue;
        if (!best || len < best.len) best = { a, b, p, len };
      }
      if (!best) continue;
      const { a, b, p } = best;
      let target = dist(p, points[a]) < SNAP_M * 2 ? a : dist(p, points[b]) < SNAP_M * 2 ? b : -1;
      if (target < 0) {
        // Registered for snapping, so a re-run lands on the same point.
        target = addPoint(p);
        unlink(a, b);
        link(a, target);
        link(target, b);
        segs.push([a, target], [target, b]);
      }
      link(v, target);
      segs.push([v, target]);
    }

    // 3. Prune what Amtrak never runs on. A stretch that strays more than KEEP_M from every Amtrak
    // route goes; then dead-end tracks are peeled off repeatedly when they end away from the route
    // (yard and siding tracks, so a whole yard comes away back to its ladder) or are tiny stubs;
    // last, any piece of network left that never reaches a route goes too.
    const routeSegs = routeSegments(routes, toXY, box);
    const routeDist = (p) => routeSegs.near(p);
    const onRoute = (a, b) => routeDist([(points[a][0] + points[b][0]) / 2, (points[a][1] + points[b][1]) / 2]) <= ON_ROUTE_M;
    const remove = (chain) => {
      for (let i = 1; i < chain.length; i++) unlink(chain[i - 1], chain[i]);
    };
    for (const chain of chains(adj)) if (Math.max(...chain.map((v) => routeDist(points[v]))) > KEEP_M) remove(chain);
    for (let pass = 0, changed = true; changed && pass < 50; pass++) {
      changed = false;
      for (const chain of chains(adj)) {
        if (chain[0] === chain.at(-1)) continue;
        const degrees = [chain[0], chain.at(-1)].map((v) => adj.get(v)?.size ?? 0);
        if (degrees[0] !== 1 && degrees[1] !== 1) continue;
        const end = points[degrees[0] === 1 ? chain[0] : chain.at(-1)];
        if (nearEdge(end)) continue; // carries on beyond the extract
        const yard = routeDist(end) > YARD_M;
        const stub = lengthOf(chain, points) < STUB_M && !chain.slice(1).some((v, i) => onRoute(chain[i], v));
        if (yard || stub) (remove(chain), (changed = true));
      }
    }
    const seen = new Set();
    for (const start of [...adj.keys()]) {
      if (seen.has(start)) continue;
      const component = [];
      const stack = [start];
      seen.add(start);
      while (stack.length) {
        const v = stack.pop();
        component.push(v);
        for (const n of adj.get(v) ?? []) if (!seen.has(n)) (seen.add(n), stack.push(n));
      }
      const touches = component.some((v) => [...(adj.get(v) ?? [])].some((n) => onRoute(v, n)));
      if (!touches) for (const v of component) for (const n of [...(adj.get(v) ?? [])]) unlink(v, n);
    }
  };
  for (let round = 0; round < 8; round++) {
    const before = signature();
    tidy();
    if (signature() === before) break;
  }


  // 4. One line per stretch between junctions, with node ids at both ends.
  const nodeIds = new Map();
  const nodeId = (v) => {
    if (!nodeIds.has(v)) nodeIds.set(v, `${station}:${nodeIds.size}`);
    return nodeIds.get(v);
  };
  return chains(adj).map((chain) => ({
    type: "Feature",
    properties: { station, from: nodeId(chain[0]), to: nodeId(chain.at(-1)), length_m: Math.round(lengthOf(chain, points)) },
    geometry: { type: "LineString", coordinates: chain.map((v) => toLonLat(points[v])) },
  }));
}

// Split the graph into runs between nodes that aren't simple pass-throughs (degree ≠ 2).
function chains(adj) {
  const isNode = (v) => adj.get(v).size !== 2;
  const used = new Set();
  const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
  const out = [];
  const walk = (start, next) => {
    const chain = [start];
    let prev = start;
    let cur = next;
    used.add(key(prev, cur));
    while (true) {
      chain.push(cur);
      if (isNode(cur) || cur === start) return chain;
      const onward = [...adj.get(cur)].find((n) => n !== prev && !used.has(key(cur, n)));
      if (onward === undefined) return chain;
      used.add(key(cur, onward));
      prev = cur;
      cur = onward;
    }
  };
  for (const v of adj.keys()) if (isNode(v)) for (const n of adj.get(v)) if (!used.has(key(v, n))) out.push(walk(v, n));
  for (const v of adj.keys()) for (const n of adj.get(v)) if (!used.has(key(v, n))) out.push(walk(v, n)); // closed loops
  return out;
}

// A point about `meters` back along the line from dead end `v`, for a steady end direction.
function walkBack(adj, points, v, meters) {
  let prev = v;
  let cur = [...adj.get(v)][0];
  let run = dist(points[v], points[cur]);
  while (run < meters && adj.get(cur)?.size === 2) {
    const next = [...adj.get(cur)].find((n) => n !== prev);
    run += dist(points[cur], points[next]);
    prev = cur;
    cur = next;
  }
  return cur;
}

// Amtrak route segments near the extract, bucketed on a grid for quick nearest-distance lookups.
function routeSegments(routes, toXY, box) {
  const CELL = 250;
  const grid = new Map();
  const pad = KEEP_M + CELL;
  // Some GTFS segments run for kilometres, so test the segment's extent, not its endpoints.
  const overlapsBox = (a, b) => Math.max(a[0], b[0]) > box.w - pad && Math.min(a[0], b[0]) < box.e + pad && Math.max(a[1], b[1]) > box.s - pad && Math.min(a[1], b[1]) < box.n + pad;
  for (const f of routes) {
    const line = f.geometry.coordinates.map(toXY);
    for (let i = 1; i < line.length; i++) {
      const a = line[i - 1];
      const b = line[i];
      if (!overlapsBox(a, b)) continue;
      // Long GTFS segments are split so each lands in the cells it actually crosses.
      const steps = Math.max(1, Math.ceil(dist(a, b) / (CELL / 2)));
      for (let s = 0; s < steps; s++) {
        const p = [a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps];
        const q = [a[0] + ((b[0] - a[0]) * (s + 1)) / steps, a[1] + ((b[1] - a[1]) * (s + 1)) / steps];
        const k = `${Math.floor(p[0] / CELL)},${Math.floor(p[1] / CELL)}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push([p, q]);
      }
    }
  }
  return {
    near([x, y]) {
      const cx = Math.floor(x / CELL);
      const cy = Math.floor(y / CELL);
      let best = Infinity;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (const [a, b] of grid.get(`${cx + dx},${cy + dy}`) ?? []) best = Math.min(best, dist([x, y], closestOnSegment([x, y], a, b)));
        }
      }
      return best;
    },
  };
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const unit = (v) => {
  const len = Math.hypot(...v) || 1;
  return [v[0] / len, v[1] / len];
};
const lengthOf = (chain, points) => chain.slice(1).reduce((sum, v, i) => sum + dist(points[chain[i]], points[v]), 0);

function closestOnSegment(p, a, b) {
  const d = sub(b, a);
  const len2 = d[0] ** 2 + d[1] ** 2;
  const u = len2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1]) / len2)) : 0;
  return [a[0] + u * d[0], a[1] + u * d[1]];
}

// CLI: clean data/station-tracks.geojson in place.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = new URL("../data/station-tracks.geojson", import.meta.url);
  const fc = JSON.parse(readFileSync(file));
  const routes = JSON.parse(readFileSync(new URL("../data/routes.geojson", import.meta.url))).features;
  if (!fc.metadata.stations) {
    // Older files don't record the station locations; look them up.
    const all = await (await fetch("https://api-v3.amtraker.com/v3/stations")).json();
    const codes = new Set(fc.features.map((f) => f.properties.station));
    fc.metadata.stations = Object.fromEntries([...codes].filter((c) => all[c]).map((c) => [c, [all[c].lon, all[c].lat]]));
  }
  const before = fc.features.length;
  fc.features = cleanTracks(fc.features, routes, fc.metadata.stations, fc.metadata.radius_m);
  const out = JSON.stringify(fc);
  writeFileSync(file, out);
  console.log(`${before} lines -> ${fc.features.length} (${Math.round(out.length / 1024)} KB)`);
}
