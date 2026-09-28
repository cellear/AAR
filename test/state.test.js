'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const state = require('../server/lib/state');

const NOW = new Date('2026-09-26T12:00:00Z');
const office = (over = {}) => ({
  id: 'Prospects', folder: '/staff/Prospects', name: 'Holly',
  conf: { model: 'sonnet', name: 'Holly - Headhunter', shortName: 'Holly', role: 'Headhunter', avatar: '', accent: '#123456', order: null, cos: false, resume: false, addDir: '', ...over }
});
const files = (over = {}) => ({
  readme: '# Prospects', briefing: '## Key facts\n- x', log: '## 2026-09-20\n- y', status: null,
  mtimes: { readme: null, briefing: null, log: '2026-09-20T10:00:00Z', status: null },
  images: { avatar: false, office: false }, people: [], files: ['people.md'], mornings: [], ...over
});
const snap = (o = {}) => state.buildOfficeSnapshot({ office: office(), files: files(), now: NOW, stuckMs: 15 * 60000, ...o });

test('bubble source order: status Now, away summary, last text, nothing', () => {
  const t = { awaySummary: 'I filed the receipts. Then I rested.', lastText: 'Done with the receipts! Anything else?', lastAt: null };
  assert.deepEqual(snap({ files: files({ status: 'Now: Chasing Acme\nNeed from you:\nNext: rest' }), transcript: t }).bubble, { text: 'Chasing Acme', source: 'status' });
  assert.deepEqual(snap({ files: files({ status: 'Now:\nNeed from you:\nNext:' }), transcript: t }).bubble, { text: 'I filed the receipts.', source: 'away' });
  assert.deepEqual(snap({ transcript: { lastText: t.lastText } }).bubble, { text: 'Done with the receipts!', source: 'transcript' });
  assert.deepEqual(snap().bubble, { text: 'Nothing yet.', source: 'none' });
});

test('oneSentence truncates long run-ons', () => {
  const long = 'word '.repeat(60).trim();
  const out = state.oneSentence(long);
  assert.ok(out.length <= 160 && out.endsWith('…'));
  assert.equal(state.oneSentence('  Two   spaces. Second.  '), 'Two spaces.');
});

test('liveness from session status', () => {
  assert.equal(snap().liveness, 'none');
  assert.equal(snap({ session: { id: 's1', status: 'busy' } }).liveness, 'busy');
  assert.equal(snap({ session: { id: 's1', status: 'idle' } }).liveness, 'idle');
});

test('lastHeard is the newest of status mtime, last message, log mtime', () => {
  assert.equal(snap().lastHeard, '2026-09-20T10:00:00.000Z');
  assert.equal(snap({ files: files({ mtimes: { status: '2026-09-25T00:00:00Z', log: '2026-09-20T10:00:00Z' } }) }).lastHeard, '2026-09-25T00:00:00.000Z');
  assert.equal(snap({ transcript: { lastAt: '2026-09-26T11:00:00Z' } }).lastHeard, '2026-09-26T11:00:00.000Z');
  assert.equal(snap({ files: files({ mtimes: {} }) }).lastHeard, null);
});

test('badges: needsYou, unpushed, behind, stuck by API error and by busy too long', () => {
  assert.deepEqual(snap().badges, []);
  assert.deepEqual(snap({ files: files({ status: 'Now: a\nNeed from you: sign this\nNext: b' }) }).badges, ['needsYou']);
  assert.deepEqual(snap({ files: files({ status: 'Now: a\nNeed from you:   \nNext: b' }) }).badges, []);
  assert.deepEqual(snap({ git: { ahead: 2, behind: 0, dirty: false } }).badges, ['unpushed']);
  assert.deepEqual(snap({ git: { ahead: 0, behind: 1, dirty: false } }).badges, ['behind']);
  assert.deepEqual(snap({ git: { ahead: 1, behind: 1, dirty: true } }).badges, ['unpushed', 'behind']);
  assert.deepEqual(snap({ transcript: { lastText: 'API Error: 529 overloaded' } }).badges, ['stuck']);
  assert.deepEqual(snap({ session: { status: 'busy', busySince: '2026-09-26T11:40:00Z' } }).badges, ['stuck']);
  assert.deepEqual(snap({ session: { status: 'busy', busySince: '2026-09-26T11:50:00Z' } }).badges, []);
  assert.deepEqual(snap({ session: { status: 'busy', startedAt: '2026-09-26T11:00:00Z' } }).badges, ['stuck']);
  assert.deepEqual(snap({ session: { status: 'idle', startedAt: '2026-09-26T09:00:00Z' } }).badges, []);
});

