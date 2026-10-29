// MapLibre style built entirely from Overture Maps PMTiles.
// Layer and field names come from the Overture tile metadata (base, transportation).

export const OVERTURE_RELEASE = "2026-10-21.0";
const TILES = `https://tiles.overturemaps.org/${OVERTURE_RELEASE}`;

const PALETTES = {
  light: {
    ocean: "#c9dcec",
    land: "#f4f1ea",
    water: "#b8d3ea",
    forest: "#dfe8d2",
    grass: "#e8eddc",
    urban: "#ebe6dd",
    park: "#d8e8c8",
    road: "#ffffff",
    roadCase: "#ddd6cb",
    highway: "#fbe3b8",
    highwayCase: "#e5c38c",
    rail: "#8d9098",
    railMinor: "#a9abb1",
    freight: "#9a6440",
    label: "#3b3a40",
    labelHalo: "rgba(255,255,255,0.9)",
    waterLabel: "#5a7ea0",
  },
  dark: {
    ocean: "#0f1722",
    land: "#1b1e24",
    water: "#132233",
    forest: "#1d241e",
    grass: "#1f2420",
    urban: "#22242a",
    park: "#1d2a1f",
    road: "#30333b",
    roadCase: "#1b1e24",
    highway: "#4a4235",
    highwayCase: "#2a261f",
    rail: "#6f727c",
    railMinor: "#5d606a",
    freight: "#a67a57",
    label: "#d6d6dc",
    labelHalo: "rgba(15,17,22,0.9)",
    waterLabel: "#6d90b5",
  },
};

const name = ["coalesce", ["get", "@name"], ["get", "names.primary"], ""];

// Rail classification. Overture's rail_flags arrive as a JSON string; "is_freight" is too sparsely
// tagged to rely on, so treat all active mainline as freight unless it is flagged passenger-only.
const railFlags = ["coalesce", ["get", "rail_flags"], ""];
const mainline = [
  "all",
  ["==", ["get", "subtype"], "rail"],
  ["in", ["get", "class"], ["literal", ["standard_gauge", "narrow_gauge", "unknown"]]],
  ["!", ["in", railFlags, ["literal", ['[{"values":["is_abandoned"]}]', '[{"values":["is_disused"]}]']]]],
];
const passengerOnly = ["all", ["in", "is_passenger", railFlags], ["!", ["in", "is_freight", railFlags]]];
const freight = ["all", mainline, ["!", passengerOnly]];

export function buildStyle(theme = "light") {
  const c = PALETTES[theme];
  return {
    version: 8,
    glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sources: {
      base: { type: "vector", url: `pmtiles://${TILES}/base.pmtiles`, attribution: '<a href="https://overturemaps.org">© Overture Maps Foundation</a>' },
      transportation: { type: "vector", url: `pmtiles://${TILES}/transportation.pmtiles` },
    },
    layers: [
      { id: "background", type: "background", paint: { "background-color": c.ocean } },
      { id: "land", type: "fill", source: "base", "source-layer": "land", paint: { "fill-color": c.land } },
      {
        id: "land-cover",
        type: "fill",
        source: "base",
        "source-layer": "land_cover",
        paint: {
          "fill-color": ["match", ["get", "subtype"], ["forest", "mangrove", "wetland"], c.forest, ["grass", "shrub", "crop", "moss"], c.grass, "urban", c.urban, c.land],
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 10, 0.5],
        },
      },
      {
        id: "land-use-park",
        type: "fill",
        source: "base",
        "source-layer": "land_use",
        filter: ["in", ["get", "subtype"], ["literal", ["park", "protected", "recreation"]]],
        paint: { "fill-color": c.park, "fill-opacity": 0.6 },
      },
      { id: "water", type: "fill", source: "base", "source-layer": "water", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": c.water } },
      {
        id: "water-lines",
        type: "line",
        source: "base",
        "source-layer": "water",
        filter: ["==", ["geometry-type"], "LineString"],
        minzoom: 8,
        paint: { "line-color": c.water, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.5, 14, 2] },
      },
      {
        id: "roads-highway-case",
        type: "line",
        source: "transportation",
        "source-layer": "segment",
        filter: ["all", ["==", ["get", "subtype"], "road"], ["in", ["get", "class"], ["literal", ["motorway", "trunk"]]]],
        minzoom: 6,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.highwayCase, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 6, 1, 14, 10] },
      },
      {
        id: "roads-minor",
        type: "line",
        source: "transportation",
        "source-layer": "segment",
        filter: ["all", ["==", ["get", "subtype"], "road"], ["in", ["get", "class"], ["literal", ["primary", "secondary", "tertiary", "residential", "unclassified"]]]],
        minzoom: 8,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.road, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 8, 0.5, 14, 5] },
      },
      {
        id: "roads-highway",
        type: "line",
        source: "transportation",
        "source-layer": "segment",
        filter: ["all", ["==", ["get", "subtype"], "road"], ["in", ["get", "class"], ["literal", ["motorway", "trunk"]]]],
        minzoom: 6,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": c.highway, "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 6, 0.5, 14, 7] },
      },
      {
        id: "rail-minor",
        type: "line",
        source: "transportation",
        "source-layer": "segment",
        filter: ["all", ["==", ["get", "subtype"], "rail"], ["in", ["get", "class"], ["literal", ["light_rail", "subway", "tram", "monorail", "funicular"]]]],
        minzoom: 10,
        paint: { "line-color": c.railMinor, "line-width": 1 },
      },
      {
        id: "rail-passenger",
        type: "line",
        source: "transportation",
        "source-layer": "segment",
        filter: ["all", mainline, passengerOnly],
        layout: { "line-join": "round" },
        paint: { "line-color": c.rail, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.8, 14, 2] },
      },
      {
        id: "rail-freight",
        type: "line",
        source: "transportation",
        "source-layer": "segment",
        filter: freight,
        layout: { "line-join": "round" },
        paint: { "line-color": c.freight, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 1, 10, 1.6, 14, 2.8] },
      },
      {
        id: "rail-freight-ties",
        type: "line",
        source: "transportation",
        "source-layer": "segment",
        filter: freight,
        minzoom: 13,
        paint: { "line-color": c.freight, "line-width": 5, "line-opacity": 0.7, "line-dasharray": [0.15, 2.5] },
      },
      {
        id: "rail-freight-labels",
        type: "symbol",
        source: "transportation",
        "source-layer": "segment",
        filter: ["all", freight, ["has", "@name"]],
        minzoom: 12,
        layout: {
          "symbol-placement": "line",
          "text-field": name,
          "text-font": ["Noto Sans Italic"],
          "text-size": 11,
          "text-offset": [0, -0.9],
          "symbol-spacing": 400,
        },
        paint: { "text-color": c.freight, "text-halo-color": c.labelHalo, "text-halo-width": 1.2 },
      },
      {
        id: "water-labels",
        type: "symbol",
        source: "base",
        "source-layer": "water",
        filter: [
          "all",
          ["has", "@name"],
          ["any", ["in", ["get", "subtype"], ["literal", ["ocean", "sea"]]], ["all", [">=", ["zoom"], 9], ["in", ["get", "subtype"], ["literal", ["lake", "bay"]]]]],
        ],
        layout: { "text-field": name, "text-font": ["Noto Sans Italic"], "text-size": 12, "text-max-width": 8 },
        paint: { "text-color": c.waterLabel, "text-halo-color": c.labelHalo, "text-halo-width": 1 },
      },
    ],
  };
}
