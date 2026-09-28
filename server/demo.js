#!/usr/bin/env node
'use strict';
/* demo.js: seed a sample staff so there is something to click through before
   hiring anyone for real. Creates the Chief of Staff and four offices through
   the same code the first-run screen and the wizard use, then fills in a few
   briefings, statuses and one morning sheet.

       node server/demo.js <folder>        e.g. node server/demo.js ~/aar-demo-staff

   Refuses a folder that already holds an office. Point aar.config.json's
   staffDir at the folder (or set AAR_STAFF_DIR) and start the app. */

const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const setup = require('./lib/setup');
const hire = require('./lib/hire');
const { localISODate, addDays } = require('./lib/dates');

const target = process.argv[2];
if (!target) { console.error('usage: node server/demo.js <folder>'); process.exit(2); }
const staffDir = path.resolve(config.expandHome(target));
const cfg = { ...config.DEFAULTS, appRoot: config.APP_ROOT, staffDir };
const now = new Date();
const d = (n) => localISODate(addDays(now, n));

function write(office, file, text) { fs.writeFileSync(path.join(staffDir, office, file), text); }

try {
  setup.createStaff({ cfg, staffDir, name: 'Eric', persist: false });
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
const offices = [
  { name: 'Holly', role: 'Headhunter', folder: 'Prospects', model: 'sonnet', accent: '#c2603f', avatar: 'cast-09.png', covers: 'Potential employers and potential clients: the job hunt, from first contact to offer.' },
  { name: 'Maya', role: 'Marketing', folder: 'Marketing', model: 'sonnet', accent: '#8a5a9e', avatar: 'cast-05.png', covers: 'Public presence: the blog, the websites, social media. Builds and deploys the sites.' },
  { name: 'Marissa', role: 'Events', folder: 'BADCamp', model: 'sonnet', accent: '#2e7d6b', avatar: 'cast-06.png', covers: 'BADCamp and SFDUG, including the treasury.' },
  { name: 'Walter', role: 'Biographer', folder: 'Biography', model: 'sonnet', accent: '#7a6a3a', avatar: 'cast-04.png', covers: 'The record of the user\'s life and career. Single source of truth for life facts.' }
];
for (const o of offices) hire.hire(o, cfg, { now });

write('Chief of Staff', 'status.md', `Now: Writing tomorrow's morning sheet from every office's status.\nNeed from you:\nNext: Close out the day at six.\n`);
write('Chief of Staff', 'avatar.png', fs.readFileSync(path.join(config.APP_ROOT, 'assets', 'avatars', 'cast-03.png')));
fs.mkdirSync(path.join(staffDir, 'Chief of Staff', 'mornings'), { recursive: true });
write('Chief of Staff', `mornings/${d(0)}.md`, `# ${now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}

## Today's schedule
- 10:00 Coffee with Bob (Globex)
- 14:00 Acme screen with Ada (video)

## This week
- Globex proposal due ${d(5)}
- BADCamp treasury report to the board

## Today's plan
- [ ] Prep questions for the Acme screen (Holly has them)
- [ ] Approve Maya's LinkedIn queue
- [x] Pull the staff repo on the Mac

## Only you can do
- Say yes or no to Tuesday 2pm (Holly)
- Sign the BADCamp venue contract (Marissa)

---
_Offices: Prospects, Marketing, BADCamp, Biography. Ask Eric for anything cross-office._
`);
write('Prospects', 'status.md', `Now: Two replies drafted for the Acme recruiter; one screen scheduled.\nNeed from you: Say yes or no to the Tuesday 2pm screen.\nNext: Update the tracker.\n`);
write('Prospects', 'briefing.md', `# Briefing: Prospects

_Holly's current picture of the job hunt. Overwritten freely._

## Key facts

- Two live conversations: **Acme** (platform engineer) and **Globex** (contract migration).
- Salary floor agreed with the user on ${d(-6)}.

## People

- **Ada Lovelace** — Acme recruiter. Warm, fast, prefers email.
- **Bob Roberts** — Globex hiring manager. Met at the BADCamp mixer.

## Upcoming deadlines

- Reply to Acme with availability, ${d(2)}
- Globex proposal due ${d(6)}
- Follow up with Bob if silent, ${d(9)}
- Someday: refresh the portfolio site

## Open items

- [ ] Send the Acme prep questions
- [x] Update the tracker with the Globex contact
- [ ] Draft the Globex proposal outline
`);
write('Prospects', 'log.md', `# Log: Prospects\n\n## ${d(-6)} Office opened\n- Read the README, agreed the salary floor.\n\n## ${d(-2)} Screens\n- Ada scheduled a screen for Tuesday.\n\n## ${d(0)} Two replies\n- Drafted two replies for Ada; one screen scheduled.\n`);
write('Marketing', 'status.md', `Now: Scheduling next week's LinkedIn posts in Buffer.\nNeed from you:\nNext: Draft the October blog post.\n`);
write('Marketing', 'briefing.md', `# Briefing: Marketing\n\n## Key facts\n\n- One Buffer queue shared with BADCamp: read it before scheduling.\n\n## People\n\n## Upcoming deadlines\n\n- Blog post draft ${d(4)}\n\n## Open items\n\n- [ ] October blog post outline\n- [ ] Refresh the site footer\n`);
write('BADCamp', 'status.md', `Now: Reconciling the treasury against the bank statement.\nNeed from you: Sign the venue contract before ${d(3)}.\nNext: Board report.\n`);
write('BADCamp', 'briefing.md', `# Briefing: BADCamp\n\n## Key facts\n\n- Venue contract in hand; deposit due ${d(3)}.\n\n## People\n\n## Upcoming deadlines\n\n- Venue deposit ${d(3)}\n- Board report ${d(12)}\n\n## Open items\n\n- [ ] Board report\n`);
console.log(`Demo staff created in ${staffDir}: Chief of Staff (Eric), ${offices.map((o) => o.folder + ' (' + o.name + ')').join(', ')}`);
console.log(`Point AAR at it:  AAR_STAFF_DIR="${staffDir}" npm start   or set staffDir in aar.config.json`);
