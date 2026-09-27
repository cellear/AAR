'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./helpers');

test('conversation: nothing yet, then a live-updating transcript', async (t) => {
  const a = await app(t);
  if (!a) return;
  const { page } = a;
  await a.goto('/office/Prospects#conversation');
  await page.waitForSelector('#convo .none');
  assert.match(await page.textContent('#convo'), /No transcript on this Mac/);

  const holly = a.assistant('Prospects');
  holly.prompt('Hi Holly. Find me a job.');
  holly.say('Reading the briefing first.');
  holly.run('Bash', 'ls && cat briefing.md', 'aa.conf\nbriefing.md');
  await page.waitForSelector('.msg.assistant', { timeout: 8000 });
  assert.equal(await page.locator('.msg.user').count(), 1);
  assert.match(await page.textContent('.msg.user .body'), /Find me a job/);
  assert.match(await page.textContent('.msg.assistant .body'), /Reading the briefing first/);
  const tool = page.locator('.msg.assistant details.tool');
  assert.match(await tool.textContent(), /Bash/);
  await tool.locator('summary').click();
  assert.match(await tool.locator('pre').textContent(), /briefing\.md/);

  holly.say('Two leads found:\n\n1. **Acme**\n2. **Globex**');
  await page.waitForFunction(() => /Globex/.test(document.getElementById('msgs').textContent), null, { timeout: 8000 });
  assert.equal(await page.locator('.msg.assistant').count(), 2, 'text and its tool call are one message');
  assert.equal(await page.locator('.msg.assistant .body strong').count(), 2, 'markdown rendered');
  assert.equal(await tool.evaluate((d) => d.open), true, 'opened tool stays open across updates');
});

test('conversation: scroll holds while the assistant keeps writing; earlier pages keep their place', async (t) => {
  const a = await app(t);
  if (!a) return;
  const holly = a.assistant('Prospects');
  for (let i = 1; i <= 80; i++) { holly.prompt(`Question ${i}`); holly.say(`Answer ${i}. ` + 'Some detail. '.repeat(12)); }
  const { page } = a;
  await a.goto('/office/Prospects#conversation');
  await page.waitForSelector('.msg');
  const msgs = page.locator('#msgs');
  const state = () => msgs.evaluate((m) => ({ top: m.scrollTop, height: m.scrollHeight, count: m.querySelectorAll('.msg').length, atBottom: m.scrollHeight - m.scrollTop - m.clientHeight < 40 }));
  let s = await state();
  assert.equal(s.count, 60, 'the last sixty on open');
  assert.equal(s.atBottom, true, 'pinned to the bottom on open');

  /* Reader scrolls up; the assistant keeps talking; the view must not move. */
  await msgs.evaluate((m) => { m.scrollTop = 500; m.dispatchEvent(new Event('scroll')); });
  holly.say('A new answer while you were reading.');
  holly.run('Read', 'briefing.md', 'contents');
  await page.waitForFunction(() => /while you were reading/.test(document.getElementById('msgs').textContent), null, { timeout: 8000 });
  await page.waitForTimeout(4500);
  s = await state();
  assert.equal(s.top, 500, 'scroll position held');

  /* Page back: the same content stays in view. */
  const before = await state();
  await page.evaluate(() => document.getElementById('earlier').click());
  await page.waitForFunction((n) => document.querySelectorAll('.msg').length > n, before.count);
  s = await state();
  assert.equal(s.count, before.count + 60);
  assert.equal(s.height - s.top, before.height - before.top, 'same content in view after paging');

  /* Back at the bottom, new replies scroll into view. */
  await msgs.evaluate((m) => { m.scrollTop = m.scrollHeight; m.dispatchEvent(new Event('scroll')); });
  holly.say('The very latest.');
  await page.waitForFunction(() => /The very latest/.test(document.getElementById('msgs').textContent), null, { timeout: 8000 });
  s = await state();
  assert.equal(s.atBottom, true, 'follows the tail when the reader was at the bottom');
});

test('conversation: session picker chooses among transcripts', async (t) => {
  const a = await app(t);
  if (!a) return;
  const old = a.assistant('Prospects', 'aaaaaaaa-0000-4000-8000-000000000001');
  old.say('From the older session.');
  await new Promise((r) => setTimeout(r, 1100));
  const fresh = a.assistant('Prospects', 'bbbbbbbb-0000-4000-8000-000000000002');
  fresh.say('From the newest session.');
  const { page } = a;
  await a.goto('/office/Prospects#conversation');
  await page.waitForSelector('.msg.assistant');
  assert.match(await page.textContent('#msgs'), /newest session/);
  assert.equal(await page.locator('#sesspick option').count(), 2);
  await page.selectOption('#sesspick', 'aaaaaaaa-0000-4000-8000-000000000001');
  await page.waitForFunction(() => /older session/.test(document.getElementById('msgs').textContent));
  assert.doesNotMatch(await page.textContent('#msgs'), /newest session/);
});
