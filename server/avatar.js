#!/usr/bin/env node
'use strict';
/* avatar.js: cut generated standees into cast pictures.

       npm run avatar -- <image...>                   into assets/avatars/, named cast-NN.png
       npm run avatar -- --to <folder> <image...>     anywhere else; --name <n> names one output
       npm run avatar -- --check <image...>           write previews only, into ./avatar-previews/

   Options: --split (a sheet of figures side by side), --no-caption (skip
   the caption crop), --tolerance <n> (background match, default 28),
   --force (overwrite). Refuses to overwrite otherwise. */

const fs = require('fs');
const path = require('path');
const av = require('./lib/avatar');

const ROOT = path.resolve(__dirname, '..');
const CAST = path.join(ROOT, 'assets', 'avatars');

function parseArgs(argv) {
  const o = { files: [], to: CAST, name: null, check: false, split: false, caption: true, tolerance: av.DEFAULT_TOLERANCE, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--to') o.to = path.resolve(argv[++i]);
    else if (a === '--name') o.name = argv[++i];
    else if (a === '--check') o.check = true;
    else if (a === '--split') o.split = true;
    else if (a === '--no-caption') o.caption = false;
    else if (a === '--tolerance') o.tolerance = Number(argv[++i]);
    else if (a === '--force') o.force = true;
    else if (a.startsWith('-')) { console.error(`unknown option ${a}`); process.exit(2); }
    else o.files.push(a);
  }
  return o;
}

/* The next free cast-NN.png in a folder. */
function nextCastName(dir) {
  let max = 0;
  try { for (const f of fs.readdirSync(dir)) { const m = /^cast-(\d+)\.png$/.exec(f); if (m) max = Math.max(max, Number(m[1])); } } catch { /* empty */ }
  return `cast-${String(max + 1).padStart(2, '0')}.png`;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (!o.files.length) { console.error('usage: npm run avatar -- [--to <folder>] [--name <n>] [--split] [--no-caption] [--tolerance <n>] [--check] [--force] <image...>'); process.exit(2); }
  const outDir = o.check ? path.resolve('avatar-previews') : o.to;
  fs.mkdirSync(outDir, { recursive: true });
  const names = o.name ? o.name.split(',') : [];
  let written = 0;
  for (const file of o.files) {
    if (!/\.(png|jpe?g)$/i.test(file)) { console.log(`skip     ${file}: not a PNG or JPEG`); continue; }
    let buf;
    try { buf = fs.readFileSync(file); } catch (err) { console.log(`skip     ${file}: ${err.message}`); continue; }
    const results = await av.process(buf, { tolerance: o.tolerance, cropCaption: o.caption, split: o.split });
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const rp = r.report;
      const base = names.shift() || (o.to === CAST && !o.check ? nextCastName(outDir).replace(/\.png$/, '') : path.basename(file).replace(/\.[^.]+$/, '') + (results.length > 1 ? `-${i + 1}` : ''));
      const outName = base.endsWith('.png') ? base : base + '.png';
      const target = path.join(outDir, o.check ? outName.replace(/\.png$/, '-preview.png') : outName);
      const note = `${rp.transparent ? 'already transparent' : 'background ' + rp.background.join(',')}${rp.captionRows ? `, caption ${rp.captionRows} rows cropped` : ''}${rp.slice ? `, slice ${i + 1} of ${results.length}` : ''} -> ${rp.output.width}x${rp.output.height}`;
      if (fs.existsSync(target) && !o.force) { console.log(`exists   ${target} (use --force to overwrite): ${note}`); continue; }
      fs.writeFileSync(target, o.check ? await av.preview(buf, r) : r.png);
      written++;
      console.log(`${o.check ? 'preview ' : 'wrote   '} ${path.relative(process.cwd(), target)}: ${note}`);
    }
  }
  console.log(`${written} file(s) written to ${path.relative(process.cwd(), outDir) || '.'}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
