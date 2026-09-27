'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app, backdate } = require('./helpers');

test('floor: plates, pins, recency fading, live updates', async (t) => {
  const a = await app(t);
  if (!a) return;
  backdate(a.office('Biography'), 9);
  backdate(a.office('Marketing'), 2);
  const { page } = a;
  await a.goto('/');
  await page.waitForSelector('.person[data-id="Biography"].q2');
  const names = await page.$$eval('.person .plate .n', (els) => els.map((e) => e.textContent.trim().split(/\s+/)[0]));
  assert.deepEqual(names, ['Eric', 'Holly', 'Maya', 'Marissa', 'Walter']);
  assert.match(await page.textContent('.person[data-id="Prospects"] .plate .s'), /^Needs you:/);
  assert.equal(await page.locator('.person[data-id="Prospects"] .pin').count(), 1);
  assert.equal(await page.locator('.person[data-id="Marketing"].q1').count(), 1);
  assert.equal(await page.locator('.person[data-id="Chief of Staff"].q1, .person[data-id="Chief of Staff"].q2').count(), 0);
  assert.match(await page.textContent('#stats'), /2 need you/);

  /* A status.md write shows within seconds, without reloading. */
  fs.writeFileSync(path.join(a.office('Marketing'), 'status.md'), 'Now: Posting the October piece.\nNeed from you: Approve the headline.\nNext: Rest.\n');
  await page.waitForFunction(() => /Approve the headline/.test(document.querySelector('.person[data-id="Marketing"] .plate .s').textContent), null, { timeout: 8000 });
  assert.equal(await page.locator('.person[data-id="Marketing"] .pin').count(), 1);
  assert.match(await page.textContent('#stats'), /3 need you/);
  assert.equal(await page.locator('.person[data-id="Marketing"].q1').count(), 0, 'a fresh write un-fades');
});

test('floor: focus, panels, switching, back', async (t) => {
  const a = await app(t);
  if (!a) return;
  const { page } = a;
  await a.goto('/');
  await page.waitForSelector('.person[data-id="Prospects"]');
  await page.click('.person[data-id="Prospects"]');
  await page.waitForSelector('#floor.focus');
  assert.equal(await page.locator('.person.sel[data-id="Prospects"]').count(), 1);
  const note = await page.textContent('.fpanel.note');
  assert.match(note, /Holly/);
  assert.match(note, /Headhunter/);
  assert.match(note, /Say yes or no/);
  assert.match(note, /Open session/);
  assert.match(await page.textContent('#panels'), /Upcoming deadlines/);
  assert.match(await page.textContent('#panels'), /Open items/);
  assert.match(await page.textContent('#panels'), /Recent log/);
  await page.click('.person[data-id="Chief of Staff"]');
  await page.waitForSelector('.person.sel[data-id="Chief of Staff"]');
  assert.match(await page.textContent('#panels'), /Across the offices/);
  await page.waitForFunction(() => /Say yes or no/.test(document.querySelector('#panels').textContent));
  await page.goBack();
  await page.waitForSelector('.person.sel[data-id="Prospects"]');
  await page.click('#close');
  await page.waitForFunction(() => !document.getElementById('floor').classList.contains('focus'));
  assert.equal(await page.locator('#panels').isVisible(), false);
  await page.click('#viewtoggle a[data-view="cards"]');
  await page.waitForSelector('.card');
  assert.equal(await page.locator('.card').count(), 5);
});

test('floor: phone width has no sideways overflow', async (t) => {
  const a = await app(t);
  if (!a) return;
  const page = await a.phone();
  for (const p of ['/', '/#Prospects', '/office/Prospects', '/cos', '/hire']) {
    await page.goto(a.base + p);
    await page.waitForTimeout(700);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 1, `${p} overflows by ${over}px`);
  }
});
