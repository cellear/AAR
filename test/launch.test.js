'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { launchCommand } = require('../server/lib/launch');

const office = (over = {}) => ({ id: 'Prospects', name: 'Holly', folder: '/Users/luke/aar-staff/Prospects', session: null, launch: { model: 'sonnet', name: 'Holly - Headhunter', resume: false, addDir: '' }, ...over });

test('start command mirrors aa-start', () => {
  assert.deepEqual(launchCommand(office()), { kind: 'start', command: 'cd "/Users/luke/aar-staff/Prospects" && claude --model sonnet --name "Holly - Headhunter"', note: null });
  const r = launchCommand(office({ launch: { model: 'opus', name: 'Maya', resume: true, addDir: '~/Sites' } }));
  assert.equal(r.command, 'cd "/Users/luke/aar-staff/Prospects" && claude --model opus --name "Maya" --add-dir "~/Sites" --continue');
  assert.equal(launchCommand(office({ launch: {} })).command, 'cd "/Users/luke/aar-staff/Prospects" && claude');
  assert.equal(launchCommand(office({ folder: '/x/It"s' })).command.slice(0, 13), 'cd "/x/It\\"s"');
});

test('a live session gives attach or a note', () => {
  assert.deepEqual(launchCommand(office({ session: { id: 'abc', kind: 'background' } })).command, 'claude attach abc');
  const r = launchCommand(office({ session: { id: 'abc', kind: 'interactive' } }));
  assert.equal(r.kind, 'open');
  assert.equal(r.command, null);
  assert.match(r.note, /terminal window/);
});
