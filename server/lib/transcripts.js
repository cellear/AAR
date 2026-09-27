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

/* ---------- the whole conversation ----------

   For the office's Conversation card: every user prompt and assistant reply
   in order, with tool calls folded under the reply that made them and tool
   results attached to their calls. Kept per file as a tailer, so a poll
   reads only what was appended. */

const MAX_RESULT = 20000;

function stripNoise(text) {
  return String(text || '')
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
    .replace(/<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/g, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g, '')
    .trim();
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((b) => (b && b.type === 'text' ? b.text : b && b.type === 'image' ? '[image]' : '')).filter(Boolean).join('\n');
}

function foldLine(conv, line) {
  if (!line || typeof line !== 'object') return;
  if (line.isMeta || line.isSidechain) return;
  const at = typeof line.timestamp === 'string' ? line.timestamp : null;
  const msg = line.message || {};
  if (line.type === 'user') {
    const content = msg.content;
    if (Array.isArray(content)) {
      const results = content.filter((b) => b && b.type === 'tool_result');
      for (const r of results) {
        const call = conv.calls.get(r.tool_use_id);
        if (call) { call.result = resultText(r.content).slice(0, MAX_RESULT); call.isError = r.is_error === true; }
      }
      const text = stripNoise(content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n'));
      if (text) conv.messages.push({ i: conv.messages.length, role: 'user', at, text, tools: [] });
    } else {
      const text = stripNoise(content);
      if (text) conv.messages.push({ i: conv.messages.length, role: 'user', at, text, tools: [] });
    }
    return;
  }
  if (line.type === 'assistant') {
    const content = Array.isArray(msg.content) ? msg.content : (typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : []);
    const text = content.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n').trim();
    const tools = content.filter((b) => b && b.type === 'tool_use').map((b) => {
      const call = { id: b.id, name: b.name || 'tool', input: summariseInput(b.name, b.input), result: null, isError: false };
      conv.calls.set(b.id, call);
      return call;
    });
    if (!text && !tools.length) return;
    /* Consecutive assistant lines in one turn (text, then tool calls) merge. */
    const last = conv.messages[conv.messages.length - 1];
    if (last && last.role === 'assistant' && last.requestId && last.requestId === line.requestId) {
      if (text) last.text = last.text ? last.text + '\n\n' + text : text;
      last.tools.push(...tools);
      return;
    }
    conv.messages.push({ i: conv.messages.length, role: 'assistant', at, text, tools, model: msg.model || '', requestId: line.requestId || null, apiError: line.isApiErrorMessage === true || /^\s*API Error/i.test(text) });
  }
}

/* One line describing a tool call: the command, the file, the pattern. */
function summariseInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick = input.command || input.file_path || input.path || input.pattern || input.query || input.url || input.prompt || input.description || '';
  const s = typeof pick === 'string' ? pick : JSON.stringify(pick);
  return s.length > 300 ? s.slice(0, 299) + '…' : s;
}

function createConversation(file) {
  let offset = 0;
  let partial = '';
  const conv = { messages: [], calls: new Map() };

  function read() {
    let st;
    try { st = fs.statSync(file); } catch { return null; }
    if (st.size < offset) { offset = 0; partial = ''; conv.messages = []; conv.calls = new Map(); }
    if (st.size > offset) {
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
        foldLine(conv, parsed);
      }
    }
    return conv.messages;
  }

  return { file, read };
}

/* The transcripts an office has on this Mac: every .jsonl in its bucket,
   newest first, plus the live session's file if it lives elsewhere. */
function sessionsFor(officeFolder, session) {
  const dir = platform.transcriptDirForCwd(officeFolder);
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { /* no bucket */ }
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue;
    const file = path.join(dir, name);
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    out.push({ id: name.replace(/\.jsonl$/, ''), file, mtime: new Date(st.mtimeMs).toISOString(), size: st.size, live: !!(session && session.id === name.replace(/\.jsonl$/, '')) });
  }
  if (session && session.id && session.cwd && !out.some((s) => s.id === session.id)) {
    const file = path.join(platform.transcriptDirForCwd(session.cwd), `${session.id}.jsonl`);
    if (fs.existsSync(file)) {
      const st = fs.statSync(file);
      out.push({ id: session.id, file, mtime: new Date(st.mtimeMs).toISOString(), size: st.size, live: true });
    }
  }
  out.sort((a, b) => (b.live - a.live) || (a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0));
  return out;
}

const conversations = new Map();
function conversationFor(file) {
  if (!conversations.has(file)) conversations.set(file, createConversation(file));
  return conversations.get(file).read();
}

module.exports.stripNoise = stripNoise;
module.exports.foldLine = foldLine;
module.exports.createConversation = createConversation;
module.exports.sessionsFor = sessionsFor;
module.exports.conversationFor = conversationFor;
