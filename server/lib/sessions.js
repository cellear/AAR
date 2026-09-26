'use strict';
/* sessions.js: the live roster. Runs `claude agents --json`, which lists every
   interactive and background Claude Code session on this Mac as
   { pid, cwd, kind, startedAt, sessionId, name, status }, and attributes each
   one to an office: by working directory first, then by matching the
   session's name against the assistant's name. Sessions in the staff folder
   that match nothing are the front desk. Sessions elsewhere with no match are
   not the staff's business and are dropped. */

const path = require('path');
const { execFile } = require('child_process');
const platform = require('./platform');

const TIMEOUT_MS = 4000;

/* Normalise one entry of the agents list into AAR's session shape. */
function normalise(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.sessionId || raw.id || raw.session_id;
  if (!id) return null;
  const started = raw.startedAt || raw.started_at || null;
  return {
    id: String(id),
    pid: raw.pid || null,
    kind: raw.kind || 'interactive',
    status: raw.status === 'busy' ? 'busy' : 'idle',
    name: raw.name ? String(raw.name) : '',
    cwd: raw.cwd ? path.resolve(String(raw.cwd)) : '',
    startedAt: started ? new Date(typeof started === 'number' ? started : Date.parse(started)).toISOString() : null
  };
}

function parseAgents(text) {
  let data;
  try { data = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(data)) return null;
  return data.map(normalise).filter(Boolean);
}

/* Run the CLI. Resolves to null when the binary is missing or answers badly,
   so a Mac without `claude` on the PATH degrades to "no sessions" rather than
   an error on every poll. */
function listSessions() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      execFile(platform.claudeBinary(), ['agents', '--json'], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        if (err) return finish(null);
        finish(parseAgents(stdout));
      });
    } catch {
      finish(null);
    }
  });
}

function norm(s) {
  return String(s || '').trim().toLowerCase();
}

function isInside(child, parent) {
  return child === parent || child.startsWith(parent + path.sep);
}

/* Attribute sessions to offices. `offices` is the staff list from staff.js.
   Returns sessions per office id, newest first, and the front desk. */
function attribute(sessions, offices, staffDir) {
  const byOffice = {};
  for (const o of offices) byOffice[o.id] = [];
  const frontDesk = [];
  const root = path.resolve(staffDir);
  for (const s of sessions || []) {
    let match = null;
    if (s.cwd) match = offices.find((o) => isInside(s.cwd, path.resolve(o.folder))) || null;
    if (!match && s.name) {
      const n = norm(s.name);
      match = offices.find((o) => n === norm(o.conf.name) || n === norm(o.conf.shortName) || n === norm(o.name)) || null;
    }
    if (match) byOffice[match.id].push(s);
    else if (s.cwd && isInside(s.cwd, root)) frontDesk.push(s);
  }
  const newestFirst = (a, b) => (Date.parse(b.startedAt || 0) || 0) - (Date.parse(a.startedAt || 0) || 0);
  for (const id of Object.keys(byOffice)) byOffice[id].sort(newestFirst);
  frontDesk.sort(newestFirst);
  return { byOffice, frontDesk };
}

module.exports = { normalise, parseAgents, listSessions, attribute };
