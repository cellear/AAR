'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../server/lib/config');
const setup = require('../server/lib/setup');
const hire = require('../server/lib/hire');
const staff = require('../server/lib/staff');
const disable = require('../server/lib/disable');

function cfg() {
  const c = { ...config.DEFAULTS, appRoot: config.APP_ROOT, staffDir: fs.mkdtempSync(path.join(os.tmpdir(), 'aar-disable-')) };
  setup.createStaff({ cfg: c, name: 'Casey', persist: false });
  hire.hire({ name: 'Holly', role: 'Headhunter', folder: 'Prospects', covers: 'The job hunt.', model: 'sonnet', accent: '#c2603f', avatar: 'cast-09.png' }, c);
  return c;
}

test('disable moves the office whole into Disabled/ and enable brings it back', () => {
  const c = cfg();
  fs.writeFileSync(path.join(c.staffDir, 'Prospects', 'notes.md'), 'kept');
  const r = disable.disable('Prospects', c);
  assert.equal(r.to, path.join(c.staffDir, 'Disabled', 'Prospects'));
  assert.ok(!fs.existsSync(path.join(c.staffDir, 'Prospects')));
  assert.equal(fs.readFileSync(path.join(r.to, 'notes.md'), 'utf8'), 'kept', 'nothing inside is touched');
  assert.deepEqual(staff.discoverOffices(c.staffDir).map((o) => o.id), ['Chief of Staff'], 'the lobby no longer sees it');
  assert.deepEqual(disable.listDisabled(c), [{ id: 'Prospects', name: 'Holly', role: 'Headhunter' }]);

  const e = disable.enable('Prospects', c);
  assert.equal(e.to, path.join(c.staffDir, 'Prospects'));
  assert.ok(fs.existsSync(path.join(c.staffDir, 'Prospects', 'notes.md')));
  assert.deepEqual(disable.listDisabled(c), []);
});

test('disable refuses the Chief of Staff, unknown offices, bad ids and a clash', () => {
  const c = cfg();
  assert.throws(() => disable.disable('Chief of Staff', c), /cannot be disabled/);
  assert.throws(() => disable.disable('Nope', c), { status: 404 });
  assert.throws(() => disable.disable('../x', c), { status: 400 });
  assert.throws(() => disable.enable('Prospects', c), { status: 404 });
  fs.mkdirSync(path.join(c.staffDir, 'Disabled', 'Prospects'), { recursive: true });
  assert.throws(() => disable.disable('Prospects', c), { status: 409 });
  assert.ok(fs.existsSync(path.join(c.staffDir, 'Prospects', 'aa.conf')), 'refusing leaves the office where it was');
  fs.rmSync(path.join(c.staffDir, 'Disabled', 'Prospects'), { recursive: true });
  disable.disable('Prospects', c);
  fs.mkdirSync(path.join(c.staffDir, 'Prospects'));
  assert.throws(() => disable.enable('Prospects', c), { status: 409 });
  assert.ok(fs.existsSync(path.join(c.staffDir, 'Disabled', 'Prospects', 'aa.conf')), 'refusing leaves the disabled office where it was');
});
