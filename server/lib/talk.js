'use strict';
/* talk.js: talking to an assistant from the page. AAR starts and owns a
   Claude Code session per office through the Agent SDK, sends it what the
   user types, streams what comes back, and waits for the user when the
   assistant asks permission to use a tool. It never touches a session it did
   not start: terminal sessions are the user's.

   The SDK is injected (`sdk.query`) so the tests can script one. The only
   file this module writes is aar.sessions.json in the app folder: which
   session id belongs to which office, so a conversation resumes across AAR
   restarts. Nothing is written into an office. */

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const staff = require('./staff');
const platform = require('./platform');

/* A push-based async iterable: the SDK reads user messages from it. */
function createInputQueue() {
  const items = [];
  let waiting = null;
  let ended = false;
  return {
    push(item) {
      if (ended) return;
      if (waiting) { const w = waiting; waiting = null; w({ value: item, done: false }); }
      else items.push(item);
    },
    end() {
      ended = true;
      if (waiting) { const w = waiting; waiting = null; w({ value: undefined, done: true }); }
    },
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (items.length) return Promise.resolve({ value: items.shift(), done: false });
          if (ended) return Promise.resolve({ value: undefined, done: true });
          return new Promise((resolve) => { waiting = resolve; });
        },
        return: () => { ended = true; return Promise.resolve({ value: undefined, done: true }); }
      };
    }
  };
}

/* One line describing a tool call, for the permission prompt. */
function summariseInput(name, input) {
  if (!input || typeof input !== 'object') return '';
  const pick = input.command || input.file_path || input.path || input.pattern || input.query || input.url || input.prompt || input.description || '';
  const s = typeof pick === 'string' ? pick : JSON.stringify(pick);
  return s.length > 300 ? s.slice(0, 299) + '…' : s;
}

function sessionsPath(cfg) {
  return path.join(path.dirname(cfg.configPath || path.join(cfg.appRoot, 'aar.config.json')), 'aar.sessions.json');
}

function readRecords(cfg) {
  try { return JSON.parse(fs.readFileSync(sessionsPath(cfg), 'utf8')) || {}; } catch { return {}; }
}

function writeRecords(cfg, records) {
  fs.writeFileSync(sessionsPath(cfg), JSON.stringify(records, null, 2) + '\n');
}

class TalkError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/* `sdk` is { query } from the Agent SDK, or a fake. `loadSdk` is called on
   first use when `sdk` is not given, so the app still starts without the
   package installed. */
