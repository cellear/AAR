'use strict';
/* avatar.js: turn a generated standee into a cast picture. Input: a PNG or
   JPEG of a figure on a flat background, possibly with a caption under the
   feet, possibly several figures side by side. Output: a transparent PNG
   336 px tall (at most 260 wide), the figure trimmed to its edges, matching
   the nine AMS standees. Everything here works on raw RGBA bitmaps; jimp
   only decodes, resizes and encodes. Pure functions, no file I/O: the
   command in server/avatar.js does the reading and writing. */

const { Jimp, ResizeStrategy } = require('jimp');

const TARGET_HEIGHT = 336;
const MAX_WIDTH = 260;
const DEFAULT_TOLERANCE = 28;

/* ---------- bitmaps ---------- */

function makeBitmap(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

function px(bm, x, y) { return (y * bm.width + x) * 4; }

/* The background colour: the median of the four corners, each sampled as
   a small square so one stray pixel does not decide. */
function backgroundColour(bm) {
  const samples = [];
  const s = Math.max(1, Math.min(6, Math.floor(Math.min(bm.width, bm.height) / 40)));
  for (const [cx, cy] of [[0, 0], [bm.width - s, 0], [0, bm.height - s], [bm.width - s, bm.height - s]]) {
    for (let y = cy; y < cy + s; y++) for (let x = cx; x < cx + s; x++) {
      const i = px(bm, x, y);
      if (bm.data[i + 3] === 0) return null;   /* already transparent: nothing to lift */
      samples.push([bm.data[i], bm.data[i + 1], bm.data[i + 2]]);
    }
  }
  const med = (k) => { const v = samples.map((c) => c[k]).sort((a, b) => a - b); return v[Math.floor(v.length / 2)]; };
  return [med(0), med(1), med(2)];
}

function near(bm, i, colour, tol) {
  return Math.abs(bm.data[i] - colour[0]) <= tol && Math.abs(bm.data[i + 1] - colour[1]) <= tol && Math.abs(bm.data[i + 2] - colour[2]) <= tol;
}

/* Flood from every edge pixel through background-coloured pixels; those
   become transparent. Enclosed pockets (a white notebook, a pale shirt) are
   never reached and survive. Returns the count removed. */
function lift(bm, { tolerance = DEFAULT_TOLERANCE, colour = null } = {}) {
  const bg = colour || backgroundColour(bm);
  if (!bg) return { background: null, removed: 0 };
  const { width, height, data } = bm;
  const seen = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => { const k = y * width + x; if (!seen[k]) { seen[k] = 1; stack.push(k); } };
  for (let x = 0; x < width; x++) { push(x, 0); push(x, height - 1); }
  for (let y = 0; y < height; y++) { push(0, y); push(width - 1, y); }
  let removed = 0;
  while (stack.length) {
    const k = stack.pop();
    const i = k * 4;
    if (data[i + 3] !== 0 && !near(bm, i, bg, tolerance)) continue;
    if (data[i + 3] !== 0) { data[i + 3] = 0; removed++; }
    const x = k % width, y = (k - x) / width;
    if (x > 0) push(x - 1, y);
    if (x < width - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < height - 1) push(x, y + 1);
  }
  feather(bm, bg, tolerance);
  return { background: bg, removed };
}

/* Soften the cut: an opaque pixel next to a transparent one whose colour
   is part-way to the background gets a proportional alpha, so anti-aliased
   outlines keep their edge instead of a hard white fringe. */
function feather(bm, bg, tol) {
  const { width, height, data } = bm;
  const out = Buffer.from(data);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = px(bm, x, y);
    if (data[i + 3] === 0) continue;
    let edge = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (data[px(bm, nx, ny) + 3] === 0) { edge = true; break; }
    }
    if (!edge) continue;
    const d = Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
    const reach = tol * 3;
    if (d < reach) out[i + 3] = Math.max(40, Math.round(255 * d / reach));
  }
  bm.data = out;
}

