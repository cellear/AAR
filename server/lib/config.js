'use strict';
/* config.js: aar.config.json in the app folder. Loads it, writes defaults when
   it is absent, expands `~` in staffDir. Environment overrides exist for tests
   and for running against a different staff without editing the file:
   AAR_CONFIG (path to the file), AAR_STAFF_DIR, AAR_PORT. */

const fs = require('fs');
const path = require('path');
const platform = require('./platform');

const APP_ROOT = path.resolve(__dirname, '..', '..');

const DEFAULTS = Object.freeze({
  staffDir: '~/aar-staff',
  port: 3111,
  brand: 'AAR',
  pollMs: 5000,          /* how often `claude agents --json` is polled */
  stuckMs: 15 * 60000,   /* a session busy longer than this is flagged Stuck */
  gitFetchMs: 5 * 60000, /* 0 disables the periodic `git fetch` */
  models: ['opus', 'sonnet', 'haiku']
});

function configPath() {
  return process.env.AAR_CONFIG
    ? path.resolve(process.env.AAR_CONFIG)
    : path.join(APP_ROOT, 'aar.config.json');
}

function expandHome(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return platform.homeDir();
  if (p.startsWith('~/')) return path.join(platform.homeDir(), p.slice(2));
  return p;
}

/* Merge a raw object over the defaults, keeping only known keys with sane types. */
function normalise(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  for (const key of Object.keys(DEFAULTS)) {
    if (!(key in raw)) continue;
    const value = raw[key];
    if (key === 'models') {
      if (Array.isArray(value) && value.every((v) => typeof v === 'string')) out.models = value.slice();
    } else if (typeof DEFAULTS[key] === 'number') {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) out[key] = n;
    } else if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

/* The loaded config, with staffDir made absolute and env overrides applied. */
function resolve(cfg) {
  const out = { ...cfg };
  if (process.env.AAR_STAFF_DIR) out.staffDir = process.env.AAR_STAFF_DIR;
  if (process.env.AAR_PORT) out.port = Number(process.env.AAR_PORT) || out.port;
  out.staffDir = path.resolve(expandHome(out.staffDir));
  out.appRoot = APP_ROOT;
  out.configPath = configPath();
  return out;
}

function load() {
  const file = configPath();
  let raw = null;
  let exists = true;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw new Error(`cannot read ${file}: ${err.message}`);
    exists = false;   /* written only when the user creates a staff or picks a folder */
  }
  const cfg = resolve(normalise(raw));
  cfg.settingsExist = exists;
  return cfg;
}

/* Persist a change (first-run setup uses it to record the chosen staff folder).
   Only the stored keys are written; derived ones like appRoot are not. */
function save(cfg) {
  const file = cfg.configPath || configPath();
  const stored = {};
  for (const key of Object.keys(DEFAULTS)) stored[key] = cfg[key];
  fs.writeFileSync(file, JSON.stringify(stored, null, 2) + '\n');
}

/* Point the app at another staff folder and remember it. Returns the new
   absolute path. The folder need not exist yet: the first-run screen offers
   to create it. */
function setStaffDir(cfg, staffDir) {
  const dir = path.resolve(expandHome(String(staffDir || '').trim()));
  if (!dir || dir === path.parse(dir).root) throw new Error('staff folder must be a real folder path');
  cfg.staffDir = dir;
  save(cfg);
  return dir;
}

module.exports = { DEFAULTS, APP_ROOT, configPath, expandHome, normalise, resolve, load, save, setStaffDir };
