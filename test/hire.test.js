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

function cfg() {
  const c = { ...config.DEFAULTS, appRoot: config.APP_ROOT, staffDir: fs.mkdtempSync(path.join(os.tmpdir(), 'aar-hire-')) };
  setup.createStaff({ cfg: c, name: 'Casey', persist: false });
  return c;
}
const form = (over = {}) => ({ name: 'Holly', role: 'Headhunter', folder: 'Prospects', covers: 'The job hunt.', model: 'sonnet', accent: '#C2603F', avatar: 'stacey.png', ...over });

test('hire renders every template file with placeholders filled and writes the prompts', () => {
  const c = cfg();
  const r = hire.hire(form(), c, { now: new Date('2026-09-27T10:00:00') });
  assert.equal(r.id, 'Prospects');
  assert.equal(r.order, 1);
  assert.deepEqual(r.files, ['CLAUDE.md', 'README.md', 'aa.conf', 'avatar-prompts.md', 'briefing.md', 'log.md', 'status.md']);
  for (const f of r.files) assert.doesNotMatch(fs.readFileSync(path.join(r.folder, f), 'utf8'), /\{\{/, f);
  const conf = staff.parseConf(fs.readFileSync(path.join(r.folder, 'aa.conf'), 'utf8'));
  assert.equal(conf.name, 'Holly - Headhunter');
  assert.equal(conf.shortName, 'Holly');
  assert.equal(conf.role, 'Headhunter');
  assert.equal(conf.model, 'sonnet');
  assert.equal(conf.accent, '#c2603f');
  assert.equal(conf.avatar, 'stacey.png');
  assert.equal(conf.order, 1);
  assert.equal(conf.cos, false);
  const prompts = fs.readFileSync(path.join(r.folder, 'avatar-prompts.md'), 'utf8');
  assert.match(prompts, /avatar\.png/);
  assert.match(prompts, /office\.png/);
  assert.match(prompts, /résumés/);
  assert.match(fs.readFileSync(path.join(r.folder, 'CLAUDE.md'), 'utf8'), /<!-- aar:start -->[\s\S]*<!-- aar:end -->/);
  assert.match(fs.readFileSync(path.join(r.folder, 'README.md'), 'utf8'), /The job hunt\./);
  const offices = staff.discoverOffices(c.staffDir);
  assert.deepEqual(offices.map((o) => o.id), ['Chief of Staff', 'Prospects']);
  assert.equal(hire.options(c).nextOrder, 2);
});

test('hire refuses an existing folder and bad input, and writes nothing on refusal', () => {
  const c = cfg();
  hire.hire(form(), c);
  assert.throws(() => hire.hire(form(), c), (e) => e.status === 409);
  assert.throws(() => hire.hire(form({ folder: 'Chief of Staff' }), c), (e) => e.status === 409);
  for (const bad of [
    { folder: 'a/b' }, { folder: '..' }, { folder: '.hidden' }, { folder: '' }, { name: '' }, { name: 'a"b' }, { role: '' },
    { model: 'gpt-9' }, { accent: 'red' }, { avatar: 'nobody.png' }
  ]) {
    assert.throws(() => hire.hire(form({ ...bad, folder: bad.folder === undefined ? 'X' : bad.folder }), c), (e) => e.status === 400, JSON.stringify(bad));
  }
  assert.ok(!fs.existsSync(path.join(c.staffDir, 'X')));
  assert.equal(staff.discoverOffices(c.staffDir).length, 2);
});

test('hire defaults: model, accent, own avatar, explicit order', () => {
  const c = cfg();
  const r = hire.hire({ name: 'Maya', role: 'Marketing', folder: 'Marketing', avatar: 'own', order: 7 }, c);
  const conf = staff.parseConf(fs.readFileSync(path.join(r.folder, 'aa.conf'), 'utf8'));
  assert.equal(conf.model, c.models[0]);
  assert.equal(conf.accent, '#5b7c99');
  assert.equal(conf.avatar, '');
  assert.equal(conf.order, 7);
  assert.match(fs.readFileSync(path.join(r.folder, 'briefing.md'), 'utf8'), /\(to be written\)/);
});

test('options lists the starter cast and taken folders', () => {
  const c = cfg();
  const o = hire.options(c);
  assert.ok(o.cast.some((x) => x.file === 'eric.png'));
  assert.deepEqual(o.taken, ['Chief of Staff']);
  assert.deepEqual(o.models, c.models);
});
