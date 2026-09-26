'use strict';
/* watch.js: tell the store when something in the staff folder changes.
   fs.watch with recursive, debounced, re-armed after an error (editors doing
   atomic saves and folders being recreated can invalidate a watcher), with a
   slow poll as the backstop because fs.watch can go quiet without saying so.
   The callback gets the changed office id when the path makes it obvious,
   else null meaning "check everything". After 3mt-avatars' lib/watch.js. */

const fs = require('fs');
const path = require('path');

function createWatcher(dir, onChange, { debounceMs = 150, rearmMs = 5000 } = {}) {
  let watcher = null;
  let timer = null;
  let rearm = null;
  let stopped = false;
  const pending = new Set();

  function flush() {
    timer = null;
    const ids = [...pending];
    pending.clear();
    if (ids.includes(null)) onChange(null);
    else for (const id of ids) onChange(id);
  }

  function noticed(filename) {
    let id = null;
    if (filename) {
      const first = String(filename).split(/[\\/]/)[0];
      if (first && !first.startsWith('.')) id = first;
    }
    pending.add(id);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  }

  function arm() {
    if (stopped || watcher) return;
    try {
      watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => noticed(filename));
      watcher.on('error', () => { close(); scheduleRearm(); });
    } catch {
      watcher = null;
      scheduleRearm();
    }
  }

  function close() {
    if (watcher) { try { watcher.close(); } catch { /* already closed */ } }
    watcher = null;
  }

  function scheduleRearm() {
    if (stopped || rearm) return;
    rearm = setTimeout(() => { rearm = null; arm(); if (watcher) noticed(null); }, rearmMs);
  }

  arm();
  return {
    get armed() { return watcher !== null; },
    rearm() { if (!watcher) arm(); },
    stop() {
      stopped = true;
      close();
      if (timer) clearTimeout(timer);
      if (rearm) clearTimeout(rearm);
    }
  };
}

module.exports = { createWatcher };
