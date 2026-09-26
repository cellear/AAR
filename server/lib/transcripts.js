'use strict';
/* transcripts.js: read Claude Code's own session transcripts. Each session is
   a JSONL file under ~/.claude/projects/<bucket>/<sessionId>.jsonl, where the
   bucket is the working directory with every non-alphanumeric character made
   a dash (platform.js knows the rule). AAR reads only complete lines from the
   last byte offset it saw; if the file shrinks it starts over. It keeps, per
   file, the last assistant text with its timestamp and model, the newest away
   summary, and any custom title or agent name. Unknown line types are skipped. */

const fs = require('fs');
const path = require('path');
const platform = require('./platform');

const MAX_TEXT = 4000;

function emptySummary() {
  return { lastText: '', lastAt: null, model: '', awaySummary: '', awayAt: null, title: '', agentName: '', apiError: false, lines: 0 };
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

/* Fold one parsed line into the summary. Exported for the tests. */
function applyLine(summary, line) {
  if (!line || typeof line !== 'object') return;
  summary.lines++;
  const stamp = typeof line.timestamp === 'string' ? line.timestamp : null;
  switch (line.type) {
    case 'assistant': {
      const msg = line.message || {};
      const text = textOf(msg.content).trim();
      if (msg.model) summary.model = String(msg.model);
      if (text) {
        summary.lastText = text.slice(0, MAX_TEXT);
        summary.lastAt = stamp;
        summary.apiError = line.isApiErrorMessage === true || /^\s*API Error/i.test(text);
      }
      break;
    }
    case 'system': {
      if (line.subtype === 'away_summary' || line.subtype === 'away-summary') {
        const text = String(line.content || line.summary || line.text || '').trim();
        if (text) { summary.awaySummary = text.slice(0, MAX_TEXT); summary.awayAt = stamp; }
      }
      break;
    }
    case 'custom-title':
      summary.title = String(line.customTitle || line.title || line.content || '').trim();
      break;
    case 'agent-name':
      summary.agentName = String(line.agentName || line.name || line.content || '').trim();
      break;
    default:
      break;
  }
}

/* A tailer for one file. `read()` consumes whatever complete lines have been
   appended since the last call and returns the summary. */
function createTailer(file) {
  let offset = 0;
  let partial = '';
  let summary = emptySummary();

  function read() {
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    if (st.size < offset) { offset = 0; partial = ''; summary = emptySummary(); }
    if (st.size === offset) return summary;
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(st.size - offset);
      const n = fs.readSync(fd, buf, 0, buf.length, offset);
      offset += n;
      partial += buf.toString('utf8', 0, n);
    } finally {
      fs.closeSync(fd);
    }
    const lines = partial.split('\n');
    partial = lines.pop();
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) continue;
      let parsed;
      try { parsed = JSON.parse(line); } catch { continue; }
      applyLine(summary, parsed);
    }
    return summary;
  }

  return { file, read, get offset() { return offset; } };
}

/* The transcript for an office: the live session's file when one is running,
   else the newest .jsonl in the office's bucket. Null when there is none. */
function transcriptFileFor(officeFolder, session) {
  if (session && session.id && session.cwd) {
    const candidate = path.join(platform.transcriptDirForCwd(session.cwd), `${session.id}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  const dir = platform.transcriptDirForCwd(officeFolder);
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return null; }
  let best = null;
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const file = path.join(dir, name);
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    if (!best || st.mtimeMs > best.mtimeMs) best = { file, mtimeMs: st.mtimeMs };
  }
  return best ? best.file : null;
}

/* A cache of tailers keyed by file, so each poll reads only what is new. */
function createReader() {
  const tailers = new Map();
  function summarise(officeFolder, session) {
    const file = transcriptFileFor(officeFolder, session);
    if (!file) return null;
    if (!tailers.has(file)) tailers.set(file, createTailer(file));
    const summary = tailers.get(file).read();
    return summary ? { ...summary, file } : null;
  }
  return { summarise, tailers };
}

module.exports = { emptySummary, textOf, applyLine, createTailer, transcriptFileFor, createReader };
