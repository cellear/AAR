'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const setup = require('../server/lib/setup');
const template = require('../server/lib/template');
const staff = require('../server/lib/staff');
const config = require('../server/lib/config');

const cfg = () => ({ ...config.DEFAULTS, appRoot: config.APP_ROOT, staffDir: fs.mkdtempSync(path.join(os.tmpdir(), 'aar-setup-')) });

test('fill replaces known placeholders and leaves unknown ones', () => {
  assert.equal(template.fill('Hi {{name}}, {{ name }} of {{brand}}; {{missing}}', { name: 'Casey', brand: 'AAR' }), 'Hi Casey, Casey of AAR; {{missing}}');
});

test('createStaff renders the Chief of Staff office with placeholders filled', () => {
  const c = cfg();
  const r = setup.createStaff({ cfg: c, name: 'Casey', now: new Date('2026-09-26T00:00:00Z'), persist: false });
  assert.equal(r.staffDir, c.staffDir);
  assert.equal(r.office, 'Chief of Staff');
  const dir = path.join(c.staffDir, 'Chief of Staff');
  for (const f of ['aa.conf', 'README.md', 'briefing.md', 'log.md', 'CLAUDE.md', 'status.md', 'mornings/.gitkeep']) {
    assert.ok(fs.existsSync(path.join(dir, f)), f);
    if (f !== 'mornings/.gitkeep') assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), /\{\{/, f + ' has an unfilled placeholder');
  }
  const conf = staff.parseConf(fs.readFileSync(path.join(dir, 'aa.conf'), 'utf8'));
  assert.equal(conf.shortName, 'Casey');
  assert.equal(conf.cos, true);
  assert.equal(conf.role, 'Chief of Staff');
  assert.match(fs.readFileSync(path.join(dir, 'log.md'), 'utf8'), /## \d{4}-\d{2}-\d{2}/);
  assert.match(fs.readFileSync(path.join(dir, 'CLAUDE.md'), 'utf8'), /<!-- aar:start -->/);
  assert.equal(staff.discoverOffices(c.staffDir).length, 1);
  assert.match(r.gitInitCommand, /^cd ".*" && git init/);
});

test('createStaff uses the default name, refuses an existing staff, and rejects bad input', () => {
  const c = cfg();
  const r = setup.createStaff({ cfg: c, persist: false });
  assert.equal(r.name, setup.DEFAULT_NAME);
  assert.throws(() => setup.createStaff({ cfg: c, persist: false }), (e) => e.status === 409);
  const c2 = cfg();
  assert.throws(() => setup.createStaff({ cfg: c2, name: 'a/b', persist: false }), (e) => e.status === 400);
  assert.throws(() => setup.createStaff({ cfg: c2, staffDir: '/', persist: false }), (e) => e.status === 400);
  assert.equal(staff.discoverOffices(c2.staffDir).length, 0);
});

test('createStaff can target a folder that does not exist yet and says so', () => {
  const c = cfg();
  const target = path.join(c.staffDir, 'nested', 'staff');
  const r = setup.createStaff({ cfg: c, staffDir: target, name: 'Robin', persist: false });
  assert.equal(r.createdFolder, true);
  assert.equal(staff.discoverOffices(target)[0].name, 'Robin');
  const r2 = setup.createStaff({ cfg: cfg(), name: 'Sam', persist: false });
  assert.equal(r2.createdFolder, false);
});

test('createStaff writes the chosen accent and starter avatar, and rejects bad ones', () => {
  const c = cfg();
  setup.createStaff({ cfg: c, name: 'Alfred', accent: '#2E7D6B', avatar: 'eric.png', persist: false });   /* an old name: resolved to the numbered file */
  const conf = staff.parseConf(fs.readFileSync(path.join(c.staffDir, 'Chief of Staff', 'aa.conf'), 'utf8'));
  assert.equal(conf.accent, '#2e7d6b');
  assert.equal(conf.avatar, 'cast-03.png');
  const c2 = cfg();
  assert.throws(() => setup.createStaff({ cfg: c2, name: 'A', avatar: '../x.png', persist: false }), (e) => e.status === 400);
  assert.throws(() => setup.createStaff({ cfg: c2, name: 'A', accent: 'red', persist: false }), (e) => e.status === 400);
  const r = setup.createStaff({ cfg: c2, name: 'A', avatar: 'own', persist: false });
  assert.equal(staff.parseConf(fs.readFileSync(path.join(r.staffDir, 'Chief of Staff', 'aa.conf'), 'utf8')).avatar, '');
});
