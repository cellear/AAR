'use strict';
/* staff.js: the roster. A folder directly under the staff folder is an office
   if and only if it contains `aa.conf`. This module parses that file, finds the
   Chief of Staff, and puts the offices in display order. It reads nothing else. */

const fs = require('fs');
const path = require('path');

const CONF_FILE = 'aa.conf';

/* Launch keys are Luke's aa-start keys; roster keys are AAR's own. Unknown keys
   are kept in `extra` so nothing the user writes is lost from view. */
const LAUNCH_KEYS = ['model', 'name', 'resume', 'add_dir'];
const ROSTER_KEYS = ['role', 'avatar', 'accent', 'order', 'cos'];

function parseConf(text) {
  const values = {};
  const extra = {};
  const lines = String(text || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.replace(/^\s*#.*$/, '').trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    let value = line.slice(eq + 1).trim();
    /* Strip one pair of matching quotes, as a shell would. */
    if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'"))) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    if (LAUNCH_KEYS.includes(key) || ROSTER_KEYS.includes(key)) values[key] = value;
    else extra[key] = value;
  }
  const name = values.name || '';
  return {
    model: values.model || '',
    name,
    shortName: shortName(name),
    resume: /^(yes|true|1)$/i.test(values.resume || ''),
    addDir: values.add_dir || '',
    role: values.role || roleFromName(name),
    avatar: values.avatar || '',
    accent: normaliseAccent(values.accent),
    order: values.order !== undefined && values.order !== '' && Number.isFinite(Number(values.order)) ? Number(values.order) : null,
    cos: /^(yes|true|1)$/i.test(values.cos || ''),
    extra
  };
}

/* `Holly - Headhunter` names the assistant Holly. */
function shortName(name) {
  const value = String(name || '').trim();
  const dash = value.indexOf(' - ');
  return dash === -1 ? value : value.slice(0, dash).trim();
}

/* When no role= is given, the part after ` - ` in the name is the best guess. */
function roleFromName(name) {
  const value = String(name || '').trim();
  const dash = value.indexOf(' - ');
  return dash === -1 ? '' : value.slice(dash + 3).trim();
}

function normaliseAccent(value) {
  if (!value) return '';
  const v = String(value).trim();
  return /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? (v.startsWith('#') ? v : '#' + v).toLowerCase() : '';
}

/* Offices: every directory directly under staffDir with an aa.conf. Hidden
   folders and anything without the file are ignored. Missing or unreadable
   staffDir yields an empty list rather than an error, so the first-run screen
   can show. */
function discoverOffices(staffDir) {
  let entries;
  try {
    entries = fs.readdirSync(staffDir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
    throw err;
  }
  const offices = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const folder = path.join(staffDir, entry.name);
    let text;
    try {
      text = fs.readFileSync(path.join(folder, CONF_FILE), 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') continue;
      throw err;
    }
    const conf = parseConf(text);
    offices.push({ id: entry.name, folder, conf, name: conf.shortName || entry.name });
  }
  return orderOffices(offices);
}

/* Chief of Staff first, then offices with an `order` by that number, then the
   rest alphabetically by assistant name. */
function orderOffices(offices) {
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return offices.slice().sort((a, b) => {
    if (a.conf.cos !== b.conf.cos) return a.conf.cos ? -1 : 1;
    const ao = a.conf.order, bo = b.conf.order;
    if (ao !== null && bo !== null && ao !== bo) return ao - bo;
    if ((ao === null) !== (bo === null)) return ao === null ? 1 : -1;
    return collator.compare(a.name, b.name) || collator.compare(a.id, b.id);
  });
}

/* Exactly one office should say cos=yes. The first in order wins; the rest
   are reported so the roster can warn. */
function chiefOfStaff(offices) {
  const marked = offices.filter((o) => o.conf.cos);
  return {
    cos: marked[0] || null,
    warnings: marked.length > 1
      ? [`more than one office has cos=yes: ${marked.map((o) => o.id).join(', ')}; using ${marked[0].id}`]
      : marked.length === 0 && offices.length > 0 ? ['no office has cos=yes'] : []
  };
}

module.exports = { CONF_FILE, LAUNCH_KEYS, ROSTER_KEYS, parseConf, shortName, roleFromName, discoverOffices, orderOffices, chiefOfStaff };
