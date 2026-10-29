// Pixel-art train sprite sheet, drawn from character grids so it needs no image assets.
// Each sprite is a grid of palette keys; "." is transparent.

export const SCALE = 3; // device pixels per art pixel

const PALETTE = {
  k: "#141a28", // outline
  w: "#e9edf3", // body white
  g: "#b4bcc9", // roof gray
  d: "#5a6273", // dark gray
  b: "#2f5bc4", // livery blue
  n: "#1a2c6b", // navy skirt
  c: "#86c3ee", // window glass
  Y: "#ffd84d", // headlight on
  y: "#8a7a3a", // headlight off
  R: "#ff4a3d", // tail light on
  r: "#6b2a26", // tail light off
  s: "#9aa3b2", // rail steel
  o: "#9a5b3c", // station brick
  p: "#4b2f27", // station roof
  q: "#c9ccd3", // platform edge
  a: "#ffd84d", // direction arrow
  e: "#fff1a8", // headlight beam
  f: "#b9a75c", // beam falloff
  m: "#7f8db8", // speed streaks
};

// ---- Top view (nose pointing up / north) ----------------------------------

const LOCO_TOP = [
  "...kkkkkk...",
  "..kbLbbLbk..",
  ".kbccccccbk.",
  ".kbccccccbk.",
  "kbbbbbbbbbbk",
  "kwwwwwwwwwwk",
  "kbwggggggwbk",
  "kbwgddddgwbk",
  "kbwgdkkdgwbk",
  "kbwgddddgwbk",
  "kbwggggggwbk",
  "kbwggggggwbk",
  "kbwgddddgwbk",
  "kbwgddddgwbk",
  "kbwggggggwbk",
  "kbwggggggwbk",
  "kbwgdkkdgwbk",
  "kbwgddddgwbk",
  "kbwggggggwbk",
  "kbwwwwwwwwbk",
  "kbbbbbbbbbbk",
  ".kbnnnnnnbk.",
  "..kkkkkkkk..",
  ".....kk.....",
];

const CAR_TOP = [
  ".kkkkkkkkkk.",
  "kbbbbbbbbbbk",
  "kbggggggggbk",
  "kbgddddddgbk",
  "kbggggggggbk",
  "kbggggggggbk",
  "kbggggggggbk",
  "kbgddddddgbk",
  "kbggggggggbk",
  "kbggggggggbk",
  "kbggggggggbk",
  "kbgddddddgbk",
  "kbggggggggbk",
  "kbggggggggbk",
  "kbggggggggbk",
  "kbgddddddgbk",
  "kbggggggggbk",
  "kbbbbbbbbbbk",
  "kbTbbbbbbTbk",
  ".kkkkkkkkkk.",
];

// ---- Side view (nose pointing right) ---------------------------------------

const LOCO_SIDE = [
  "..kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk....",
  ".kggggggggggggggggggggggggggggggggggk...",
  "kgwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwk..",
  "kwccwccwccwwwwwwwwwwwwwwwwwwwwwwwwcccck.",
  "kwccwccwccwwwwwwwwwwwwwwwwwwwwwwwwcccck.",
  "kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbk",
  "kwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwLk",
  "kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbk",
  "knnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnk",
  "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
  "..kdddk..kdddk..........kdddk..kdddk....",
  ".kdAdBdkkdAdBdk........kdAdBdkkdAdBdk...",
  "..kdddk..kdddk..........kdddk..kdddk....",
  "ssssssssssssssssssssssssssssssssssssssss",
];

const CAR_SIDE = [
  ".kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk.",
  "kgggggggggggggggggggggggggggggggggggggk",
  "kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbk",
  "kbccbccbccbccbccbccbccbccbccbccbccbccbk",
  "kbccbccbccbccbccbccbccbccbccbccbccbccbk",
  "kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbk",
  "kwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwk",
  "kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbk",
  "knnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnk",
  "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk",
  "..kdddk..kdddk...........kdddk..kdddk..",
  ".kdAdBdkkdAdBdk.........kdAdBdkkdAdBdk.",
  "..kdddk..kdddk...........kdddk..kdddk..",
  "sssssssssssssssssssssssssssssssssssssss",
];

// Direction indicator drawn ahead of the nose: stacked chevrons (more = faster), or a flat bar
// when stopped. Every variant is padded to the same height with its base on the bottom row, so
// it sits the same distance from the nose whichever is shown.
const CHEVRON = [".....kk.....", "....kaak....", "...kaaaak...", "..kaakkaak..", ".kaak..kaak.", ".kkk....kkk."];
const FLAT_BAR = [".kkkkkkkkkk.", ".kaaaaaaaak.", ".kkkkkkkkkk."];
export const MAX_CHEVRONS = 3;
const CHEVRON_STEP = 3; // rows between stacked chevrons
const ARROW_ROWS = CHEVRON.length + CHEVRON_STEP * (MAX_CHEVRONS - 1);

function arrowRows(chevrons) {
  const blank = ".".repeat(CHEVRON[0].length);
  const rows = Array(ARROW_ROWS).fill(blank);
  if (!chevrons) {
    rows.splice(ARROW_ROWS - FLAT_BAR.length, FLAT_BAR.length, ...FLAT_BAR);
    return rows;
  }
  // Stack from the bottom up so the lowest chevron always sits on the base row.
  for (let i = 0; i < chevrons; i++) {
    const top = ARROW_ROWS - CHEVRON.length - i * CHEVRON_STEP;
    CHEVRON.forEach((row, y) => {
      rows[top + y] = [...row].map((ch, x) => (ch === "." ? rows[top + y][x] : ch)).join("");
    });
  }
  return rows;
}

