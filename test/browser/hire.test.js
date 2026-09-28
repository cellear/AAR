'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app } = require('./helpers');

test('hire wizard: creates an office, refuses a duplicate, the floor gains a figure', async (t) => {
  const a = await app(t);
  if (!a) return;
  const { page } = a;
  await a.goto('/hire');
  await page.waitForSelector('#cast label');
  assert.ok((await page.locator('#cast label').count()) >= 10, 'starter cast plus own');
  await page.fill('input[name=name]', 'Ivy');
  await page.fill('input[name=role]', 'AI Community');
  assert.equal(await page.inputValue('input[name=folder]'), 'AI Community', 'folder suggested from the role');
  await page.fill('textarea[name=covers]', 'Bay Area AI events and the people at them.');
  await page.click('.swatch[data-accent="#3a6a8a"]');
  await page.click('#cast label:nth-child(6)');
  await page.click('button.primary');
  await page.waitForSelector('#done:not([style*="none"])');
  assert.match(await page.textContent('#done'), /Ivy has an office/);
  const dir = path.join(a.staffDir, 'AI Community');
  for (const f of ['aa.conf', 'README.md', 'briefing.md', 'log.md', 'CLAUDE.md', 'status.md', 'avatar-prompts.md']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.match(fs.readFileSync(path.join(dir, 'aa.conf'), 'utf8'), /accent=#3a6a8a/);
  assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /Bay Area AI events/);

  await a.goto('/hire');
  await page.waitForSelector('#cast label');
  await page.fill('input[name=name]', 'Ivy2');
  await page.fill('input[name=role]', 'AI Community');
  await page.click('button.primary');
  await page.waitForFunction(() => /already exists/.test(document.getElementById('err').textContent));

  await a.goto('/');
  await page.waitForSelector('.person[data-id="AI Community"]');
  assert.equal(await page.locator('.person').count(), 6);
});
