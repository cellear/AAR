#!/usr/bin/env node
'use strict';
/* reset.js: forget this machine's answers so the next start behaves like the
   first one. Removes aar.config.json (the only place the app remembers the
   staff folder, port and tuning). Touches no staff folder: offices are data
   and reset never deletes data.

       npm run reset */

const fs = require('fs');
const config = require('./lib/config');

const file = config.configPath();
if (fs.existsSync(file)) {
  let staffDir = null;
  try { staffDir = JSON.parse(fs.readFileSync(file, 'utf8')).staffDir; } catch { /* unreadable; removing anyway */ }
  fs.unlinkSync(file);
  console.log(`Removed ${file}`);
  if (staffDir) console.log(`It pointed at ${staffDir}. That folder and its offices are untouched.`);
} else {
  console.log(`Nothing to reset: ${file} does not exist.`);
}
console.log(`The next "npm start" writes fresh defaults (staff folder ${config.DEFAULTS.staffDir}, port ${config.DEFAULTS.port})`);
console.log('and shows the first-run screen if that folder holds no office.');
