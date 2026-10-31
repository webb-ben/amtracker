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
  "kbnnnnnnnnbk",
  ".kkkkkkkkkk.",
];

const CAR_TOP = [
  "......k.....", // coupler: a single pixel linking this car to the vehicle ahead
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

// Acela power car: a long pointed nose, white with a blue stripe. Same size as LOCO_TOP/LOCO_SIDE
// so it couples on the same way.
const ACELA_TOP = [
  ".....kk.....",
  "....kwwk....",
  "...kwLLwk...",
  "..kwccccwk..",
  "..kcccccck..",
  ".kwccccccwk.",
  ".kwwwwwwwwk.",
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
  "kbwggggggwbk",
  "kbwwwwwwwwbk",
  "kbnnnnnnnnbk",
  ".kkkkkkkkkk.",
];

const ACELA_SIDE = [
  "..kkkkkkkkkkkkkkkkkkkkkkkkkk............",
  ".kggggggggggggggggggggggggggkkk.........",
  "kgwwwwwwwwwwwwwwwwwwwwwwwwwwwwwkkk......",
  "kwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwcccckk...",
  "kwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwccccckk.",
  "kwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwk",
  "kbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbLk",
  "kwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwwk",
  "knnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnnk.",
  "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk..",
  "..kdddk..kdddk..........kdddk..kdddk....",
  ".kdAdBdkkdAdBdk........kdAdBdkkdAdBdk...",
  "..kdddk..kdddk..........kdddk..kdddk....",
  "ssssssssssssssssssssssssssssssssssssssss",
];

// Locomotive designs by sprite prefix: "loco" for most trains, "acela" for Acela's power car.
const LOCOS = { loco: [LOCO_TOP, LOCO_SIDE], acela: [ACELA_TOP, ACELA_SIDE] };
export const LOCO_NAMES = Object.keys(LOCOS);

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
  carLength: CAR_TOP.length, // includes the coupler row at its front
  gap: 0, // the coupler fills the space between vehicles
};

// Moving side views get speed streaks behind and (dark mode only) a headlight beam ahead; stopped ones are
// padded to the same width so the two swap without the image jumping.
const STREAKS = { 2: "..mmmm..", 4: "mmmmmm..", 6: ".mmm.mm.", 8: "...mmm.." };
const BEAM = { 5: "ef..", 6: "eeef", 7: "ef.." };

