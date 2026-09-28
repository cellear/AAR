'use strict';
/* Talking to an assistant from the page, against the scripted SDK
   (AAR_TALK_FAKE=1): no real Claude Code runs. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { app } = require('./helpers');

const FAKE = { AAR_TALK_FAKE: '1' };

test('talk: start, a streamed reply, a permission answered, stop, and resume after a restart', async (t) => {
  const a = await app(t, { env: FAKE });
  if (!a) return;
  const { page } = a;
  await a.goto('/office/Prospects#reply');
  await page.waitForSelector('#reply');
  assert.match(await page.textContent('#reply .rstatus'), /No session yet/);
  assert.equal(await page.locator('#starttalk').count(), 1);

  /* Send starts the session and streams a reply into the card. */
  await page.fill('#say', 'Hello Holly, what are you working on?');
  await page.press('#say', 'Enter');
  await page.waitForFunction(() => /thinking/.test(document.querySelector('#reply .rstatus').textContent), null, { timeout: 5000 });
  assert.equal(await page.locator('#say').isDisabled(), true, 'the box is closed while she thinks');
  await page.waitForSelector('.msg.assistant.pending', { timeout: 5000 });
  await page.waitForFunction(() => /listening/.test(document.querySelector('#reply .rstatus').textContent), null, { timeout: 15000 });
  assert.match(await page.textContent('#msgs'), /You said "Hello Holly, what are you working on\?"/);
  assert.equal(await page.locator('.msg.user').count(), 1);
  assert.equal(await page.locator('#dot').getAttribute('class'), 'dot idle', 'the header dot shows AAR\'s session');
  assert.equal(await page.locator('#stoptalk').count(), 1);
  assert.match(await page.textContent('#side'), /aar/, 'the sidebar names the session kind');
  const record = JSON.parse(fs.readFileSync(path.join(path.dirname(a.env.AAR_CONFIG), 'aar.sessions.json'), 'utf8'));
  assert.equal(record.Prospects.sessionId, 'sess-1');

  /* A permission request: the prompt, the header pin, and Allow. */
  await page.fill('#say', 'please run ls');
  await page.press('#say', 'Enter');
  await page.waitForSelector('.ask', { timeout: 5000 });
  assert.match(await page.textContent('.ask'), /wants to use Bash/);
  assert.match(await page.textContent('.ask code'), /ls -la/);
  assert.match(await page.textContent('#askpin'), /Waiting for you/);
  assert.match(await page.textContent('#reply .rstatus'), /waiting for your answer/);
  await page.click('.ask [data-allow="1"]');
  await page.waitForFunction(() => !document.querySelector('.ask'), null, { timeout: 5000 });
  await page.waitForFunction(() => /listening/.test(document.querySelector('#reply .rstatus').textContent), null, { timeout: 15000 });
  assert.equal(await page.locator('#askpin').count(), 0);
  assert.equal(await page.locator('.msg.user').count(), 2);

  /* Stop keeps the record; the box says the last conversation can resume. */
  await page.click('#stoptalk');
  await page.waitForFunction(() => /Not running/.test(document.querySelector('#reply .rstatus').textContent), null, { timeout: 5000 });
  assert.equal(await page.locator('#forgettalk').count(), 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(a.env.AAR_CONFIG), 'aar.sessions.json'), 'utf8')).Prospects.sessionId, 'sess-1');

  /* Quit and start AAR again: sending resumes the remembered session. */
  const base = await a.restart();
  await page.goto(base + '/office/Prospects#reply');
  await page.waitForSelector('#reply');
  assert.match(await page.textContent('#reply .rstatus'), /Not running.*pick up the last conversation/);
  await page.fill('#say', 'still there?');
  await page.press('#say', 'Enter');
  await page.waitForFunction(() => /listening/.test(document.querySelector('#reply .rstatus').textContent), null, { timeout: 15000 });
  await page.waitForFunction(() => /still there\?/.test(document.getElementById('msgs').textContent), null, { timeout: 5000 });
  await page.click('#stoptalk');
  await page.waitForFunction(() => /Not running/.test(document.querySelector('#reply .rstatus').textContent), null, { timeout: 5000 });
});

test('talk: the floor shows Start / Stop / Talk and the waiting pin', async (t) => {
  const a = await app(t, { env: FAKE });
  if (!a) return;
  const { page } = a;
  await a.goto('/#Marketing');
  await page.waitForSelector('.talkstart');
  await page.click('.talkstart');
  await page.waitForSelector('.talkstop', { timeout: 5000 });
  await page.waitForFunction(() => /running here in AAR/.test(document.querySelector('.fpanel .how').textContent), null, { timeout: 5000 });
  assert.equal(await page.locator('.person.sel .pin').count(), 0);

  /* Provoke a permission from the office page in a second tab; the floor reacts. */
  const other = await page.context().newPage();
  await other.goto(a.base + '/office/Marketing#reply');
  await other.waitForSelector('#say:not([disabled])');
  await other.fill('#say', 'run ls');
  await other.press('#say', 'Enter');
  await page.waitForFunction(() => /waiting for your answer/.test(document.querySelector('.fpanel .how').textContent), null, { timeout: 8000 });
  await page.click('#close');
  await page.waitForSelector('.person[data-id="Marketing"] .pin.ask', { timeout: 5000 });
  assert.match(await page.textContent('.person[data-id="Marketing"] .plate .s'), /Waiting for you: may Maya use Bash/);
  await other.click('.ask [data-allow="0"]');
  await page.waitForFunction(() => !document.querySelector('.person[data-id="Marketing"] .pin.ask'), null, { timeout: 8000 });
  await other.close();
  await page.click('.person[data-id="Marketing"]');
  await page.waitForSelector('.talkstop');
  await page.click('.talkstop');
  await page.waitForSelector('.talkstart', { timeout: 5000 });
});

test('talk: turned off in the settings, the page is read-only again', async (t) => {
  const a = await app(t, { env: FAKE });
  if (!a) return;
  fs.writeFileSync(a.env.AAR_CONFIG, JSON.stringify({ staffDir: a.staffDir, talk: { enabled: false } }));
  await a.restart();
  const { page } = a;
  await page.goto(a.base + '/office/Prospects#reply');
  await page.waitForSelector('#convo');
  await page.waitForTimeout(800);
  assert.equal(await page.locator('#reply').count(), 0, 'no reply box');
  await page.goto(a.base + '/#Prospects');
  await page.waitForSelector('.fpanel.note');
  assert.equal(await page.locator('.talkstart').count(), 0);
  assert.match(await page.textContent('#stats'), /read-only/);
});

test('talk: a draft survives the conversation poll and a status refresh', async (t) => {
  const a = await app(t, { env: FAKE });
  if (!a) return;
  const { page } = a;
  /* Prospects has no transcript yet, the state where the empty card used
     to be rebuilt every poll and take the reply box with it. */
  await a.goto('/office/Prospects#reply');
  await page.waitForSelector('#say');
  await page.click('#say');
  await page.keyboard.type('A long message that takes a while to write, longer than one poll');
  const before = await page.evaluateHandle(() => document.querySelector('#say'));
  await page.waitForTimeout(4600);
  await page.evaluate(() => fetch('/api/talk/Prospects').then(() => null));
  await page.waitForTimeout(300);
  assert.equal(await page.inputValue('#say'), 'A long message that takes a while to write, longer than one poll');
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'say', 'focus stays in the box');
  assert.equal(await page.evaluate((b) => b === document.querySelector('#say'), before), true, 'the same textarea element is still there');
});
