'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app, ROOT } = require('./helpers');

test('office page: sections, people pictures, deadlines, checkboxes, log, sidebar', async (t) => {
  const a = await app(t);
  if (!a) return;
  const office = a.office('Prospects');
  fs.mkdirSync(path.join(office, 'people'));
  fs.copyFileSync(path.join(ROOT, 'assets', 'avatars', 'cast-07.png'), path.join(office, 'people', 'ada-lovelace.png'));
  fs.writeFileSync(path.join(office, 'people.md'), 'not read by AAR');
  const { page } = a;
  await a.goto('/office/Prospects');
  await page.waitForSelector('.pcard[data-kind="deadlines"]');
  assert.match(await page.textContent('#name'), /Holly/);
  assert.match(await page.textContent('#role'), /Headhunter/);
  assert.match(await page.textContent('.desk .bubble'), /Say yes or no/);
  const whens = await page.$$eval('.pcard[data-kind="deadlines"] .when', (els) => els.map((e) => e.textContent));
  assert.equal(whens[whens.length - 1], 'undated');
  assert.equal(await page.locator('.pcard[data-kind="openItems"] .checklist li').count(), 3);
  assert.equal(await page.locator('.pcard[data-kind="openItems"] .checklist li.done').count(), 1);
  assert.equal(await page.locator('.pcard[data-kind="people"] .people figure').count(), 1);
  assert.match(await page.textContent('.pcard[data-kind="people"] figcaption'), /Ada Lovelace/);
  const img = page.locator('.pcard[data-kind="people"] .people img');
  assert.ok(await img.evaluate((i) => i.naturalWidth > 0), 'people picture served');
  assert.match(await page.textContent('.timeline'), /Two replies/);
  assert.match(await page.textContent('#side'), /people\.md/);
  assert.match(await page.textContent('#side'), /Talking to Holly/);
  assert.match(await page.textContent('#side'), /Holly - Headhunter/);
});

test('office page: launch button copies the command', async (t) => {
  const a = await app(t);
  if (!a) return;
  const { page } = a;
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await a.goto('/office/Prospects');
  await page.waitForSelector('#launch');
  await page.click('#launch');
  await page.waitForSelector('.toast.show');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.match(clip, /^cd ".*Prospects" && \S*claude --model sonnet --name "Holly - Headhunter"$/);
});
