// Dead reckoning: assume each train holds its last reported speed and slide it along its
// GTFS track from the time of its last position fix. Distances are in meters, using a local
// equirectangular approximation, which is plenty accurate at segment scale.

const M_PER_DEG_LAT = 110_540;
const M_PER_DEG_LON = 111_320;
const MPH_TO_MPS = 0.44704;
const MAX_TRACK_S = 20 * 60; // never extrapolate a stale fix further than this
const MAX_FREE_S = 10 * 60; // off-track trains get less rope
const MAX_OFF_TRACK_M = 2000;

const cache = new WeakMap(); // coords array -> cumulative distance along it

function cumulative(coords) {
  let cum = cache.get(coords);
  if (cum) return cum;
  cum = new Float64Array(coords.length);
  for (let i = 1; i < coords.length; i++) {
    const [ax, ay] = coords[i - 1];
    const [bx, by] = coords[i];
    const kx = Math.cos((((ay + by) / 2) * Math.PI) / 180) * M_PER_DEG_LON;
    cum[i] = cum[i - 1] + Math.hypot((bx - ax) * kx, (by - ay) * M_PER_DEG_LAT);
  }
  cache.set(coords, cum);
  return cum;
}

// Nearest point on the line: distance along it and distance from it.
function project(coords, cum, lon, lat) {
  const kx = Math.cos((lat * Math.PI) / 180) * M_PER_DEG_LON;
  let best = { off: Infinity, along: 0 };
  for (let i = 0; i < coords.length - 1; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const dx = (bx - ax) * kx;
    const dy = (by - ay) * M_PER_DEG_LAT;
    const px = (lon - ax) * kx;
    const py = (lat - ay) * M_PER_DEG_LAT;
    const len2 = dx * dx + dy * dy;
    const u = len2 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
    const off = Math.hypot(px - u * dx, py - u * dy);
    if (off < best.off) best = { off, along: cum[i] + u * (cum[i + 1] - cum[i]) };
  }
  return best;
}

// Point and forward bearing at a distance along the line.
function pointAt(coords, cum, along) {
  const last = coords.length - 1;
  along = Math.max(0, Math.min(cum[last], along));
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  const [ax, ay] = coords[lo];
  const [bx, by] = coords[hi];
  const seg = cum[hi] - cum[lo];
  const u = seg ? (along - cum[lo]) / seg : 0;
  const kx = Math.cos((ay * Math.PI) / 180);
  return { lon: ax + u * (bx - ax), lat: ay + u * (by - ay), bearing: bearingOf((bx - ax) * kx, by - ay) };
}

function bearingOf(dx, dy) {
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

function angleDiff(a, b) {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * Build a motion plan for one train.
 * @param train     Amtraker train object
 * @param coords    GTFS shape for the train, or undefined
 * @param nextStop  {lon, lat} of the next station it hasn't departed, or undefined
 * @param compass   API heading in degrees, or undefined
 */
export function planMotion(train, coords, nextStop, compass) {
  const t0 = Date.parse(train.lastValTS) || Date.now();
  const speed = Math.max(0, train.velocity ?? 0) * MPH_TO_MPS;
  const fallback = { kind: "free", lon: train.lon, lat: train.lat, bearing: compass ?? 0, speed: compass === undefined ? 0 : speed, t0 };
  if (!coords || coords.length < 2) return fallback;

  const cum = cumulative(coords);
  const here = project(coords, cum, train.lon, train.lat);
  if (here.off > MAX_OFF_TRACK_M) return fallback;

  // Which way along the shape is the train going? Trust the compass heading when it has
  // one, otherwise head toward the next stop.
  const forward = pointAt(coords, cum, here.along).bearing;
  const stop = nextStop ? project(coords, cum, nextStop.lon, nextStop.lat) : null;
  let dir;
  if (compass !== undefined) dir = angleDiff(forward, compass) <= 90 ? 1 : -1;
  else dir = stop && stop.along < here.along ? -1 : 1;

  // Hold at the next stop rather than running through it; a fresh fix will move it on.
  let limit = dir > 0 ? cum[cum.length - 1] : 0;
  if (stop && stop.off < MAX_OFF_TRACK_M && (stop.along - here.along) * dir >= 0) limit = stop.along;

  return { kind: "track", coords, cum, along0: here.along, dir, limit, speed, t0 };
}

/** Extrapolated {lon, lat, bearing} for a plan at time `now` (ms), `behind` meters back along the track. */
export function positionAt(plan, now, behind = 0) {
  if (plan.kind === "free") {
    const s = Math.min(Math.max(0, (now - plan.t0) / 1000), MAX_FREE_S);
    const d = plan.speed * s - behind;
    const rad = (plan.bearing * Math.PI) / 180;
    const kx = Math.cos((plan.lat * Math.PI) / 180) * M_PER_DEG_LON;
    return { lon: plan.lon + (d * Math.sin(rad)) / kx, lat: plan.lat + (d * Math.cos(rad)) / M_PER_DEG_LAT, bearing: plan.bearing };
  }
  const s = Math.min(Math.max(0, (now - plan.t0) / 1000), MAX_TRACK_S);
  let along = plan.along0 + plan.dir * plan.speed * s;
  along = plan.dir > 0 ? Math.min(along, plan.limit) : Math.max(along, plan.limit);
  const p = pointAt(plan.coords, plan.cum, along - plan.dir * behind);
  return { lon: p.lon, lat: p.lat, bearing: plan.dir > 0 ? p.bearing : (p.bearing + 180) % 360 };
}

/**
 * The stretch of track the train occupies: `meters` of line ending at its extrapolated
 * position, so a low-zoom train bends with the rails instead of sitting on them rigidly.
 */
export function trailAt(plan, now, meters) {
  const head = positionAt(plan, now);
  if (plan.kind === "free") {
    const rad = (plan.bearing * Math.PI) / 180;
    const kx = Math.cos((head.lat * Math.PI) / 180) * M_PER_DEG_LON;
    return [
      [head.lon - (meters * Math.sin(rad)) / kx, head.lat - (meters * Math.cos(rad)) / M_PER_DEG_LAT],
      [head.lon, head.lat],
    ];
  }
  const s = Math.min(Math.max(0, (now - plan.t0) / 1000), MAX_TRACK_S);
  let along = plan.along0 + plan.dir * plan.speed * s;
  along = plan.dir > 0 ? Math.min(along, plan.limit) : Math.max(along, plan.limit);
  const end = plan.cum[plan.cum.length - 1];
  const tail = Math.max(0, Math.min(end, along - plan.dir * meters));
  const [lo, hi] = tail < along ? [tail, along] : [along, tail];
  const coords = [plan.coords, plan.cum];
  const line = [pointAt(...coords, lo)];
  for (let i = 0; i < plan.cum.length; i++) if (plan.cum[i] > lo && plan.cum[i] < hi) line.push({ lon: plan.coords[i][0], lat: plan.coords[i][1] });
  line.push(pointAt(...coords, hi));
  const out = line.map((p) => [p.lon, p.lat]);
  return plan.dir > 0 ? out : out.reverse();
}
