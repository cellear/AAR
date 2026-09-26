'use strict';
/* The store in live mode against a temp staff: the watcher and the event
   stream. The CLI and git are not involved (sessions are injected). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const config = require('../server/lib/config');
const setup = require('../server/lib/setup');
const { createStore } = require('../server/lib/store');
const { createHandler } = require('../server/server');

/* Collect frames until `done(frames)` says so, or the timeout. */
function frames(base, done, ms = 4000) {
  return new Promise((resolve, reject) => {
    const out = [];
    const req = http.get(base + '/api/events', (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        let i;
        while ((i = buf.indexOf('\n\n')) !== -1) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) out.push(JSON.parse(line.slice(6)));
          if (done(out)) { req.destroy(); resolve(out); }
        }
      });
    });
    req.on('error', (e) => { if (done(out)) resolve(out); else reject(e); });
    setTimeout(() => { req.destroy(); resolve(out); }, ms);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('SSE sends init first, then an office frame after a status.md write, and reacts to sessions', async (t) => {
  const staffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aar-live-'));
  const cfg = { ...config.DEFAULTS, appRoot: config.APP_ROOT, staffDir, pollMs: 60000, gitFetchMs: 0 };
  setup.createStaff({ cfg, name: 'Robin', persist: false });
  /* Keep the CLI and git out of it: inject fixtures for both. */
  let injected = [];
  const store = createStore(cfg, { live: true, sources: { listSessions: async () => injected, gitStatus: async () => null } });
  store.start();
  const server = http.createServer(createHandler(cfg, store));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => { server.close(); store.stop(); });

  const statusFile = path.join(staffDir, 'Chief of Staff', 'status.md');
  const has = (type, extra = () => true) => (list) => list.some((f) => f.type === type && extra(f));
  const pending = frames(base, has('office'));
  await sleep(300);
  fs.writeFileSync(statusFile, 'Now: Watching the watcher\nNeed from you: A nod\nNext: Rest\n');
  const got = await pending;
  assert.equal(got[0].type, 'init');
  assert.equal(got[0].offices[0].name, 'Robin');
  assert.equal(got[0].stale, null);
  const officeFrame = got.find((f) => f.type === 'office');
  assert.ok(officeFrame, 'expected an office frame, got ' + JSON.stringify(got.map((f) => f.type)));
  assert.equal(officeFrame.office.bubble.text, 'Watching the watcher');
  assert.deepEqual(officeFrame.office.badges, ['needsYou']);

  /* A session appearing for the office turns the dot on. */
  injected = [{ id: 'sess1', cwd: path.join(staffDir, 'Chief of Staff'), name: 'Robin - Chief of Staff', status: 'busy', startedAt: new Date().toISOString(), kind: 'interactive' }];
  const next = frames(base, has('office', (f) => f.office.session));
  await sleep(100);
  await store.pollSessions();
  const got2 = await next;
  const withSession = got2.find((f) => f.type === 'office');
  assert.ok(withSession, JSON.stringify(got2.map((f) => [f.type, f.office && f.office.liveness])));
  assert.equal(withSession.office.liveness, 'busy');
  assert.equal(withSession.office.session.id, 'sess1');

  /* A front desk session lands in its own frame. */
  injected = [{ id: 'sess2', cwd: staffDir, name: 'aar-3', status: 'idle', startedAt: null, kind: 'background' }];
  const third = frames(base, has('frontDesk'));
  await sleep(100);
  await store.pollSessions();
  const got3 = await third;
  assert.ok(got3.find((f) => f.type === 'frontDesk' && f.sessions[0].id === 'sess2'));

  /* A new office folder is a roster change: clients get a fresh init. */
  const fourth = frames(base, (list) => list.slice(1).some((f) => f.type === 'init'));
  await sleep(100);
  fs.mkdirSync(path.join(staffDir, 'Prospects'));
  fs.writeFileSync(path.join(staffDir, 'Prospects', 'aa.conf'), 'name=Holly - Headhunter\nmodel=sonnet\n');
  const got4 = await fourth;
  const init = got4.find((f, i) => i > 0 && f.type === 'init');
  assert.ok(init, JSON.stringify(got4.map((f) => f.type)));
  assert.equal(init.offices.length, 2);
});
