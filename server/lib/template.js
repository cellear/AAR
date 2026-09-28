'use strict';
/* template.js: copy a template folder to a new office, filling {{placeholders}}
   in text files. Binary files (images) are copied as they are. The destination
   must not exist: this is the one place AAR writes, and it never overwrites. */

const fs = require('fs');
const path = require('path');

const TEXT = /\.(md|conf|txt|json|gitkeep)$/i;

function fill(text, vars) {
  return String(text).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

function renderDir(src, dest, vars) {
  if (fs.existsSync(dest)) throw new Error(`refusing to overwrite ${dest}`);
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, fill(entry.name, vars));
    if (entry.isDirectory()) {
      renderDir(from, to, vars);
    } else if (TEXT.test(entry.name) || entry.name === '.gitkeep') {
      fs.writeFileSync(to, fill(fs.readFileSync(from, 'utf8'), vars));
    } else {
      fs.copyFileSync(from, to);
    }
  }
  return dest;
}

module.exports = { fill, renderDir };
