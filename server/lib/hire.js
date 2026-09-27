'use strict';
/* hire.js: the hire wizard's server side and the app's one write path
   besides first-run setup. Validates the form, renders template/office/
   into a new office folder with the placeholders filled, and writes
   avatar-prompts.md so the user can make pictures. Never overwrites. */

const fs = require('fs');
const path = require('path');
const staff = require('./staff');
const template = require('./template');
const { localISODate } = require('./dates');

class HireError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const ROLE_PROPS = [
  [/recruit|headhunt|job|prospect/i, 'a folder of résumés'],
  [/market|social|blog|content/i, 'a megaphone'],
  [/treasur|finance|budget|money/i, 'a ledger'],
  [/event|camp|conference|meetup|community/i, 'a lanyard and a name badge'],
  [/biograph|histor|archiv|record/i, 'a thick notebook'],
  [/client|account|customer/i, 'a handshake-ready clipboard'],
  [/chief|coordinat|assistant/i, 'a clipboard with a daily plan']
];

function propFor(role, covers) {
  for (const [re, prop] of ROLE_PROPS) if (re.test(role) || re.test(covers)) return prop;
  return 'a clipboard';
}

/* Starter cast: every PNG in assets/avatars, by file name. */
function castList(appRoot) {
  const dir = path.join(appRoot, 'assets', 'avatars');
  let entries;
  try { entries = fs.readdirSync(dir); } catch { return []; }
  return entries.filter((f) => /\.png$/i.test(f)).sort().map((file) => ({ file, url: `/avatars/cast/${encodeURIComponent(file)}`, label: file.replace(/\.png$/i, '').replace(/[-_]+/g, ' ') }));
}

function nextOrder(offices) {
  let max = 0;
  for (const o of offices) if (o.conf.order !== null && o.conf.order > max) max = o.conf.order;
  return max + 1;
}

function options(cfg) {
  const offices = staff.discoverOffices(cfg.staffDir);
  return {
    staffDir: cfg.staffDir,
    models: cfg.models,
    cast: castList(cfg.appRoot),
    nextOrder: nextOrder(offices),
    taken: offices.map((o) => o.id),
    accents: ['#5b7c99', '#c2603f', '#8a5a9e', '#2e7d6b', '#7a6a3a', '#3a6a8a', '#b5533c', '#4f7942']
  };
}

const short = (v, max) => String(v == null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max);

/* Check the form. Throws HireError(400) with a human message. */
function validate(form, cfg) {
  const name = short(form.name, 40);
  const folder = short(form.folder, 60);
  const role = short(form.role, 60);
  const covers = String(form.covers == null ? '' : form.covers).trim().slice(0, 2000);
  const model = short(form.model, 40) || (cfg.models[0] || 'sonnet');
  let accent = short(form.accent, 7);
  const avatar = short(form.avatar, 80);
  if (!name) throw new HireError(400, 'the assistant needs a name');
  if (/[\\/"\n\r\t]/.test(name)) throw new HireError(400, 'the name cannot contain slashes or quotes');
  if (!folder) throw new HireError(400, 'the office needs a folder name');
  if (/[\\/:\0]/.test(folder) || folder.startsWith('.') || folder === '..' || /[<>|?*"]/.test(folder)) throw new HireError(400, 'the folder name cannot contain slashes, colons or quotes, or start with a dot');
  if (!role) throw new HireError(400, 'the assistant needs a role title');
  if (/[\n\r"]/.test(role)) throw new HireError(400, 'the role must be one line without quotes');
  if (!cfg.models.includes(model)) throw new HireError(400, `unknown model "${model}"; choose one of ${cfg.models.join(', ')}`);
  if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) throw new HireError(400, 'the accent must be a hex colour like #5b7c99');
  if (!accent) accent = '#5b7c99';
  if (avatar && avatar !== 'own' && !castList(cfg.appRoot).some((c) => c.file === avatar)) throw new HireError(400, 'unknown starter avatar');
  const order = Number.isFinite(Number(form.order)) && form.order !== '' && form.order !== null && form.order !== undefined ? Number(form.order) : null;
  return { name, folder, role, covers, model, accent: accent.toLowerCase(), avatar: avatar === 'own' ? '' : avatar, order };
}

function hire(form, cfg, { now = new Date() } = {}) {
  const f = validate(form, cfg);
  const offices = staff.discoverOffices(cfg.staffDir);
  if (!fs.existsSync(cfg.staffDir)) throw new HireError(409, `the staff folder ${cfg.staffDir} does not exist; create the staff first`);
  const dest = path.join(cfg.staffDir, f.folder);
  if (fs.existsSync(dest)) throw new HireError(409, `${f.folder} already exists in the staff folder`);
  const order = f.order === null ? nextOrder(offices) : f.order;
  const vars = {
    name: f.name, folder: f.folder, role: f.role, covers: f.covers || '(to be written)', model: f.model,
    accent: f.accent, avatar: f.avatar, order, brand: cfg.brand, date: localISODate(now), prop: propFor(f.role, f.covers)
  };
  template.renderDir(path.join(cfg.appRoot, 'template', 'office'), dest, vars);
  const prompts = ['avatar-prompt.md', 'office-prompt.md']
    .map((file) => template.fill(fs.readFileSync(path.join(cfg.appRoot, 'template', 'prompts', file), 'utf8'), vars))
    .join('\n\n---\n\n');
  fs.writeFileSync(path.join(dest, 'avatar-prompts.md'), prompts);
  return { id: f.folder, folder: dest, name: f.name, role: f.role, order, files: fs.readdirSync(dest).sort() };
}

module.exports = { HireError, validate, hire, options, castList, nextOrder, propFor };
