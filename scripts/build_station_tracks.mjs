// Extract the track layout around major Amtrak stations from Overture's transportation tiles.
//
// Writes data/station-tracks.geojson: active rail lines within RADIUS_M of each station, cleaned
// into a navigable network of the track Amtrak runs on (see clean_station_tracks.mjs). Reads the
// same PMTiles archive the map uses, at its most detailed zoom, so it only downloads the handful
// of tiles around each station.
//
// Usage: npm install && npm run station-tracks

import { readFileSync, writeFileSync } from "node:fs";
import { PMTiles } from "pmtiles";
import { VectorTile } from "@mapbox/vector-tile";
import Pbf from "pbf";
import { cleanTracks } from "./clean_station_tracks.mjs";

const RELEASE = "2026-10-21.0"; // keep in step with OVERTURE_RELEASE in src/style.js
const Z = 14; // most detailed zoom in the transportation archive
const RADIUS_M = 1500;
const PRECISION = 6;
const OUT = new URL("../data/station-tracks.geojson", import.meta.url);

// Roughly the 40 busiest Amtrak stations (Northeast Corridor, California and the big hubs).
const STATIONS = [
  "NYP",
  "WAS",
  "PHL",
  "BOS",
  "BBY",
  "CHI",
  "LAX",
  "SAC",
  "BAL",
  "NHV",
  "PVD",
  "SAN",
  "WIL",
  "STM",
  "NWK",
  "MET",
  "RTE",
  "BWI",
  "TRE",
  "HAR",
  "ALB",
  "EMY",
  "OKJ",
  "SEA",
  "PDX",
  "ANA",
  "IRV",
  "SNA",
  "RVR",
  "NFK",
  "LNC",
  "MKE",
  "STL",
  "NCR",
  "RHI",
  "POU",
  "SPG",
  "HFD",
  "EWR",
  "PJC",
];
const KEEP_CLASSES = new Set(["standard_gauge", "narrow_gauge", "unknown"]);
const DROP_FLAGS = ["is_abandoned", "is_disused"];

const tileX = (lon) => Math.floor(((lon + 180) / 360) * 2 ** Z);
const tileY = (lat) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z);
};

async function main() {
  const stations = await (await fetch("https://api-v3.amtraker.com/v3/stations")).json();
  const archive = new PMTiles(`https://tiles.overturemaps.org/${RELEASE}/transportation.pmtiles`);
  const tileCache = new Map();
  const features = [];

  for (const code of STATIONS) {
    const st = stations[code];
    if (!st) {
      console.log(`skip ${code}: not in station list`);
      continue;
    }
    const dLat = RADIUS_M / 110_540;
    const dLon = RADIUS_M / (111_320 * Math.cos((st.lat * Math.PI) / 180));
    const box = { w: st.lon - dLon, e: st.lon + dLon, s: st.lat - dLat, n: st.lat + dLat };
    const inBox = ([x, y]) => x >= box.w && x <= box.e && y >= box.s && y <= box.n;

    const seen = new Set();
    let kept = 0;
    for (let x = tileX(box.w); x <= tileX(box.e); x++) {
      for (let y = tileY(box.n); y <= tileY(box.s); y++) {
        const key = `${x}/${y}`;
        if (!tileCache.has(key)) tileCache.set(key, archive.getZxy(Z, x, y));
        const tile = await tileCache.get(key);
        const layer = tile && new VectorTile(new Pbf(new Uint8Array(tile.data))).layers.segment;
        if (!layer) continue;
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i);
          const p = f.properties;
          if (p.subtype !== "rail" || !KEEP_CLASSES.has(p.class)) continue;
          if (DROP_FLAGS.some((flag) => String(p.rail_flags ?? "").includes(flag))) continue;
          const geom = f.toGeoJSON(x, y, Z).geometry;
          const lines = geom.type === "LineString" ? [geom.coordinates] : geom.type === "MultiLineString" ? geom.coordinates : [];
          for (const line of lines) {
            // Keep the runs of the line that fall inside the station's box.
            let run = [];
            const flush = () => {
              const sig = `${p.id}:${run[0]}`;
              if (run.length >= 2 && !seen.has(sig)) {
                seen.add(sig);
                features.push({
                  type: "Feature",
                  properties: { station: code, id: p.id },
                  geometry: { type: "LineString", coordinates: run.map(([lon, lat]) => [+lon.toFixed(PRECISION), +lat.toFixed(PRECISION)]) },
                });
                kept++;
              }
              run = [];
            };
            for (const c of line) {
              if (inBox(c)) run.push(c);
              else flush();
            }
            flush();
          }
        }
      }
    }
    console.log(`${code}: ${kept} track lines`);
  }

  const routes = JSON.parse(readFileSync(new URL("../data/routes.geojson", import.meta.url))).features;
  const centers = Object.fromEntries(STATIONS.filter((code) => stations[code]).map((code) => [code, [stations[code].lon, stations[code].lat]]));
  const cleaned = cleanTracks(features, routes, centers, RADIUS_M);
  const metadata = { release: RELEASE, radius_m: RADIUS_M, stations: centers };
  const out = JSON.stringify({ type: "FeatureCollection", metadata, features: cleaned });
  writeFileSync(OUT, out);
  console.log(`${features.length} raw lines, ${cleaned.length} cleaned -> data/station-tracks.geojson (${Math.round(out.length / 1024)} KB)`);
}

main();
