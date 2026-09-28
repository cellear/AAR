'use strict';
/* office.js: read the files AAR owns in one office folder and note what else
   is there without opening it. AAR reads README.md, briefing.md, log.md,
   status.md, and looks for avatar.png and office.png; in the Chief of Staff's
   office it also lists mornings/. Everything else is the user's. */

const fs = require('fs');
const path = require('path');

const OWNED = Object.freeze({
  conf: 'aa.conf',
  readme: 'README.md',
  briefing: 'briefing.md',
  log: 'log.md',
  status: 'status.md',
  claude: 'CLAUDE.md',
  avatar: 'avatar.png',
  office: 'office.png',
  mornings: 'mornings'
});

const OWNED_NAMES = new Set(Object.values(OWNED));
const SKIP = new Set(['.git', '.DS_Store', 'node_modules', '.claude']);

function readText(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return { text: null, mtime: null };
    return { text: fs.readFileSync(file, 'utf8'), mtime: new Date(st.mtimeMs).toISOString() };
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return { text: null, mtime: null };
    throw err;
  }
}

function exists(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

/* Every entry in the office that AAR does not read, by name, so the office
   view can list them unopened. Directories get a trailing slash. */
function otherFiles(folder) {
  let entries;
  try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((d) => !SKIP.has(d.name) && !OWNED_NAMES.has(d.name) && !d.name.startsWith('.'))
    .map((d) => (d.isDirectory() ? d.name + '/' : d.name))
    .sort((a, b) => a.localeCompare(b));
}

/* Morning sheets, newest by name first. */
function morningFiles(folder) {
  let entries;
  try { entries = fs.readdirSync(path.join(folder, OWNED.mornings), { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((d) => d.isFile() && /\.md$/i.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => b.localeCompare(a));
}

/* Names in a people/ subfolder, if any, so People sections can pair pictures
   with names. */
function peopleImages(folder) {
  let entries;
  try { entries = fs.readdirSync(path.join(folder, 'people'), { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((d) => d.isFile() && /\.(png|jpe?g|gif|webp)$/i.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b));
}

function readOffice(folder, { cos = false } = {}) {
  const readme = readText(path.join(folder, OWNED.readme));
  const briefing = readText(path.join(folder, OWNED.briefing));
  const log = readText(path.join(folder, OWNED.log));
  const status = readText(path.join(folder, OWNED.status));
  return {
    folder,
    readme: readme.text,
    briefing: briefing.text,
    log: log.text,
    status: status.text,
    mtimes: { readme: readme.mtime, briefing: briefing.mtime, log: log.mtime, status: status.mtime },
    images: {
      avatar: exists(path.join(folder, OWNED.avatar)),
      office: exists(path.join(folder, OWNED.office))
    },
    people: peopleImages(folder),
    files: otherFiles(folder),
    mornings: cos ? morningFiles(folder) : []
  };
}

module.exports = { OWNED, OWNED_NAMES, readOffice, readText, otherFiles, morningFiles, peopleImages };
