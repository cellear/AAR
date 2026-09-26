'use strict';
/* reader.js: one pass over the staff folder. Discovers the offices, reads each
   one, and hands the results to state.js. Phase 2 adds the live sources
   (sessions, transcripts, git) as inputs here; phase 1 passes nulls, so every
   snapshot is honest about what it knows: no session, no git, files only. */

const fs = require('fs');
const staff = require('./staff');
const office = require('./office');
const state = require('./state');

function staffExists(staffDir) {
  return staff.discoverOffices(staffDir).length > 0;
}

function dirExists(dir) {
  try { return fs.statSync(dir).isDirectory(); } catch { return false; }
}

function readAll(config, { now = new Date(), live = {} } = {}) {
  const errors = [];
  let offices = [];
  try {
    offices = staff.discoverOffices(config.staffDir);
  } catch (err) {
    errors.push(`staff folder: ${err.message}`);
  }
  const { cos, warnings } = staff.chiefOfStaff(offices);
  const snapshots = [];
  for (const o of offices) {
    try {
      const files = office.readOffice(o.folder, { cos: cos !== null && cos.id === o.id });
      const sessions = (live.sessionsByOffice && live.sessionsByOffice[o.id]) || [];
      snapshots.push(state.buildOfficeSnapshot({
        office: o,
        files,
        session: sessions[0] || null,
        sessions: sessions.slice(1),
        transcript: (live.transcriptsByOffice && live.transcriptsByOffice[o.id]) || null,
        git: live.git || null,
        now,
        stuckMs: config.stuckMs
      }));
    } catch (err) {
      errors.push(`${o.id}: ${err.message}`);
    }
  }
  const cosSnapshot = cos ? snapshots.find((s) => s.id === cos.id) || null : null;
  return {
    staff: {
      brand: config.brand,
      staffDir: config.staffDir,
      exists: dirExists(config.staffDir),
      count: snapshots.length,
      needsYou: snapshots.filter((s) => s.badges.includes('needsYou')).length,
      cos: cos ? cos.id : null,
      warnings,
      readOnly: true
    },
    offices: snapshots,
    cos: cosSnapshot,
    frontDesk: live.frontDesk || [],
    git: live.git || null,
    polledAt: now.toISOString(),
    errors
  };
}

module.exports = { readAll, staffExists, dirExists };
