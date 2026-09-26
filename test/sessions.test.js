'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const sessions = require('../server/lib/sessions');
const staff = require('../server/lib/staff');

const STAFF = '/Users/luke/aar-staff';
const offices = [
  { id: 'Prospects', folder: `${STAFF}/Prospects`, name: 'Holly', conf: staff.parseConf('name=Holly - Headhunter') },
  { id: 'Marketing', folder: `${STAFF}/Marketing`, name: 'Maya', conf: staff.parseConf('name=Maya') }
];

test('parseAgents normalises the CLI output and rejects bad input', () => {
  const list = sessions.parseAgents(JSON.stringify([
    { pid: 102, cwd: `${STAFF}/Prospects`, kind: 'interactive', startedAt: 1790463097602, sessionId: 'abc', name: 'Holly - Headhunter', status: 'busy' },
    { sessionId: 'def', status: 'weird' },
    { nothing: true }
  ]));
  assert.equal(list.length, 2);
  assert.equal(list[0].id, 'abc');
  assert.equal(list[0].status, 'busy');
  assert.equal(list[0].startedAt, new Date(1790463097602).toISOString());
  assert.equal(list[1].status, 'idle');
  assert.equal(list[1].startedAt, null);
  assert.equal(sessions.parseAgents('not json'), null);
  assert.equal(sessions.parseAgents('{"a":1}'), null);
});

test('attribute: cwd match, name match on a root session, front desk, newest first', () => {
  const list = [
    { id: 's1', cwd: `${STAFF}/Prospects`, name: 'anything', status: 'idle', startedAt: '2026-09-26T09:00:00Z' },
    { id: 's2', cwd: `${STAFF}/Prospects/sub`, name: '', status: 'busy', startedAt: '2026-09-26T10:00:00Z' },
    { id: 's3', cwd: STAFF, name: 'Maya', status: 'idle', startedAt: '2026-09-26T08:00:00Z' },
    { id: 's4', cwd: STAFF, name: 'aar-17', status: 'busy', startedAt: '2026-09-26T07:00:00Z' },
    { id: 's5', cwd: `${STAFF}/Unknown`, name: '', status: 'idle', startedAt: '2026-09-26T11:00:00Z' },
    { id: 's6', cwd: '/Users/luke/Sites', name: 'holly - headhunter', status: 'idle', startedAt: null },
    { id: 's7', cwd: '/Users/luke/Sites', name: 'unrelated', status: 'idle', startedAt: null },
    { id: 's8', cwd: '/Users/luke/aar-staff-other', name: '', status: 'idle', startedAt: null }
  ];
  const { byOffice, frontDesk } = sessions.attribute(list, offices, STAFF);
  assert.deepEqual(byOffice.Prospects.map((s) => s.id), ['s2', 's1', 's6']);
  assert.deepEqual(byOffice.Marketing.map((s) => s.id), ['s3']);
  assert.deepEqual(frontDesk.map((s) => s.id), ['s5', 's4']);
});

test('attribute with no sessions or no offices', () => {
  assert.deepEqual(sessions.attribute([], offices, STAFF).frontDesk, []);
  assert.deepEqual(sessions.attribute(null, [], STAFF), { byOffice: {}, frontDesk: [] });
});
