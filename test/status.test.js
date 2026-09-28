'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseStatus } = require('../server/lib/status');

test('happy path', () => {
  assert.deepEqual(parseStatus('Now: Drafting the sheet\nNeed from you: Approve the plan\nNext: File the receipts\n'),
    { now: 'Drafting the sheet', need: 'Approve the plan', next: 'File the receipts' });
});

test('missing file is null', () => {
  assert.equal(parseStatus(null), null);
  assert.equal(parseStatus(undefined), null);
});

test('a file with no labels is null; an empty labelled file is all empty strings', () => {
  assert.equal(parseStatus('just some prose\n'), null);
  assert.equal(parseStatus(''), null);
  assert.deepEqual(parseStatus('Now:\nNeed from you:\nNext:\n'), { now: '', need: '', next: '' });
});

test('missing line, extra lines, wrong order, CRLF', () => {
  assert.deepEqual(parseStatus('Now: working\nNext: resting'), { now: 'working', need: '', next: 'resting' });
  assert.deepEqual(parseStatus('# Status\nNow: working\nNeed from you: nothing much\nNext: resting\nNotes: ignored\n'),
    { now: 'working', need: 'nothing much', next: 'resting' });
  assert.deepEqual(parseStatus('Next: c\nNow: a\nNeed from you: b'), { now: 'a', need: 'b', next: 'c' });
  assert.deepEqual(parseStatus('Now: a\r\nNeed from you: b\r\nNext: c\r\n'), { now: 'a', need: 'b', next: 'c' });
});

test('whitespace-only Need from you counts as empty; first occurrence wins', () => {
  assert.equal(parseStatus('Now: a\nNeed from you:    \nNext: c').need, '');
  assert.equal(parseStatus('Now: first\nNow: second').now, 'first');
  assert.equal(parseStatus('now: lower case label').now, 'lower case label');
});
