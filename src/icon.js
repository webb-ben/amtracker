// The app icon: a little pixel train running past on a 16×16 grid. The same frames drive the
// header logo, the tab favicon and (via scripts/build_icons.mjs) the static favicon.svg.

export const ICON_SIZE = 16;
export const ICON_FRAME_MS = 110;

const COLORS = {
  S: "#bfe3fa", // sky
  T: "#9fd3f5", // sky, lower
  G: "#3b3f4a", // ground
  s: "#9aa3b2", // rail
  k: "#141a28", // outline
  w: "#e9edf3", // body white
  b: "#2f5bc4", // livery blue
  n: "#1a2c6b", // navy skirt
  c: "#86c3ee", // window glass
  d: "#5a6273", // wheels
  Y: "#ffd84d", // headlight
};

// Nose to the right. Rows sit on the rail (the wheel row is the last).
const LOCO = [
  "kkkkkkkk..", //
  "kccwccwwk.",
  "kbbbbbbbbk",
  "kwwwwwwwwY",
  "knnnnnnnnk",
  ".d.d..d.d.",
];
const CAR = [
  "kkkkkkkkk", //
  "kcbcbcbck",
  "kbbbbbbbk",
  "kwwwwwwwk",
  "knnnnnnnk",
  ".d.d.d.d.",
];
const TRAIN = LOCO.map((row, y) => CAR[y] + "." + row); // one car coupled behind the loco
const TRAIN_W = TRAIN[0].length;
const RAIL_ROW = 13;
const TRAIN_TOP = RAIL_ROW - TRAIN.length;

/** Frames in one loop: the train runs in from the left edge and out past the right. */
export const ICON_FRAMES = ICON_SIZE + TRAIN_W;

/** The frame as 16 rows of colour keys. Frame 0, for still images, shows the whole loco. */
export function iconGrid(frame) {
  const still = ICON_SIZE - 1; // the loco's nose on the right-hand column
  const x0 = ((frame + still) % ICON_FRAMES) - TRAIN_W + 1;
  const rows = [];
  for (let y = 0; y < ICON_SIZE; y++) {
    let row = "";
    for (let x = 0; x < ICON_SIZE; x++) {
      const art = y >= TRAIN_TOP && y < RAIL_ROW ? TRAIN[y - TRAIN_TOP][x - x0] : undefined;
      row += art && art !== "." ? art : y < 8 ? "S" : y < RAIL_ROW ? "T" : y === RAIL_ROW ? "s" : "G";
    }
    rows.push(row);
  }
  return rows;
}

export function iconColor(key) {
  return COLORS[key];
}

/** Paint a frame into a canvas of any size, clipped to a rounded square like the old logo. */
export function drawIcon(canvas, frame) {
  const ctx = canvas.getContext("2d");
  const px = canvas.width / ICON_SIZE;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, canvas.width, canvas.height, 4 * px);
  ctx.clip();
  iconGrid(frame).forEach((row, y) => {
    for (let x = 0; x < ICON_SIZE; x++) {
      ctx.fillStyle = COLORS[row[x]];
      ctx.fillRect(x * px, y * px, px, px);
    }
  });
  ctx.restore();
}

/**
 * Animate the header logo canvas and the tab favicon. Browsers don't animate SVG favicons,
 * so the favicon is redrawn into a small canvas and swapped in as a data URL each frame.
 * With reduced motion both stay on the still frame.
 */
export function animateIcon(logo, favicon) {
  const tab = document.createElement("canvas");
  tab.width = tab.height = 32;
  let frame = 0;
  const draw = () => {
    if (logo) drawIcon(logo, frame);
    if (favicon && !document.hidden) {
      drawIcon(tab, frame);
      favicon.href = tab.toDataURL("image/png");
    }
  };
  draw();
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  setInterval(() => {
    frame = (frame + 1) % ICON_FRAMES;
    draw();
  }, ICON_FRAME_MS);
}
