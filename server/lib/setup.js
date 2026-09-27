'use strict';
/* setup.js: first run. Creates the staff folder with one office, the Chief of
   Staff, from template/chief-of-staff/. Refused once any office exists, so it
   can never touch a staff that is already there. */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const staff = require('./staff');
const template = require('./template');
const { localISODate } = require('./dates');

const DEFAULT_NAME = 'Casey';
const DEFAULT_FOLDER = 'Chief of Staff';

class SetupError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function validName(name) {
  const n = String(name || '').trim();
  if (!n) return DEFAULT_NAME;
  if (n.length > 40 || /[\\/\n\r\t"]/.test(n)) throw new SetupError(400, 'name must be short and contain no slashes or quotes');
  return n;
}

/* Create the staff. `staffDir` may override the configured folder; the choice
   is written back to aar.config.json so the next start finds it. */
function validAccent(accent) {
  const a = String(accent || '').trim().toLowerCase();
  if (!a) return '#5b7c99';
  if (!/^#[0-9a-f]{6}$/.test(a)) throw new SetupError(400, 'the accent must be a hex colour like #5b7c99');
  return a;
}

function validAvatar(avatar, cfg) {
  const a = String(avatar || '').trim();
  if (!a || a === 'own') return '';
  if (!/^[A-Za-z0-9._-]+\.png$/.test(a) || !fs.existsSync(path.join(cfg.appRoot, 'assets', 'avatars', a))) throw new SetupError(400, 'unknown starter avatar');
  return a;
}

function createStaff({ cfg, staffDir, name, accent, avatar, now = new Date(), persist = true }) {
  const dir = path.resolve(config.expandHome(String(staffDir || cfg.staffDir).trim()));
  if (!dir || dir === path.parse(dir).root) throw new SetupError(400, 'staff folder must be a real folder path');
  if (staff.discoverOffices(dir).length > 0) throw new SetupError(409, `a staff already exists in ${dir}`);
  const assistant = validName(name);
  const folderExisted = fs.existsSync(dir);
  const vars = {
    name: assistant,
    role: 'Chief of Staff',
    accent: validAccent(accent),
    avatar: validAvatar(avatar, cfg),
    brand: cfg.brand,
    date: localISODate(now),
    staffDir: dir
  };
  const src = path.join(cfg.appRoot, 'template', 'chief-of-staff');
  const officeFolder = path.join(dir, DEFAULT_FOLDER);
  if (fs.existsSync(officeFolder)) throw new SetupError(409, `${officeFolder} already exists`);
  fs.mkdirSync(dir, { recursive: true });
  template.renderDir(src, officeFolder, vars);
  if (persist && dir !== cfg.staffDir) {
    cfg.staffDir = dir;
    config.save(cfg);
  }
  return {
    staffDir: dir,
    createdFolder: !folderExisted,
    office: DEFAULT_FOLDER,
    name: assistant,
    gitInitCommand: `cd "${dir}" && git init && git add -A && git commit -m "New staff: ${assistant}, Chief of Staff"`
  };
}

module.exports = { SetupError, createStaff, DEFAULT_NAME, DEFAULT_FOLDER };