test('snapshot carries identity, avatar choice, briefing sections and log', () => {
  const s = snap();
  assert.equal(s.id, 'Prospects');
  assert.equal(s.name, 'Holly');
  assert.equal(s.role, 'Headhunter');
  assert.equal(s.model, 'sonnet');
  assert.equal(s.accent, '#123456');
  assert.deepEqual(s.avatar, { source: 'none', url: null, face: null });
  assert.equal(s.briefing.sections[0].kind, 'keyFacts');
  assert.equal(s.log[0].date, '2026-09-20');
  assert.deepEqual(s.files, ['people.md']);
  assert.equal(s.status, null);
  assert.deepEqual(snap({ office: office({ avatar: 'cast-04.png' }) }).avatar, { source: 'cast', url: '/avatars/cast/cast-04.png', face: null });
  assert.deepEqual(snap({ office: office({ avatar: 'lila.png' }) }).avatar, { source: 'cast', url: '/avatars/cast/cast-04.png', face: null }, 'an old name resolves through the alias map');
  assert.deepEqual(snap({ office: office({ avatar: 'cast-11.png' }), files: files({ castFaces: new Set(['cast-11-face.png']) }) }).avatar, { source: 'cast', url: '/avatars/cast/cast-11.png', face: '/avatars/cast/cast-11-face.png' }, 'a face twin is offered');
  assert.deepEqual(snap({ files: files({ images: { avatar: true, office: true } }) }).avatar, { source: 'office', url: '/avatars/Prospects/avatar.png', face: null });
  assert.equal(snap({ files: files({ images: { avatar: true, face: true, office: false } }) }).avatar.face, '/avatars/Prospects/face.png');
  assert.equal(snap({ files: files({ images: { avatar: false, office: true } }) }).officeImage, '/avatars/Prospects/office.png');
  assert.equal(snap({ files: files({ briefing: null, log: null }) }).briefing, null);
  assert.equal(snap({ files: files({ briefing: null, log: null }) }).log, null);
});

test('rollup merges needs, deadlines and open items across offices', () => {
  const a = snap({ files: files({ status: 'Now: a\nNeed from you: sign\nNext: b', briefing: '## Upcoming deadlines\n- Talk 2026-10-02\n- Someday\n- Past 2026-09-01\n## Open items\n- [ ] one\n- [x] two' }) });
  const b = state.buildOfficeSnapshot({ office: { ...office(), id: 'Marketing', name: 'Maya' }, files: files({ briefing: '## Upcoming deadlines\n- Post 2026-09-28\n- Far 2026-12-01\n## Open items\n- [x] done' }), now: NOW });
  const cos = { id: 'Chief', folder: '/staff/Chief', mornings: ['2026-09-26.md', '2026-09-25.md'] };
  const r = state.buildRollup({ snapshots: [a, b], cos, now: NOW });
  assert.deepEqual(r.needs, [{ office: 'Prospects', name: 'Holly', text: 'sign' }]);
  assert.deepEqual(r.deadlines.map((d) => d.text), ['Past 2026-09-01', 'Post 2026-09-28', 'Talk 2026-10-02', 'Far 2026-12-01', 'Someday']);
  assert.deepEqual(r.openItems, [{ office: 'Prospects', name: 'Holly', items: ['one'] }]);
  assert.equal(r.staff.length, 2);
  assert.equal(r.morningSheet.file, '2026-09-26.md');
  assert.equal(state.buildRollup({ snapshots: [], cos: { mornings: [] }, now: NOW }).morningSheet, null);
});
