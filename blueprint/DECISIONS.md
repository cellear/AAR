# Decisions

_The rulings and assumptions behind AAR, one per line, newest section last.
The plan in `aar-interface-mvp/` is the starting point; this file is what
actually holds. When a line here contradicts the plan, this file wins._

## Rulings from Luke

These came from Luke directly and are not up for re-guessing.

- 2026-09-26 · The app is the repo root; the staff folder is separate and outside the checkout. A staff created inside the checkout works but its git badges describe the wrong repository, so `STAFF/` and `staff/` in the checkout are gitignored as a safety net.
- 2026-09-27 · Dates stamped into files use the machine's local calendar day, never UTC.
- 2026-09-27 · Pronouns in the app and templates are they/them. Gender identity for assistants is a later, careful conversation.
- 2026-09-27 · The lobby is a floor, not a card grid: everyone stands on one background, opaque, with a short plate; click one and the others recede while that assistant's panels appear. The card grid survives behind a toggle.
- 2026-09-27 · Quiet and receded figures are desaturated and lightened, never made transparent. The background must not show through a character.
- 2026-09-27 · The everyone view shows, per assistant, the name, the job title, a one-line summary (the `Now` line, or the `Need from you` line in red) and how long since they were last heard.
- 2026-09-27 · The focused assistant stands large at the far left; the others recede to the lower right.
- 2026-09-27 · AAR stands for Administrative Assistant Robots, and the splash says so.
- 2026-09-27 · "A window, not a control panel" is true of this version only. A later version will talk to the assistants from the page.
- 2026-09-27 · The splash describes an office without naming its files; the file names belong in the conventions page.
- 2026-09-27 · The first-run form is "Create the Chief of Staff", not "Create the staff". One person is being created.
- 2026-09-27 · After `npm run reset`, `npm start` asks where the staff folder goes; it does not assume.
- 2026-09-27 · AAR never modifies or deletes a file it did not create. It writes only a new office folder inside the staff folder, and its own settings file. The splash says this in so many words.
- 2026-09-27 · Everything an assistant says in the terminal must be readable in the app. The Conversation card reads the whole transcript.
- 2026-09-27 · A folder picker (an AppleScript dialog) is parked until a complexity conversation.

## Rulings from Luke: the cast (2026-09-28)

- The starter cast suggests no names or roles. Files are `cast-NN.png`; the pickers show pictures only. Props stay, since a megaphone reads as a role by sight without the file asserting one.
- Luke supplies the pictures, generated in the AMS style on white; AAR cuts them out (`npm run avatar`). Twenty-one figures were supplied; Luke may trim the cast later by deleting files.

Build-level guesses:
- The nine AMS standees are `cast-01` to `cast-09` in their old alphabetical order; the old names keep working through an alias map and are written back as the numbered file.
- Background removal is a flood fill from the edges with a per-channel tolerance of 28, so enclosed white (a notebook, a shirt) survives; a one-pixel feather softens the cut. The soft shadow under the feet is kept, as the AMS standees have one.
- A caption under the feet is found as short, narrow ink bands below the tallest band and cropped; the command turns this on by default.
- Sheets of figures split at full-height background gaps; overlapping crowds do not split.
- `jimp` (pure JavaScript) is the second runtime dependency, chosen over `sharp` to avoid a native binary per platform.

## Assumptions still standing

Guesses made while building that Luke has seen and not overturned. Each is a
line to change, not a foundation.

Plan-level:
- Launch only copies a command to the clipboard; `claude --bg` is deferred.
- Zero runtime dependencies (Node's `http`), one vendored Markdown renderer (marked, in `public/vendor/`). Playwright is a dev dependency for the browser tests only.
- Default port 3111. Default staff folder suggestion `~/aar-staff`.
- Roster metadata (`role`, `avatar`, `accent`, `order`, `cos`) lives in `aa.conf` beside the launch keys.
- `cos=yes` marks the Chief of Staff; exactly one per staff. More than one, or none, is a warning in the header.
- Office image names are fixed: `avatar.png`, `office.png`, and pictures in `people/`.
- Canonical briefing headings: Key facts, People, Upcoming deadlines, Open items. Other headings are plain cards.
- `git fetch` runs on a timer (default five minutes, `gitFetchMs: 0` disables it) so Behind appears without a manual pull.
- Stuck is fifteen minutes of busy, or a last message starting "API Error". The agents list gives no busy-since, so busy is measured from the session's start.
- Several live sessions for one office: the newest on the plate, the rest in the office sidebar.
- Cloud and desktop-app sessions are invisible except through git; they leave no transcript on the Mac.
- The morning sheet is the newest file by name in the Chief of Staff's `mornings/`.
- The starter cast is the nine AMS standees, as `eric.png`, `maya.png` and so on.

Build-level:
- The template Chief of Staff folder is `Chief of Staff/`; the person's name lives in `aa.conf`, not the folder name. Luke's own `Eric - Chief of Staff/` convention is not required.
- The first-run form has no default name; the placeholder invites one. (Casey was the original default and was dropped.)
- `status.md` labels are matched by name in any order; a file with none of the three labels counts as missing.
- Briefing sections carry raw Markdown in the snapshot; the browser renders it.
- Offices without `order=` sort alphabetically by assistant name, after those with one.
- A date with no year is this year, unless that is more than sixty days past, then next year.
- The log's title block is dropped once dated entries exist.
- The AAR-managed part of every `CLAUDE.md` is fenced by `<!-- aar:start -->` and `<!-- aar:end -->`.
- With no `role=`, the role is the part of `name` after " - ".
- Sessions outside the staff folder whose name matches an assistant are attributed to that assistant (the cloud "You are Holly" case). Unmatched sessions outside the folder are ignored.
- `claude` missing from the PATH degrades silently to "no sessions".
- Bubble sources are labelled in small print ("from their last session", "their last message") so transcript text is not mistaken for something written deliberately.
- Figures fade after a day of silence and grey after a week; the thresholds are constants in `public/js/lobby.js`.
- The focused panels show at most six deadlines, eight open items and three log entries; the office page has the full lists.
- The wizard suggests the folder name from the role until the user types one.
- The role picks the prop in the avatar prompt (résumés for a headhunter, a megaphone for marketing).
- The demo staff (`npm run demo`) uses Eric as the Chief of Staff and the starter-cast pictures, purely as sample data.
- The Conversation card polls every four seconds while visible; tool calls fold to one line; thinking blocks and system reminders are dropped.
- Only Chromium has checked the print layout; Safari may paginate differently.

## Open questions

- Should the transcript's away summary show when `status.md` exists but its `Now` line is much older than the last message?
- Should the office view render files AAR does not own (`people.md`, `finances.md`) as plain Markdown on request, or stay strictly to its own files?
- What should the front desk do with a session whose cwd is a subfolder of an office?
- Rebranding: everything reads `brand` from config, but `aa.conf` and the folder name `aar-staff` would survive a rename.
- The folder picker dialog (parked).
- Gender identity for assistants (parked).
- When the app starts talking to assistants, what stays read-only?
