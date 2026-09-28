'use strict';
/* store.js: the server's one copy of the truth. It owns the timers: poll the
   live sessions every pollMs, refresh git status on changes and on a timer,
   fetch every gitFetchMs, and rebuild snapshots when the watcher fires. Each
   rebuild diffs every office against the last one it sent and broadcasts
   only what changed. A reader failure keeps the last good state and marks it
   stale, so the page can say so instead of going blank. */

const staff = require('./staff');
const office = require('./office');
const state = require('./state');
const sessions = require('./sessions');
const transcripts = require('./transcripts');
const git = require('./git');
const { createWatcher } = require('./watch');
const { createHub } = require('./sse');
const { dirExists, castFaceSet } = require('./reader');

/* `sources` lets tests replace the CLI and git with fixtures. */
function createStore(cfg, { live = true, now = () => new Date(), sources = {} } = {}) {
  const listSessions = sources.listSessions || sessions.listSessions;
  const gitStatus = sources.gitStatus || git.status;
  const gitFetch = sources.gitFetch || git.fetch;
  const hub = createHub();
  const reader = transcripts.createReader();
  let current = null;        /* the last full snapshot set */
  let sent = new Map();      /* office id -> JSON of the last frame sent */
  let liveSessions = [];     /* raw sessions from the last poll */
  let gitState = null;
  let stale = null;          /* reason string when the last rebuild failed */
  let watcher = null;
  let timers = [];
  let rebuilding = false;
  let queued = false;

  function build() {
    const at = now();
    const castFaces = castFaceSet(cfg.appRoot);
    const offices = staff.discoverOffices(cfg.staffDir);
    const { cos, warnings } = staff.chiefOfStaff(offices);
    const { byOffice, frontDesk } = sessions.attribute(liveSessions, offices, cfg.staffDir);
    const snapshots = [];
    const errors = [];
    for (const o of offices) {
      try {
        const files = office.readOffice(o.folder, { cos: cos !== null && cos.id === o.id });
        files.castFaces = castFaces;
        const list = byOffice[o.id] || [];
        const transcript = live ? reader.summarise(o.folder, list[0] || null) : null;
        snapshots.push(state.buildOfficeSnapshot({
          office: o, files, session: list[0] || null, sessions: list.slice(1), transcript, git: gitState, now: at, stuckMs: cfg.stuckMs
        }));
      } catch (err) {
        errors.push(`${o.id}: ${err.message}`);
      }
    }
    return {
      staff: {
        brand: cfg.brand, staffDir: cfg.staffDir, exists: dirExists(cfg.staffDir), count: snapshots.length,
        needsYou: snapshots.filter((s) => s.badges.includes('needsYou')).length,
        cos: cos ? cos.id : null, warnings, readOnly: true, settingsExist: cfg.settingsExist !== false
      },
      offices: snapshots,
      cos: cos ? snapshots.find((s) => s.id === cos.id) || null : null,
      frontDesk,
      git: gitState,
      polledAt: at.toISOString(),
      errors
    };
  }

  /* Rebuild and broadcast what changed. `full` forces an init frame to every
     client, used after a reader failure clears. */
  function rebuild({ full = false } = {}) {
    if (rebuilding) { queued = true; return current; }
    rebuilding = true;
    try {
      const next = build();
      const wasStale = stale !== null;
      stale = null;
      const prevIds = new Set(sent.keys());
      const nextSent = new Map();
      const changedOffices = [];
      for (const o of next.offices) {
        const json = JSON.stringify(o);
        nextSent.set(o.id, json);
        if (sent.get(o.id) !== json) changedOffices.push(o);
        prevIds.delete(o.id);
      }
      const rosterChanged = prevIds.size > 0 || (current && next.offices.length !== current.offices.length) || (current && next.staff.cos !== current.staff.cos);
      const frontDeskChanged = !current || JSON.stringify(next.frontDesk) !== JSON.stringify(current.frontDesk);
      const gitChanged = !current || JSON.stringify(next.git) !== JSON.stringify(current.git);
      const staffChanged = !current || JSON.stringify(next.staff) !== JSON.stringify(current.staff);
      current = next;
      sent = nextSent;
      if (full || wasStale || rosterChanged) {
        hub.broadcast({ type: 'init', ...initFrame() });
      } else {
        for (const o of changedOffices) hub.broadcast({ type: 'office', office: o, polledAt: next.polledAt });
        if (frontDeskChanged) hub.broadcast({ type: 'frontDesk', sessions: next.frontDesk, polledAt: next.polledAt });
        if (gitChanged) hub.broadcast({ type: 'git', git: next.git, polledAt: next.polledAt });
        if (staffChanged) hub.broadcast({ type: 'staff', staff: next.staff, polledAt: next.polledAt });
        else hub.broadcast({ type: 'polled', polledAt: next.polledAt });
      }
    } catch (err) {
      stale = err.message;
      hub.broadcast({ type: 'stale', reason: err.message, at: now().toISOString() });
    } finally {
      rebuilding = false;
      if (queued) { queued = false; setImmediate(() => rebuild()); }
    }
    return current;
  }

  function initFrame() {
    const c = current || build();
    return { staff: c.staff, offices: c.offices, frontDesk: c.frontDesk, git: c.git, polledAt: c.polledAt, errors: c.errors, stale };
  }

  async function pollSessions() {
    const list = await listSessions();
    liveSessions = list || [];
    rebuild();
  }

  async function refreshGit() {
    gitState = await gitStatus(cfg.staffDir);
    rebuild();
  }

  async function fetchGit() {
    if (!gitState || !gitState.repo || !gitState.upstream) return;
    await gitFetch(cfg.staffDir);
    await refreshGit();
  }

  function start() {
    if (!live) { rebuild(); return; }
    rebuild();
    refreshGit();
    pollSessions();
    watcher = createWatcher(cfg.staffDir, () => { rebuild(); refreshGit(); });
    /* One timer: poll the sessions and rebuild. The rebuild doubles as the
       file-change backstop for when fs.watch goes quiet. */
    timers.push(setInterval(() => { if (watcher && !watcher.armed) watcher.rearm(); pollSessions(); }, Math.max(1000, cfg.pollMs)));
    if (cfg.gitFetchMs > 0) timers.push(setInterval(fetchGit, Math.max(30000, cfg.gitFetchMs)));
    for (const t of timers) if (t.unref) t.unref();
  }

  /* The staff folder changed: watch the new one and send everyone a fresh init. */
  function repoint() {
    if (watcher) { watcher.stop(); watcher = null; }
    gitState = null;
    sent = new Map();
    current = null;
    if (live) {
      watcher = createWatcher(cfg.staffDir, () => { rebuild(); refreshGit(); });
      refreshGit();
    }
    rebuild({ full: true });
  }

  function stop() {
    for (const t of timers) clearInterval(t);
    timers = [];
    if (watcher) watcher.stop();
    hub.close();
  }

  return {
    start, stop, rebuild, repoint, pollSessions, refreshGit, hub,
    get current() { return live && current ? current : rebuild(); },
    get stale() { return stale; },
    initFrame
  };
}

module.exports = { createStore };