// Two static states. Placeholders: L = headlight, T = tail light, A/B = wheel hubs.
const STATES = {
  idle: { L: "y", T: "r", A: "d", B: "d" },
  move: { L: "Y", T: "R", A: "d", B: "d" },
};

function applyState(rows, f) {
  return rows.map((row) => row.replace(/[LTAB]/g, (ch) => f[ch]));
}

function rasterize(rows, scale = SCALE, palette = PALETTE) {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const canvas = document.createElement("canvas");
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext("2d");
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  return canvas;
}

export const CARS = 2; // passenger cars in the side view

// Map sprites are drawn one vehicle at a time so each can sit on the track at its own bearing.
// Lengths are in art pixels (rows of the top-view grids), measured from the locomotive's nose.
export const VEHICLE = {
  arrowCenter: -(ARROW_ROWS + 1) / 2, // the direction arrow is its own sprite, a row ahead of the nose
  locoCenter: LOCO_TOP.length / 2,
  locoLength: LOCO_TOP.length,
  carLength: CAR_TOP.length,
  gap: 1,
};

// Moving side views get speed streaks behind and a headlight beam ahead; stopped ones are
// padded to the same width so the two swap without the image jumping.
const STREAKS = { 2: "..mmmm..", 4: "mmmmmm..", 6: ".mmm.mm.", 8: "...mmm.." };
const BEAM = { 5: "ef..", 6: "eeef", 7: "ef.." };

function sideRows(state) {
  const f = STATES[state];
  const moving = state === "move";
  // side view: cars trail behind (to the left of) the loco
  const loco = applyState(LOCO_SIDE, f);
  const car = applyState(CAR_SIDE, f);
  const rail = (n) => "s".repeat(n);
  return loco.map((row, y) => {
    const isRail = y === loco.length - 1;
    const before = isRail ? rail(8) : (moving && STREAKS[y]) || "........";
    const after = isRail ? rail(4) : (moving && BEAM[y]) || "....";
    return before + Array(CARS).fill(car[y]).join(".") + "." + row + after;
  });
}

// Side-view station building drawn behind a stopped train. It is taller than the train so the
// roof and upper windows show above it; rows are generated to keep every row the same width.
const STATION_W = 52;
function stationRows() {
  const W = STATION_W;
  const pad = (n) => ".".repeat(n);
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const off = 5 - i;
    rows.push(pad(off) + "k" + "p".repeat(W - 2 * off - 2) + "k" + pad(off));
  }
  rows.push("k".repeat(W));
  for (let y = 0; y < 18; y++) {
    let row = "";
    for (let x = 0; x < W; x++) {
      const edge = x === 0 || x === W - 1;
      const windowRow = (y >= 2 && y <= 6) || (y >= 10 && y <= 13);
      const windowCol = x % 8 >= 3 && x % 8 <= 5 && x > 2 && x < W - 3;
      const door = y >= 9 && Math.abs(x - W / 2 + 0.5) < 3;
      row += edge ? "k" : door ? "n" : windowRow && windowCol ? (y === 2 || y === 10 ? "k" : "c") : "o";
    }
    rows.push(row);
  }
  rows.push("q".repeat(W));
  return rows;
}

// Returns canvases keyed "side-<state>", "loco-<state>", "car-<state>", "car-tail-<state>", "station".
// Narrow variants for trains drawn side by side: the 12-wide top-view grids lose four interior
// columns (two each side of centre), keeping the outline, livery edge and centre detail.
const NARROW_DROP = new Set([2, 4, 7, 9]);
export const NARROW_WIDTH = 12 - NARROW_DROP.size;

function narrow(rows) {
  return rows.map((row) => [...row].filter((_, x) => !NARROW_DROP.has(x)).join(""));
}

export function buildSprites(scale = SCALE) {
  const sprites = {};
  for (const [state, f] of Object.entries(STATES)) {
    sprites[`side-${state}`] = rasterize(sideRows(state), scale);
    const top = {
      [`loco-${state}`]: applyState(LOCO_TOP, f),
      // Only the last car shows tail lights.
      [`car-${state}`]: applyState(CAR_TOP, { ...f, T: "b" }),
      [`car-tail-${state}`]: applyState(CAR_TOP, f),
    };
    for (const [key, rows] of Object.entries(top)) {
      sprites[key] = rasterize(rows, scale);
      sprites[`${key}-narrow`] = rasterize(narrow(rows), scale);
    }
  }
  sprites.station = rasterize(stationRows(), scale);
  return sprites;
}

export function spriteImageData(canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
}

// Direction indicator filled with `color` (the app colours it by speed): `chevrons` stacked
// chevrons, or a flat bar for 0.
export function buildArrow(color = PALETTE.a, chevrons = 1, { thin = false, scale = SCALE } = {}) {
  const rows = arrowRows(chevrons);
  return rasterize(thin ? narrow(rows) : rows, scale, { ...PALETTE, a: color });
}
