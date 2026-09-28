'use strict';
/* helpers.js: the browser suite's fixtures. Each test gets a fresh temp staff
   seeded by server/demo.js, a server on a free port with its settings and
   transcripts in temp folders, a Chrome page that fails the test on any
   page error, and a fake assistant that appends transcript lines the way
   Claude Code does. Everything is torn down when the test ends. Nothing is
   written inside the repo. */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright-core');
const { after } = require('node:test');
const platform = require('../../server/lib/platform');

const ROOT = path.resolve(__dirname, '..', '..');

/* The browser: AAR_BROWSER names an executable; otherwise the Chrome on this
   machine; otherwise a Playwright Chromium if one is installed. */
async function launchBrowser() {
  if (process.env.AAR_BROWSER) return chromium.launch({ executablePath: process.env.AAR_BROWSER });
  const guesses = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ];
  for (const exe of guesses) if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe });
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pw && fs.existsSync(pw)) {
    for (const d of fs.readdirSync(pw)) {
      for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
        const exe = path.join(pw, d, rel);
        if (fs.existsSync(exe)) return chromium.launch({ executablePath: exe });
      }
    }
  }
  try { return await chromium.launch({ channel: 'chrome' }); } catch { /* no chrome */ }
  return null;
}

let browserPromise = null;
function browser() {
  if (!browserPromise) browserPromise = launchBrowser();
  return browserPromise;
}

/* A staff folder: empty, or seeded with the demo staff. */
function makeStaff({ seed = true } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aar-browser-'));
  const staffDir = path.join(base, 'staff');
  if (seed) {
    const r = require('child_process').spawnSync(process.execPath, [path.join(ROOT, 'server', 'demo.js'), staffDir], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('demo seed failed: ' + r.stderr);
  }
  return { base, staffDir };
}

/* Start the server as a child process, the way a user would, and read the
   port from what it prints. */
function startServer(base, staffDir, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      AAR_CONFIG: path.join(base, 'aar.config.json'),
      AAR_STAFF_DIR: staffDir,
      AAR_TRANSCRIPT_ROOT: path.join(base, 'transcripts'),
      AAR_CLAUDE_BIN: path.join(base, 'no-such-claude'),   /* no real sessions */
      AAR_PORT: '0',
      AAR_NO_OPEN: '1',
      ...extraEnv
    };
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', (c) => {
      out += c;
      const m = /http:\/\/localhost:(\d+)\//.exec(out);
      if (m) resolve({ child, base: `http://127.0.0.1:${m[1]}`, env });
    });
    child.stderr.on('data', (c) => { out += c; });
    child.on('exit', (code) => reject(new Error(`server exited ${code}: ${out}`)));
    setTimeout(() => reject(new Error('server did not start: ' + out)), 8000);
  });
}

/* The fake assistant: appends JSONL lines shaped like Claude Code's to the
   office's transcript bucket. */
function fakeAssistant(env, officeFolder, sessionId = 'aaaaaaaa-0000-4000-8000-000000000001') {
  const dir = path.join(env.AAR_TRANSCRIPT_ROOT, platform.bucketNameForCwd(officeFolder));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  let n = 0;
  let turn = 0;   /* one requestId per assistant turn: text, then its tool calls */
  const line = (o) => fs.appendFileSync(file, JSON.stringify({ ...o, sessionId, uuid: `u${++n}`, timestamp: new Date().toISOString() }) + '\n');
  return {
    file,
    prompt(text) { line({ type: 'user', message: { role: 'user', content: text } }); },
    say(text) { turn++; line({ type: 'assistant', requestId: `r${turn}`, message: { model: 'claude-sonnet-5', content: [{ type: 'text', text }] } }); },
    /* A tool call in the current turn (after a say), with its result. */
    run(name, input, result) {
      const id = `t${n}`;
      line({ type: 'assistant', requestId: `r${turn}`, message: { model: 'claude-sonnet-5', content: [{ type: 'tool_use', id, name, input: { command: input } }] } });
      line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: result }] } });
    },
    away(text) { line({ type: 'system', subtype: 'away_summary', content: text }); }
  };
}

/* The fixture most tests want. Skips the test when no browser is available. */
async function app(t, { seed = true } = {}) {
  const b = await browser();
  if (!b) { t.skip('no Chrome found; set AAR_BROWSER to a browser executable'); return null; }
  const { base, staffDir } = makeStaff({ seed });
  const server = await startServer(base, staffDir);
  const context = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('page error: ' + e.message));
  /* A 4xx the test provoked on purpose (a duplicate hire, a bad path) logs a
     resource error in the console; only script errors count. */
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('requestfailed', (r) => errors.push('request failed: ' + r.url()));
  t.after(async () => {
    await context.close();
    server.child.kill();
    fs.rmSync(base, { recursive: true, force: true });
    if (errors.length) throw new Error(errors.join('\n'));
  });
  return {
    page, base: server.base, staffDir, env: server.env, errors,
    office: (id) => path.join(staffDir, id),
    assistant: (id, sid) => fakeAssistant(server.env, path.join(staffDir, id), sid),
    goto: (p) => page.goto(server.base + p),
    async phone() { const c = await b.newContext({ viewport: { width: 390, height: 800 } }); const pg = await c.newPage(); t.after(() => c.close()); return pg; }
  };
}

/* Backdate an office's files so it reads as quiet. */
function backdate(officeDir, days) {
  const t = new Date(Date.now() - days * 86400000);
  for (const f of ['status.md', 'log.md', 'briefing.md', 'README.md']) {
    const file = path.join(officeDir, f);
    if (fs.existsSync(file)) fs.utimesSync(file, t, t);
  }
}

/* One browser per test file, closed when the file's tests are done. */
after(async () => { if (browserPromise) { const b = await browserPromise; if (b) await b.close(); } });

module.exports = { app, backdate, ROOT };