function createTalk({ cfg, sdk = null, loadSdk = null, now = () => new Date() }) {
  const events = new EventEmitter();
  const live = new Map();        /* office id -> state */
  let records = readRecords(cfg);
  const talkCfg = { enabled: true, permissionMode: 'default', ...(cfg.talk || {}) };

  async function getSdk() {
    if (sdk) return sdk;
    if (!loadSdk) throw new TalkError(503, 'the talk layer is not available');
    try { sdk = await loadSdk(); } catch (err) { throw new TalkError(503, `the Agent SDK is not installed (${err.message}); run npm install`); }
    return sdk;
  }

  function office(id) {
    const o = staff.discoverOffices(cfg.staffDir).find((x) => x.id === id);
    if (!o) throw new TalkError(404, 'no such office');
    return o;
  }

  function emit(type, payload) { events.emit('frame', { type, ...payload }); }

  function publicState(id) {
    const s = live.get(id);
    const rec = records[id] || null;
    return {
      office: id,
      available: talkCfg.enabled,
      running: !!s,
      phase: s ? s.phase : 'off',
      sessionId: s ? s.sessionId : (rec ? rec.sessionId : null),
      model: s ? s.model : (rec ? rec.model : null),
      startedAt: s ? s.startedAt : null,
      lastAt: s ? s.lastAt : (rec ? rec.lastAt : null),
      pending: s ? [...s.pending.values()].map((p) => ({ requestId: p.requestId, tool: p.tool, input: p.input, at: p.at })) : [],
      error: s ? s.error : null,
      record: rec
    };
  }

  function setPhase(s, phase) {
    s.phase = phase;
    s.lastAt = now().toISOString();
    emit('talk', { office: s.id, kind: 'phase', phase, sessionId: s.sessionId });
  }

  function remember(s) {
    records[s.id] = { sessionId: s.sessionId, model: s.model, startedAt: s.startedAt, lastAt: s.lastAt };
    writeRecords(cfg, records);
  }

  /* The assistant asked to use a tool: tell the page and wait for the answer. */
  function canUseToolFor(s) {
    return (toolName, input, opts) => new Promise((resolve) => {
      const requestId = crypto.randomUUID();
      const at = now().toISOString();
      s.pending.set(requestId, { requestId, tool: toolName, input: summariseInput(toolName, input), rawInput: input, at, resolve, suggestions: opts && opts.suggestions });
      setPhase(s, 'waiting');
      emit('permission', { office: s.id, requestId, tool: toolName, input: summariseInput(toolName, input), at });
      if (opts && opts.signal) opts.signal.addEventListener('abort', () => { if (s.pending.delete(requestId)) { resolve({ behavior: 'deny', message: 'cancelled' }); if (!s.pending.size && s.phase === 'waiting') setPhase(s, 'thinking'); } });
    });
  }

  async function consume(s, q) {
    try {
      for await (const m of q) {
        if (s.closed) break;
        if (m.session_id && !s.sessionId) { s.sessionId = m.session_id; remember(s); emit('talk', { office: s.id, kind: 'session', sessionId: s.sessionId }); }
        if (m.type === 'system' && m.subtype === 'init') {
          if (m.model) s.model = m.model;
          s.sessionId = m.session_id || s.sessionId;
          remember(s);
          emit('talk', { office: s.id, kind: 'init', sessionId: s.sessionId, model: s.model });
        } else if (m.type === 'stream_event') {
          const ev = m.event || {};
          if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta' && !m.parent_tool_use_id) emit('talk', { office: s.id, kind: 'delta', text: ev.delta.text });
        } else if (m.type === 'assistant' && !m.parent_tool_use_id) {
          const content = Array.isArray(m.message && m.message.content) ? m.message.content : [];
          const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
          const tools = content.filter((b) => b.type === 'tool_use').map((b) => ({ name: b.name, input: summariseInput(b.name, b.input) }));
          if (text || tools.length) emit('talk', { office: s.id, kind: 'message', text, tools, at: now().toISOString() });
        } else if (m.type === 'result') {
          s.lastAt = now().toISOString();
          if (m.is_error) { s.error = (m.errors && m.errors.join('; ')) || m.subtype || 'error'; emit('talk', { office: s.id, kind: 'error', message: s.error }); }
          else s.error = null;
          emit('talk', { office: s.id, kind: 'result', costUsd: m.total_cost_usd, turns: m.num_turns, isError: !!m.is_error });
          setPhase(s, 'idle');
          remember(s);
        }
      }
    } catch (err) {
      if (!s.closed) { s.error = err.message; emit('talk', { office: s.id, kind: 'error', message: err.message }); }
    } finally {
      const wasLive = live.get(s.id) === s;
      if (wasLive) live.delete(s.id);
      for (const p of s.pending.values()) p.resolve({ behavior: 'deny', message: 'the session ended' });
      s.pending.clear();
      if (wasLive) emit('talk', { office: s.id, kind: 'stopped', sessionId: s.sessionId, error: s.error });
    }
  }

  async function start(id, { fresh = false } = {}) {
    if (!talkCfg.enabled) throw new TalkError(403, 'talking from the page is turned off in aar.config.json');
    if (live.has(id)) return publicState(id);
    const o = office(id);
    const api = await getSdk();
    const rec = fresh ? null : records[id];
    const s = {
      id, folder: o.folder, name: o.name, model: o.conf.model || (rec && rec.model) || null,
      sessionId: rec ? rec.sessionId : null, phase: 'idle', startedAt: now().toISOString(), lastAt: now().toISOString(),
      pending: new Map(), input: createInputQueue(), abort: new AbortController(), error: null, closed: false, query: null
    };
    const options = {
      cwd: o.folder,
      model: o.conf.model || undefined,
      resume: rec ? rec.sessionId : undefined,
      settingSources: ['user', 'project', 'local'],
      permissionMode: talkCfg.permissionMode,
      canUseTool: canUseToolFor(s),
      includePartialMessages: true,
      abortController: s.abort,
      additionalDirectories: o.conf.addDir ? [o.conf.addDir] : undefined,
      pathToClaudeCodeExecutable: platform.sdkExecutable() || undefined
    };
    if (talkCfg.maxBudgetUsd) options.maxBudgetUsd = talkCfg.maxBudgetUsd;
    s.query = api.query({ prompt: s.input, options });
    live.set(id, s);
    if (s.sessionId) remember(s);
    emit('talk', { office: id, kind: 'started', sessionId: s.sessionId, resumed: !!rec });
    consume(s, s.query);
    return publicState(id);
  }

  async function say(id, text) {
    const t = String(text || '').trim();
    if (!t) throw new TalkError(400, 'nothing to say');
    if (!live.has(id)) await start(id);
    const s = live.get(id);
    if (s.phase !== 'idle') throw new TalkError(409, s.phase === 'waiting' ? `${s.name} is waiting for your answer to a permission request` : `${s.name} is still thinking`);
    s.input.push({ type: 'user', message: { role: 'user', content: t }, parent_tool_use_id: null });
    setPhase(s, 'thinking');
    emit('talk', { office: id, kind: 'sent', text: t, at: now().toISOString() });
    return publicState(id);
  }

  function answer(id, requestId, allow, updatedInput) {
    const s = live.get(id);
    if (!s) throw new TalkError(404, 'no running session');
    const p = s.pending.get(requestId);
    if (!p) throw new TalkError(404, 'no such permission request');
    s.pending.delete(requestId);
    p.resolve(allow
      ? { behavior: 'allow', updatedInput: updatedInput && typeof updatedInput === 'object' ? updatedInput : p.rawInput }
      : { behavior: 'deny', message: 'The user declined this from the AAR page.' });
    emit('permission', { office: id, requestId, answered: true, allow: !!allow });
    if (!s.pending.size) setPhase(s, 'thinking');
    return publicState(id);
  }

  async function stop(id) {
    const s = live.get(id);
    if (!s) return publicState(id);
    s.closed = true;
    live.delete(id);
    for (const p of s.pending.values()) p.resolve({ behavior: 'deny', message: 'the session was stopped' });
    s.pending.clear();
    s.input.end();
    try { if (s.query && s.query.interrupt && s.phase !== 'idle') await Promise.race([s.query.interrupt(), new Promise((r) => setTimeout(r, 1500))]); } catch { /* already gone */ }
    try { s.abort.abort(); } catch { /* fine */ }
    remember(s);
    emit('talk', { office: id, kind: 'stopped', sessionId: s.sessionId, error: null });
    return publicState(id);
  }

  async function stopAll() {
    await Promise.all([...live.keys()].map((id) => stop(id)));
  }

  /* Forget the recorded session so the next start is a new conversation. */
  function forget(id) {
    if (live.has(id)) throw new TalkError(409, 'stop the session first');
    delete records[id];
    writeRecords(cfg, records);
    return publicState(id);
  }

  return {
    events, start, say, answer, stop, stopAll, forget,
    status: publicState,
    enabled: talkCfg.enabled,
    /* For the store: AAR's own sessions in the shape sessions.js expects. */
    liveSessions() {
      return [...live.values()].map((s) => ({
        id: s.sessionId || `aar-${s.id}`, pid: null, kind: 'aar', status: s.phase === 'idle' ? 'idle' : 'busy',
        name: s.name, cwd: s.folder, startedAt: s.startedAt, busySince: s.phase === 'idle' ? null : s.lastAt, phase: s.phase
      }));
    }
  };
}

module.exports = { createTalk, createInputQueue, summariseInput, sessionsPath, TalkError };
