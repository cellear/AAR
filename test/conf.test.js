'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const staff = require('../server/lib/staff');

test('parseConf reads keys, skips comments and blanks, keeps unknown keys aside', () => {
  const conf = staff.parseConf([
    '# launch settings',
    'model=sonnet',
    '',
    'name=Holly - Headhunter',
    'resume=no',
    'add_dir=~/Sites',
    'role = Headhunter ',
    'accent=5B7C99',
    'order=2',
    'colour=purple',
    'this line has no equals sign'
  ].join('\n'));
  assert.equal(conf.model, 'sonnet');
  assert.equal(conf.name, 'Holly - Headhunter');
  assert.equal(conf.shortName, 'Holly');
  assert.equal(conf.role, 'Headhunter');
  assert.equal(conf.resume, false);
  assert.equal(conf.addDir, '~/Sites');
  assert.equal(conf.accent, '#5b7c99');
  assert.equal(conf.order, 2);
  assert.equal(conf.cos, false);
  assert.deepEqual(conf.extra, { colour: 'purple' });
});

test('parseConf tolerates a missing name and derives the role from the name', () => {
  assert.equal(staff.parseConf('model=opus').name, '');
  assert.equal(staff.parseConf('model=opus').shortName, '');
  assert.equal(staff.parseConf('name=Walter - Biographer').role, 'Biographer');
  assert.equal(staff.parseConf('name=Walter - Biographer\nrole=Historian').role, 'Historian');
  assert.equal(staff.parseConf('name=Erich').shortName, 'Erich');
  assert.equal(staff.parseConf('name="Ivy - AI Community"').shortName, 'Ivy');
});

test('parseConf handles CRLF, yes/true for booleans, and bad values', () => {
  const conf = staff.parseConf('cos=YES\r\nresume=true\r\norder=abc\r\naccent=notacolour\r\n');
  assert.equal(conf.cos, true);
  assert.equal(conf.resume, true);
  assert.equal(conf.order, null);
  assert.equal(conf.accent, '');
});

test('discoverOffices finds only folders with aa.conf and orders them', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aar-staff-'));
  const make = (name, conf) => { fs.mkdirSync(path.join(dir, name)); if (conf !== null) fs.writeFileSync(path.join(dir, name, 'aa.conf'), conf); };
  make('Prospects', 'name=Holly - Headhunter');
  make('Marketing', 'name=Maya\norder=1');
  make('Eric - Chief of Staff', 'name=Eric Jr. - Chief of Staff\ncos=yes');
  make('Biography', 'name=Walter - Biographer\norder=3');
  make('INCOMING', null);
  make('.hidden', 'name=Ghost');
  fs.writeFileSync(path.join(dir, 'README.md'), 'not an office');
  const offices = staff.discoverOffices(dir);
  assert.deepEqual(offices.map((o) => o.id), ['Eric - Chief of Staff', 'Marketing', 'Biography', 'Prospects']);
  assert.equal(offices[0].name, 'Eric Jr.');
  const { cos, warnings } = staff.chiefOfStaff(offices);
  assert.equal(cos.id, 'Eric - Chief of Staff');
  assert.deepEqual(warnings, []);
});

test('discoverOffices returns nothing for a missing folder', () => {
  assert.deepEqual(staff.discoverOffices(path.join(os.tmpdir(), 'aar-does-not-exist-' + Date.now())), []);
});

test('chiefOfStaff warns on zero or two cos=yes and picks the first', () => {
  const two = staff.orderOffices([
    { id: 'B', name: 'B', conf: staff.parseConf('cos=yes') },
    { id: 'A', name: 'A', conf: staff.parseConf('cos=yes') }
  ]);
  const r = staff.chiefOfStaff(two);
  assert.equal(r.cos.id, 'A');
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /more than one/);
  const none = staff.chiefOfStaff([{ id: 'A', name: 'A', conf: staff.parseConf('') }]);
  assert.equal(none.cos, null);
  assert.match(none.warnings[0], /no office/);
  assert.deepEqual(staff.chiefOfStaff([]).warnings, []);
});
