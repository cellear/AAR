'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Jimp } = require('jimp');
const av = require('../server/lib/avatar');

/* Synthetic standees: rectangles on a flat background. */
function canvas(w, h, bg) {
  const bm = av.makeBitmap(w, h);
  for (let i = 0; i < w * h; i++) { bm.data[i * 4] = bg[0]; bm.data[i * 4 + 1] = bg[1]; bm.data[i * 4 + 2] = bg[2]; bm.data[i * 4 + 3] = 255; }
  return bm;
}
function rect(bm, x0, y0, w, h, c) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = (y * bm.width + x) * 4; bm.data[i] = c[0]; bm.data[i + 1] = c[1]; bm.data[i + 2] = c[2]; bm.data[i + 3] = 255; }
}
const alpha = (bm, x, y) => bm.data[(y * bm.width + x) * 4 + 3];
const WHITE = [255, 255, 255], INK = [40, 40, 40], BLUE = [60, 80, 160];

async function png(bm) { return av.encodePng(bm); }

test('backgroundColour is the corner median; transparent corners mean none', () => {
  const bm = canvas(100, 200, [250, 248, 240]);
  rect(bm, 30, 20, 40, 160, BLUE);
  assert.deepEqual(av.backgroundColour(bm), [250, 248, 240]);
  bm.data[3] = 0;
  assert.equal(av.backgroundColour(bm), null);
});

test('lift removes the background from the edges in, keeps an enclosed white patch, clears a gap that touches the outside', () => {
  const bm = canvas(120, 200, WHITE);
  rect(bm, 20, 20, 80, 160, BLUE);            /* body */
  rect(bm, 40, 60, 40, 30, WHITE);            /* a white notebook inside the body: must survive */
  rect(bm, 20, 100, 30, 40, WHITE);           /* a notch from the left edge: background, must clear */
  const r = av.lift(bm);
  assert.deepEqual(r.background, WHITE);
  assert.equal(alpha(bm, 5, 5), 0, 'corner cleared');
  assert.equal(alpha(bm, 50, 70), 255, 'enclosed white patch kept');
  assert.equal(alpha(bm, 25, 120), 0, 'open notch cleared');
  assert.equal(alpha(bm, 60, 150), 255, 'body kept');
});

test('lift on a tinted background with tolerance', () => {
  const bm = canvas(60, 60, [230, 225, 210]);
  rect(bm, 20, 20, 20, 20, INK);
  /* a slightly different tint band at the edge, within tolerance */
  rect(bm, 0, 0, 60, 5, [240, 235, 220]);
  av.lift(bm, { tolerance: 28 });
  assert.equal(alpha(bm, 2, 2), 0);
  assert.equal(alpha(bm, 30, 30), 255);
});

test('trim finds the figure with a halo', () => {
  const bm = canvas(100, 100, WHITE);
  rect(bm, 30, 40, 20, 30, BLUE);
  av.lift(bm);
  const t = av.trim(bm, 2);
  assert.deepEqual(t.box, { x: 28, y: 38, w: 24, h: 34 });
  assert.equal(t.bitmap.width, 24);
});

test('captionCut finds text bands under the figure and ignores an image without one', () => {
  const bm = canvas(200, 400, WHITE);
  rect(bm, 60, 20, 80, 280, BLUE);            /* figure */
  rect(bm, 70, 320, 60, 18, INK);             /* name */
  rect(bm, 80, 345, 40, 10, INK);             /* role */
  rect(bm, 90, 365, 20, 20, INK);             /* icon */
  assert.equal(av.captionCut(bm, WHITE, 28), 300);
  const plain = canvas(200, 400, WHITE);
  rect(plain, 60, 20, 80, 340, BLUE);
  assert.equal(av.captionCut(plain, WHITE, 28), null);
});

test('splitColumns cuts a sheet at full-height gaps and leaves an overlapping crowd whole', () => {
  const bm = canvas(300, 100, WHITE);
  rect(bm, 10, 10, 60, 80, BLUE);
  rect(bm, 110, 10, 60, 80, INK);
  rect(bm, 220, 10, 60, 80, BLUE);
  assert.deepEqual(av.splitColumns(bm, WHITE, 28), [{ x: 10, w: 60 }, { x: 110, w: 60 }, { x: 220, w: 60 }]);
  const crowd = canvas(300, 100, WHITE);
  rect(crowd, 10, 10, 280, 80, BLUE);
  assert.equal(av.splitColumns(crowd, WHITE, 28).length, 1, 'one slice for an unbroken figure');
});

test('process end to end: a captioned figure on white becomes a 336 px transparent standee', async () => {
  const bm = canvas(400, 1000, WHITE);
  rect(bm, 100, 40, 200, 760, BLUE);
  rect(bm, 150, 840, 100, 30, INK);
  const [r] = await av.process(await png(bm));
  assert.deepEqual(r.report.background, WHITE);
  assert.ok(r.report.captionRows > 150 && r.report.captionRows < 210, 'caption cropped: ' + r.report.captionRows);
  assert.equal(r.report.output.height, 336);
  assert.ok(r.report.output.width <= 260);
  const out = await Jimp.read(r.png);
  assert.equal(out.bitmap.height, 336);
  assert.ok(out.bitmap.data[3] < 8, 'corner is transparent');
  const mid = ((168 * out.bitmap.width) + Math.floor(out.bitmap.width / 2)) * 4;
  assert.equal(out.bitmap.data[mid + 3], 255, 'centre is opaque');
});

test('process on a wide figure caps the width at 260', async () => {
  const bm = canvas(1000, 500, WHITE);
  rect(bm, 20, 20, 960, 460, BLUE);
  const [r] = await av.process(await png(bm), { cropCaption: false });
  assert.equal(r.report.output.width, 260);
  assert.ok(r.report.output.height < 336);
});

test('process passes an already transparent standee through unchanged in size', async () => {
  const bm = av.makeBitmap(200, 336);
  rect(bm, 50, 0, 100, 336, BLUE);
  const [r] = await av.process(await png(bm));
  assert.equal(r.report.transparent, true);
  assert.equal(r.report.removed, 0);
  assert.deepEqual(r.report.output, { width: 104, height: 336 });
});

test('process splits a three-up sheet into three standees', async () => {
  const bm = canvas(900, 400, WHITE);
  rect(bm, 40, 20, 200, 340, BLUE);
  rect(bm, 340, 20, 200, 340, INK);
  rect(bm, 640, 20, 200, 340, BLUE);
  const results = await av.process(await png(bm), { split: true, cropCaption: false });
  assert.equal(results.length, 3);
  for (const r of results) assert.equal(r.report.output.height, 336);
});

test('process decodes JPEG', async () => {
  const bm = canvas(300, 600, WHITE);
  rect(bm, 80, 40, 140, 520, BLUE);
  const im = new Jimp({ width: 300, height: 600, data: Buffer.from(bm.data) });
  const jpg = await im.getBuffer('image/jpeg', { quality: 92 });
  const [r] = await av.process(jpg, { cropCaption: false });
  assert.equal(r.report.output.height, 336);
  assert.ok(r.report.removed > 100000);
});
