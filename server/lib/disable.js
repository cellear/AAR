'use strict';
/* disable.js: take an assistant off the floor and bring one back. Disabling
   moves the office folder into <staff>/Disabled/, where the lobby does not
   look; enabling moves it back. Nothing is deleted, nothing inside the
   folder is touched, and a name clash refuses rather than overwrites. */

const fs = require('fs');
const path = require('path');
const staff = require('./staff');

const DISABLED_DIR = 'Disabled';

class DisableError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function checkId(id) {
  if (typeof id !== 'string' || !id || /[\\/\0]/.test(id) || id === '.' || id === '..' || id.startsWith('.')) throw new DisableError(400, 'bad office id');
  return id;
}

function disabledRoot(cfg) { return path.join(cfg.staffDir, DISABLED_DIR); }

/* Offices sitting in Disabled/, in the shape the lobby needs. */
function listDisabled(cfg) {
  return staff.discoverOffices(disabledRoot(cfg))
    .map((o) => ({ id: o.id, name: o.name, role: o.conf.role || '' }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function disable(id, cfg) {
  checkId(id);
  const offices = staff.discoverOffices(cfg.staffDir);
  const o = offices.find((x) => x.id === id);
  if (!o) throw new DisableError(404, `no office called ${id}`);
  const { cos } = staff.chiefOfStaff(offices);
  if (cos && cos.id === id) throw new DisableError(400, 'the Chief of Staff cannot be disabled');
  const dest = path.join(disabledRoot(cfg), id);
  if (fs.existsSync(dest)) throw new DisableError(409, `Disabled/${id} already exists; move or rename it first`);
  fs.mkdirSync(disabledRoot(cfg), { recursive: true });
  fs.renameSync(o.folder, dest);
  return { id, name: o.name, from: o.folder, to: dest };
}

function enable(id, cfg) {
  checkId(id);
  const src = path.join(disabledRoot(cfg), id);
  if (!fs.existsSync(path.join(src, staff.CONF_FILE))) throw new DisableError(404, `no disabled office called ${id}`);
  const dest = path.join(cfg.staffDir, id);
  if (fs.existsSync(dest)) throw new DisableError(409, `${id} already exists in the staff folder; rename one of them first`);
  fs.renameSync(src, dest);
  return { id, from: src, to: dest };
}

module.exports = { DISABLED_DIR, DisableError, listDisabled, disable, enable };
