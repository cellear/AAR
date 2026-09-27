'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../server/lib/config');
const { createServer } = require('../server/server');

function startServer() {
  const staffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aar-srv-'));
  const cfg = { ...config.DEFAULTS, appRoot: config.APP_ROOT, staffDir, configPath: path.join(staffDir, 'cfg.json') };
  const server = createServer(cfg, { live: false });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, cfg, base: `http://127.0.0.1:${server.address().port}` })));
}

async function call(base, p, init) {
  const res = await fetch(base + p, init);
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, headers: res.headers };
}

test('server: first run, setup, snapshots, method and path rules', async (t) => {
  const { server, cfg, base } = await startServer();
  t.after(() => server.close());

  let r = await call(base, '/api/staff');
  assert.equal(r.status, 200);
  assert.equal(r.body.staff.count, 0);
  assert.equal(r.body.staff.exists, true);
  assert.equal(r.headers.get('cache-control'), 'no-store, max-age=0');

  r = await call(base, '/api/offices');
  assert.deepEqual(r.body.offices, []);

  r = await call(base, '/api/cos');
  assert.equal(r.status, 404);

  /* Every non-GET is refused before any path is resolved, except the setup POST. */
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    for (const p of ['/api/offices', '/api/staff', '/', '/avatars/cast/x.png', '/api/nope']) {
      r = await call(base, p, { method });
      assert.equal(r.status, 405, `${method} ${p}`);
    }
  }
  r = await call(base, '/api/setup', { method: 'PUT' });
  assert.equal(r.status, 405);

  r = await call(base, '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{not json' });
  assert.equal(r.status, 400);

  r = await call(base, '/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Casey' }) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.office, 'Chief of Staff');
  assert.ok(fs.existsSync(path.join(cfg.staffDir, 'Chief of Staff', 'aa.conf')));

  r = await call(base, '/api/setup', { method: 'POST', body: '{}' });
  assert.equal(r.status, 409);

  r = await call(base, '/api/offices');
  assert.equal(r.body.staff.count, 1);
  assert.equal(r.body.staff.cos, 'Chief of Staff');
  const office = r.body.offices[0];
  assert.equal(office.name, 'Casey');
  assert.equal(office.cos, true);
  assert.equal(office.liveness, 'none');
  assert.equal(office.bubble.source, 'none');
  assert.deepEqual(office.badges, []);
  assert.equal(office.briefing.sections.find((s) => s.kind === 'openItems').items.length, 2);

  fs.writeFileSync(path.join(cfg.staffDir, 'Chief of Staff', 'status.md'), 'Now: Reading the plan\nNeed from you: Pick a name\nNext: Hire someone\n');
  r = await call(base, '/api/offices/' + encodeURIComponent('Chief of Staff'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.bubble, { text: 'Reading the plan', source: 'status' });
  assert.deepEqual(r.body.badges, ['needsYou']);

  r = await call(base, '/api/offices/Nobody');
  assert.equal(r.status, 404);

  r = await call(base, '/api/cos');
  assert.equal(r.status, 200);
  assert.equal(r.body.needs[0].text, 'Pick a name');
  assert.equal(r.body.openItems[0].items.length, 2);

  /* Images: only the two names, only inside an office, no traversal. */
  fs.writeFileSync(path.join(cfg.staffDir, 'Chief of Staff', 'avatar.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  r = await call(base, '/avatars/' + encodeURIComponent('Chief of Staff') + '/avatar.png');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/png');
  fs.mkdirSync(path.join(cfg.staffDir, 'Chief of Staff', 'people'));
  fs.writeFileSync(path.join(cfg.staffDir, 'Chief of Staff', 'people', 'ada.jpg'), Buffer.from([0xff, 0xd8]));
  r = await call(base, '/avatars/' + encodeURIComponent('Chief of Staff') + '/people/ada.jpg');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  for (const p of [
    '/avatars/' + encodeURIComponent('Chief of Staff') + '/people/..%2faa.conf',
    '/avatars/' + encodeURIComponent('Chief of Staff') + '/people/notes.md',
    '/avatars/' + encodeURIComponent('Chief of Staff') + '/aa.conf',
    '/avatars/' + encodeURIComponent('Chief of Staff') + '/office.png',
    '/avatars/%2e%2e/cfg.json',
    '/avatars/%2e%2e/%2e%2e/etc/passwd/avatar.png',
    '/avatars/cast/..%2f..%2fpackage.json',
    '/avatars/cast/%2e%2e%2f%2e%2e%2fpackage.json',
    '/avatars/cast/',
    '/avatars/Nope/avatar.png',
    '/api/../package.json',
    '/%2e%2e/package.json'
  ]) {
    r = await call(base, p);
    assert.equal(r.status, 404, p);
  }

  r = await call(base, '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/html/);
  r = await call(base, '/', { method: 'HEAD' });
  assert.equal(r.status, 200);
  r = await call(base, '/', { method: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('allow'), 'GET, HEAD, OPTIONS');
});
