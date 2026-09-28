'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const md = require('../server/lib/markdown');

const NOW = new Date('2026-09-26T12:00:00Z');

test('splitSections splits on ## only and keeps a preamble', () => {
  const sections = md.splitSections('# Title\nintro\n\n## Key facts\n- a\n### sub\n- b\n\n## People\n\n```\n## not a heading\n```\n## Open items ##\n- [ ] x');
  assert.deepEqual(sections.map((s) => s.heading), [null, 'Key facts', 'People', 'Open items']);
  assert.equal(sections[0].body, '# Title\nintro');
  assert.equal(sections[1].body, '- a\n### sub\n- b');
  assert.equal(sections[2].body, '```\n## not a heading\n```');
  assert.deepEqual(md.splitSections('').length, 0);
});

test('sectionKind recognises the canonical headings', () => {
  assert.equal(md.sectionKind('Key facts'), 'keyFacts');
  assert.equal(md.sectionKind('People'), 'people');
  assert.equal(md.sectionKind('Upcoming deadlines'), 'deadlines');
  assert.equal(md.sectionKind('Deadlines'), 'deadlines');
  assert.equal(md.sectionKind('Open items'), 'openItems');
  assert.equal(md.sectionKind('Finances'), 'plain');
});

test('findDate reads ISO, month/day and month-name forms', () => {
  assert.equal(md.findDate('Talk due 2026-09-27 at noon', NOW), '2026-09-27');
  assert.equal(md.findDate('Mon 9/27 standup', NOW), '2026-09-27');
  assert.equal(md.findDate('Sept 28 deadline', NOW), '2026-09-28');
  assert.equal(md.findDate('Sep. 28', NOW), '2026-09-28');
  assert.equal(md.findDate('28 September', NOW), '2026-09-28');
  assert.equal(md.findDate('October 3rd, 2027', NOW), '2027-10-03');
  assert.equal(md.findDate('due 1/15/27', NOW), '2027-01-15');
  assert.equal(md.findDate('no date here', NOW), null);
  assert.equal(md.findDate('13/40', NOW), null);
});

test('findDate infers next year for a month/day well behind today', () => {
  assert.equal(md.findDate('Jan 5', NOW), '2027-01-05');
  assert.equal(md.findDate('Aug 30', NOW), '2026-08-30');
  assert.equal(md.findDate('3/1', new Date('2026-12-20T00:00:00Z')), '2027-03-01');
});

test('checkboxItems reads checked, unchecked and plain bullets', () => {
  assert.deepEqual(md.checkboxItems('- [ ] one\n- [x] two\n- [X] three\n- four\n  continued\n* [ ] five'), [
    { text: 'one', checked: false }, { text: 'two', checked: true }, { text: 'three', checked: true },
    { text: 'four continued', checked: null }, { text: 'five', checked: false }
  ]);
});

test('deadlineItems sorts dated first, then undated in file order', () => {
  const items = md.deadlineItems('- Later 2026-10-05\n- No date\n- Soon 2026-09-28\n- Also no date', NOW);
  assert.deepEqual(items.map((i) => i.text), ['Soon 2026-09-28', 'Later 2026-10-05', 'No date', 'Also no date']);
  assert.equal(items[0].date, '2026-09-28');
  assert.equal(items[2].date, null);
});

test('logEntries groups by date, newest first, in both heading and bold styles', () => {
  const log = [
    '# Log', '', '_notes_', '',
    '## 2026-09-20 First day', '- hired', '',
    '**2026-09-21** second', '- more', '',
    '## 2026-09-21', 'third', '',
    '- **2026-09-22** — bullet style', ''
  ].join('\n');
  const groups = md.logEntries(log);
  assert.deepEqual(groups.map((g) => g.date), ['2026-09-22', '2026-09-21', '2026-09-20']);
  assert.deepEqual(groups[1].entries.map((e) => e.title), ['', 'second']);
  assert.equal(groups[1].entries[0].body, 'third');
  assert.equal(groups[2].entries[0].title, 'First day');
  assert.equal(groups[2].entries[0].body, '- hired');
  assert.equal(groups[0].entries[0].title, 'bullet style');
});

test('logEntries keeps an unstructured log as one undated entry', () => {
  const groups = md.logEntries('just prose\nmore prose');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].date, null);
  assert.deepEqual(md.logEntries(''), []);
});

test('imageLinks finds markdown images', () => {
  assert.deepEqual(md.imageLinks('- Ada ![Ada](people/ada.jpg) and ![](people/bob.png "Bob")'), [
    { alt: 'Ada', src: 'people/ada.jpg' }, { alt: '', src: 'people/bob.png' }
  ]);
});