function sideRows(state, beam = true, locoSide = LOCO_SIDE) {
  const f = STATES[state];
  const moving = state === "move";
  // side view: cars trail behind (to the left of) the loco
  const loco = applyState(locoSide, f);
  const car = applyState(CAR_SIDE, f);
  const rail = (n) => "s".repeat(n);
  return loco.map((row, y) => {
    const isRail = y === loco.length - 1;
    const before = isRail ? rail(8) : (moving && STREAKS[y]) || "........";
    const after = isRail ? rail(4) : (moving && beam && BEAM[y]) || "....";
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

// Returns canvases keyed "side-<state>", "loco-<state>", "car-<state>", "car-tail-<state>", "station",
// plus "side-acela-<state>" and "acela-<state>" for Acela's power car (see LOCOS).
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
    const top = {};
    for (const [name, [locoTop, locoSide]] of Object.entries(LOCOS)) {
      const side = name === "loco" ? "side" : `side-${name}`;
      sprites[`${side}-${state}`] = rasterize(sideRows(state, true, locoSide), scale);
      sprites[`${side}-${state}-unlit`] = rasterize(sideRows(state, false, locoSide), scale); // light mode: no beam
      top[`${name}-${state}`] = applyState(locoTop, f);
    }
    Object.assign(top, {
      // Only the last car shows tail lights.
      [`car-${state}`]: applyState(CAR_TOP, { ...f, T: "b" }),
      [`car-tail-${state}`]: applyState(CAR_TOP, f),
    });
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

// A moving narrow loco (`name` from LOCOS) painted `color`, the colour of its speed, in place of the livery blue.
export function buildSpeedLoco(color, name = "loco", scale = SCALE) {
  return rasterize(narrow(applyState(LOCOS[name][0], STATES.move)), scale, { ...PALETTE, b: color });
}

// ---- 3D blocks (tilted map) ------------------------------------------------

// A vehicle is built from both views: the top view is its roof, and its sides are skinned with
// the side view, stretched to the top view's length (and by the same amount upward). Each roof
// row stands as tall as the side view's outline above it, so the loco's nose slopes the same way.
const WHEEL_ROWS = 3; // side-view rows of wheels under the body, above the rail
const SIDE_DEPTH = 0.1; // art px the side skin stands off the body
const ROOF_LIFT = { d: 0.3 }; // roof vents stand proud
const GEAR = "#2a2f3a"; // running gear between the wheels
export const NUMBER_DEPTH = 2 * SIDE_DEPTH; // the loco's number sits on top of the skin

// Runs of one character along a grid row, as [char, start, end).
function runs(row) {
  const out = [];
  for (let x = 0; x < row.length; ) {
    let end = x + 1;
    while (row[end] === row[x]) end++;
    if (row[x] !== ".") out.push([row[x], x, end]);
    x = end;
  }
  return out;
}

// One vehicle as blocks { r0, r1, c0, c1, color, base, top }: rows back from the nose and columns
// across from the left (as in the narrow top view), heights up from the ground, all in art pixels.
// `lead` top-view rows (a car's coupler) sit ahead of the body.
function solidBlocks(topRows, sideRows, lead) {
  const roof = narrow(topRows);
  const width = roof[0].length;
  const side = sideRows.slice(0, -1); // no rail
  const cols = Math.max(...side.map((r) => r.length));
  const step = (roof.length - lead) / cols;
  const up = (y) => (side.length - 1 - y) * step; // bottom of side row y
  const bodyBase = WHEEL_ROWS * step;
  // Side column x (nose on the right) covers rows [back(x + 1), back(x)) of the top view.
  const back = (x) => lead + (cols - x) * step;
  const column = (r) => Math.min(cols - 1, Math.max(0, cols - 1 - Math.floor((r - lead) / step)));
  const sideTop = (x) => {
    const y = side.findIndex((row) => row[x] && row[x] !== ".");
    return y < 0 ? 0 : up(y) + step;
  };
  // A roof row stands as tall as the tallest side column alongside it, so no side pokes up past
  // the roof and shows its inside.
  const height = (r) => {
    if (r < lead) return bodyBase + step;
    let top = 0;
    for (let x = column(r + 1 - 1e-6); x <= column(r); x++) top = Math.max(top, sideTop(x));
    return top || bodyBase + step;
  };
  // The roof's outline at a point along the vehicle, [left, right) in columns: the sides hug it
  // where the nose narrows.
  const edges = (x) => {
    const row = roof[Math.min(roof.length - 1, Math.max(0, Math.floor(back(x + 1) + step / 2)))];
    return [row.search(/[^.]/), row.length - [...row].reverse().join("").search(/[^.]/)];
  };
  const out = [{ r0: lead + 0.5, r1: roof.length - 0.5, c0: 1, c1: width - 1, color: GEAR, base: 0, top: bodyBase }];
  roof.forEach((row, r) => {
    for (const [ch, from, to] of runs(row)) {
      out.push({ r0: r, r1: r + 1, c0: from, c1: to, color: PALETTE[ch], base: bodyBase, top: height(r) + (ROOF_LIFT[ch] ?? 0) });
    }
  });
  side.forEach((row, y) => {
    for (const [ch, from, to] of runs(row)) {
      // Split the run wherever the roof's outline steps in, so each piece sits on it.
      for (let end = to; end > from; ) {
        const [left, right] = edges(end - 1);
        let start = end - 1; // columns [start, end) share an outline
        while (start > from && edges(start - 1).join() === [left, right].join()) start--;
        const skin = { r0: back(end), r1: back(start), color: PALETTE[ch], base: up(y), top: up(y) + step };
        out.push({ ...skin, c0: left - SIDE_DEPTH, c1: left }, { ...skin, c0: right, c1: right + SIDE_DEPTH });
        end = start;
      }
    }
  });
  return out;
}

// Each narrow top-view sprite as 3D blocks (see solidBlocks), keyed like the sprites.
export function buildBlocks() {
  const blocks = {};
  for (const [state, f] of Object.entries(STATES)) {
    for (const [name, [locoTop, locoSide]] of Object.entries(LOCOS)) {
      blocks[`${name}-${state}-narrow`] = solidBlocks(applyState(locoTop, f), applyState(locoSide, f), 0);
    }
    blocks[`car-${state}-narrow`] = solidBlocks(applyState(CAR_TOP, { ...f, T: "b" }), applyState(CAR_SIDE, f), 1);
    blocks[`car-tail-${state}-narrow`] = solidBlocks(applyState(CAR_TOP, f), applyState(CAR_SIDE, f), 1);
  }
  return blocks;
}

// Where the number goes on a 3D loco's side: on the white band, rows 2–4 of LOCO_SIDE, centred on
// its column 17, well back from the cab. In art pixels, as for solidBlocks.
const LOCO_STEP = LOCO_TOP.length / LOCO_SIDE[0].length;
export const LOCO_NUMBER = {
  row: (LOCO_SIDE[0].length - 17.5) * LOCO_STEP,
  top: (LOCO_SIDE.length - 1 - 2) * LOCO_STEP,
  px: (3 * LOCO_STEP) / 5, // five digit rows in three side-view rows
};

// 3×5 pixel digits for the number on the side of a 3D loco.
const DIGITS = {
  0: ["###", "#.#", "#.#", "#.#", "###"],
  1: [".#.", "##.", ".#.", ".#.", "###"],
  2: ["###", "..#", "###", "#..", "###"],
  3: ["###", "..#", ".##", "..#", "###"],
  4: ["#.#", "#.#", "###", "..#", "..#"],
  5: ["###", "#..", "###", "..#", "###"],
  6: ["###", "#..", "###", "#.#", "###"],
  7: ["###", "..#", "..#", "..#", "..#"],
  8: ["###", "#.#", "###", "#.#", "###"],
  9: ["###", "#.#", "###", "..#", "###"],
};

// The lit pixels of `text` in that font, as { x, y } from its top left, and its width in pixels.
export function digitPixels(text) {
  const pixels = [];
  const digits = [...String(text)].filter((ch) => DIGITS[ch]);
  digits.forEach((ch, i) =>
    DIGITS[ch].forEach((row, y) => [...row].forEach((on, x) => on === "#" && pixels.push({ x: i * 4 + x, y }))),
  );
  return { pixels, width: Math.max(0, digits.length * 4 - 1) };
}
