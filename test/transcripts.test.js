'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tr = require('../server/lib/transcripts');
const platform = require('../server/lib/platform');

const L = (o) => JSON.stringify(o) + '\n';
const FIXTURE = [
  L({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-09-26T10:00:00Z' }),
  L({ type: 'user', timestamp: '2026-09-26T10:00:01Z', message: { role: 'user', content: 'Hello' } }),
  L({ type: 'assistant', timestamp: '2026-09-26T10:00:05Z', message: { model: 'claude-sonnet-5', content: [{ type: 'thinking', thinking: 'hm' }, { type: 'text', text: 'Reading the briefing now.' }] } }),
  L({ type: 'assistant', timestamp: '2026-09-26T10:00:06Z', message: { model: 'claude-sonnet-5', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] } }),
  L({ type: 'attachment', timestamp: '2026-09-26T10:00:07Z', attachment: { type: 'environment' } }),
  L({ type: 'assistant', timestamp: '2026-09-26T10:00:09Z', message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: 'Filed the receipts. Two remain.' }] } }),
  L({ type: 'system', subtype: 'away_summary', timestamp: '2026-09-26T10:05:00Z', content: 'I filed the receipts and drafted two follow-ups.' }),
  L({ type: 'custom-title', customTitle: 'Holly - Headhunter' }),
  L({ type: 'agent-name', agentName: 'Holly' }),
  L({ type: 'wibble', nonsense: true }),
  'this is not json\n',
  L({ type: 'system', subtype: 'stop_hook_summary', timestamp: '2026-09-26T10:06:00Z' })
].join('');

test('applyLine folds a dozen lines into a summary', () => {
  const s = tr.emptySummary();
  for (const line of FIXTURE.split('\n').filter(Boolean)) { try { tr.applyLine(s, JSON.parse(line)); } catch { /* skipped */ } }
  assert.equal(s.lastText, 'Filed the receipts. Two remain.');
  assert.equal(s.lastAt, '2026-09-26T10:00:09Z');
  assert.equal(s.model, 'claude-sonnet-5');
  assert.equal(s.awaySummary, 'I filed the receipts and drafted two follow-ups.');
  assert.equal(s.awayAt, '2026-09-26T10:05:00Z');
  assert.equal(s.title, 'Holly - Headhunter');
  assert.equal(s.agentName, 'Holly');
  assert.equal(s.apiError, false);
});

test('an API error message is detected, and a later good message clears it', () => {
  const s = tr.emptySummary();
  tr.applyLine(s, { type: 'assistant', timestamp: 't', message: { content: [{ type: 'text', text: 'API Error: 529 overloaded' }] } });
  assert.equal(s.apiError, true);
  tr.applyLine(s, { type: 'assistant', timestamp: 't', isApiErrorMessage: true, message: { content: 'Something went wrong' } });
  assert.equal(s.apiError, true);
  tr.applyLine(s, { type: 'assistant', timestamp: 't', message: { content: [{ type: 'text', text: 'Back to work.' }] } });
  assert.equal(s.apiError, false);
});

test('tailer reads only complete lines from the last offset, across appends, and resets on truncation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aar-tr-'));
  const file = path.join(dir, 'abc.jsonl');
  const lines = FIXTURE.split('\n').filter(Boolean);
  fs.writeFileSync(file, lines.slice(0, 3).join('\n') + '\n');
  const t = tr.createTailer(file);
  let s = t.read();
  assert.equal(s.lastText, 'Reading the briefing now.');
  const offsetAfterFirst = t.offset;

  /* A partial line is held back until its newline arrives. */
  const fifth = lines[5];
  fs.appendFileSync(file, lines[3] + '\n' + lines[4] + '\n' + fifth.slice(0, 20));
  s = t.read();
  assert.equal(s.lastText, 'Reading the briefing now.');
  assert.ok(t.offset > offsetAfterFirst);
  fs.appendFileSync(file, fifth.slice(20) + '\n' + lines.slice(6).join('\n') + '\n');
  s = t.read();
  assert.equal(s.lastText, 'Filed the receipts. Two remain.');
  assert.equal(s.awaySummary, 'I filed the receipts and drafted two follow-ups.');
  assert.equal(s.lines, 11);

  /* Nothing new: same summary, no reread. */
  assert.equal(t.read().lines, 11);

  /* Truncation: start over. */
  fs.writeFileSync(file, lines[2] + '\n');
  s = t.read();
  assert.equal(s.lines, 1);
  assert.equal(s.lastText, 'Reading the briefing now.');
  assert.equal(s.awaySummary, '');

  fs.unlinkSync(file);
  assert.equal(t.read(), null);
});

test('transcriptFileFor prefers the live session file, else the newest in the office bucket', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aar-proj-'));
  process.env.AAR_TRANSCRIPT_ROOT = root;
  try {
    const office = '/Users/luke/aar-staff/Prospects';
    const bucket = path.join(root, platform.bucketNameForCwd(office));
    fs.mkdirSync(bucket);
    assert.equal(bucket, path.join(root, '-Users-luke-aar-staff-Prospects'));
    fs.writeFileSync(path.join(bucket, 'old.jsonl'), '');
    const past = new Date(Date.now() - 60000);
    fs.utimesSync(path.join(bucket, 'old.jsonl'), past, past);
    fs.writeFileSync(path.join(bucket, 'new.jsonl'), '');
    fs.writeFileSync(path.join(bucket, 'notes.txt'), '');
    assert.equal(tr.transcriptFileFor(office, null), path.join(bucket, 'new.jsonl'));
    assert.equal(tr.transcriptFileFor(office, { id: 'old', cwd: office }), path.join(bucket, 'old.jsonl'));
    assert.equal(tr.transcriptFileFor(office, { id: 'missing', cwd: office }), path.join(bucket, 'new.jsonl'));
    assert.equal(tr.transcriptFileFor('/nowhere', null), null);
  } finally {
    delete process.env.AAR_TRANSCRIPT_ROOT;
  }
});