/* Bounding box of non-transparent pixels, with a halo. Null when empty. */
function bounds(bm, halo = 2) {
  const { width, height, data } = bm;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[px(bm, x, y) + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  return { x: Math.max(0, x0 - halo), y: Math.max(0, y0 - halo), w: Math.min(width, x1 + halo + 1) - Math.max(0, x0 - halo), h: Math.min(height, y1 + halo + 1) - Math.max(0, y0 - halo) };
}

function crop(bm, { x, y, w, h }) {
  const out = makeBitmap(w, h);
  for (let row = 0; row < h; row++) bm.data.copy(out.data, row * w * 4, px(bm, x, y + row), px(bm, x, y + row) + w * 4);
  return out;
}

function trim(bm, halo = 2) {
  const b = bounds(bm, halo);
  if (!b) return { bitmap: bm, box: null };
  return { bitmap: crop(bm, b), box: b };
}

/* ---------- captions ---------- */

/* Rows, from the bottom up, grouped into bands of "has non-background
   pixels" and "is background". A caption is one or more short dark bands
   below the tallest band (the figure). Returns the row to crop at, or null
   when nothing looks like a caption. Works on the still-opaque bitmap. */
function captionCut(bm, bg, tol) {
  const { width, height } = bm;
  const rowInk = new Array(height).fill(0);
  for (let y = 0; y < height; y++) {
    let n = 0;
    for (let x = 0; x < width; x++) if (!near(bm, px(bm, x, y), bg, tol)) n++;
    rowInk[y] = n;
  }
  const bands = [];
  let cur = null;
  for (let y = 0; y < height; y++) {
    const ink = rowInk[y] > 0;
    if (cur && cur.ink === ink) { cur.end = y; cur.max = Math.max(cur.max, rowInk[y]); }
    else { cur = { ink, start: y, end: y, max: rowInk[y] }; bands.push(cur); }
  }
  const inked = bands.filter((b) => b.ink).map((b) => ({ ...b, rows: b.end - b.start + 1 }));
  if (inked.length < 2) return null;
  const figure = inked.reduce((a, b) => (b.rows > a.rows ? b : a));
  const below = inked.filter((b) => b.start > figure.end);
  if (!below.length) return null;
  /* Every band below the figure must be short (text or an icon) and narrow. */
  const textLike = below.every((b) => b.rows < figure.rows * 0.15 && b.max < width * 0.6);
  if (!textLike) return null;
  /* Cut in the gap just under the figure's band. */
  return figure.end + 1;
}

/* ---------- group sheets ---------- */

/* Columns of pure background running the full height split a sheet into
   figures. Returns [{x, w}] slices, or one slice when there is no gap. */
function splitColumns(bm, bg, tol, { minGap = 8, minWidth = 40 } = {}) {
  const { width, height } = bm;
  const colInk = new Array(width).fill(false);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) if (!near(bm, px(bm, x, y), bg, tol)) { colInk[x] = true; break; }
  }
  const slices = [];
  let start = null, gap = 0;
  for (let x = 0; x <= width; x++) {
    const ink = x < width && colInk[x];
    if (ink) { if (start === null) start = x; gap = 0; }
    else if (start !== null) {
      gap++;
      if (gap >= minGap || x === width) {
        const end = x - gap;
        if (end - start + 1 >= minWidth) slices.push({ x: start, w: end - start + 1 });
        start = null; gap = 0;
      }
    }
  }
  return slices.length ? slices : [{ x: 0, w: width }];
}

/* ---------- scaling and encoding ---------- */

async function toJimp(bm) {
  return new Jimp({ width: bm.width, height: bm.height, data: Buffer.from(bm.data) });
}

function fromJimp(im) {
  return { width: im.bitmap.width, height: im.bitmap.height, data: Buffer.from(im.bitmap.data) };
}

/* Scale to the cast size: 336 tall, or 260 wide if that would be wider. */
async function fit(bm, { height = TARGET_HEIGHT, maxWidth = MAX_WIDTH } = {}) {
  let h = height, w = Math.round(bm.width * height / bm.height);
  if (w > maxWidth) { w = maxWidth; h = Math.round(bm.height * maxWidth / bm.width); }
  if (w === bm.width && h === bm.height) return bm;
  const im = await toJimp(bm);
  im.resize({ w, h, mode: ResizeStrategy.BICUBIC });
  return fromJimp(im);
}

async function decode(buffer) {
  const im = await Jimp.read(buffer);
  return fromJimp(im);
}

async function encodePng(bm) {
  const im = await toJimp(bm);
  return im.getBuffer('image/png');
}

/* ---------- the whole thing ---------- */

/* process(buffer) -> [{ png, report }], one per figure found (several for
   a split sheet). Options: tolerance, cropCaption, split, scale. */
async function process(buffer, { tolerance = DEFAULT_TOLERANCE, cropCaption = true, split = false, scale = true } = {}) {
  const source = await decode(buffer);
  const bg = backgroundColour(source);
  const results = [];
  const slices = split && bg ? splitColumns(source, bg, tolerance) : [{ x: 0, w: source.width }];
  for (const slice of slices) {
    let bm = slices.length > 1 ? crop(source, { x: slice.x, y: 0, w: slice.w, h: source.height }) : { ...source, data: Buffer.from(source.data) };
    const report = { input: { width: source.width, height: source.height }, slice: slices.length > 1 ? slice : null, background: bg, captionRows: 0, removed: 0, trimmed: null, output: null, transparent: !bg };
    if (bg && cropCaption) {
      const cut = captionCut(bm, bg, tolerance);
      if (cut !== null && cut < bm.height) { report.captionRows = bm.height - cut; bm = crop(bm, { x: 0, y: 0, w: bm.width, h: cut }); }
    }
    if (bg) report.removed = lift(bm, { tolerance, colour: bg }).removed;
    const t = trim(bm);
    bm = t.bitmap;
    report.trimmed = t.box;
    if (scale) bm = await fit(bm);
    report.output = { width: bm.width, height: bm.height };
    results.push({ png: await encodePng(bm), report, bitmap: bm });
  }
  return results;
}

/* A preview strip: the input beside the cut-out on a paper colour. */
async function preview(buffer, result, paper = [244, 239, 228]) {
  const source = await decode(buffer);
  const out = result.bitmap;
  const scaleTo = 336;
  const srcH = scaleTo, srcW = Math.round(source.width * scaleTo / source.height);
  const im = new Jimp({ width: srcW + out.width + 30, height: Math.max(srcH, out.height) + 20, color: 0xffffffff });
  const src = await toJimp(source);
  src.resize({ w: srcW, h: srcH, mode: ResizeStrategy.BILINEAR });
  im.composite(src, 10, 10);
  const paperBox = new Jimp({ width: out.width + 10, height: out.height + 10, color: (paper[0] << 24 | paper[1] << 16 | paper[2] << 8 | 0xff) >>> 0 });
  im.composite(paperBox, srcW + 15, 5);
  im.composite(await toJimp(out), srcW + 20, 10);
  return im.getBuffer('image/png');
}

module.exports = { TARGET_HEIGHT, MAX_WIDTH, DEFAULT_TOLERANCE, makeBitmap, backgroundColour, lift, trim, bounds, crop, captionCut, splitColumns, fit, decode, encodePng, process, preview };
