# AAR

A read-only local web dashboard for a staff of AI administrative assistants.
Each assistant is a folder of Markdown plus a Claude Code session started in
it; AAR is the window onto them. It reads files, never runs a session, and
writes nothing except a new office folder when you hire.

The file formats are in [`docs/conventions.md`](docs/conventions.md). The
decisions behind the design, and the assumptions still standing, are in
[`blueprint/DECISIONS.md`](blueprint/DECISIONS.md). The original plan is in
`blueprint/aar-interface-mvp/`, with a note at the top on where the build
departed from it. The system it generalises is described in
`aa-system-memo.md`.

## Quick start

Needs Node 22.

    npm install     # one time: the Agent SDK, for talking to assistants from the page
    npm start

`npm start` works without the install too; the reply box then says the SDK
is missing and everything else runs read-only.

On first start the app writes `aar.config.json` with defaults (staff folder
`~/aar-staff`, port 3111) and opens `http://localhost:3111/`. If the staff
folder has no office yet, the page offers to create one: a single Chief of
Staff office copied from `template/chief-of-staff/`. Give the assistant a name,
then start a session in the new folder:

    cd ~/aar-staff/"Chief of Staff" && claude --model opus --name "Casey - Chief of Staff"

To see the whole thing before hiring anyone for real, seed a sample staff:

    npm run demo -- ~/aar-demo-staff
    AAR_STAFF_DIR=~/aar-demo-staff npm start

To forget this machine's settings and start over as if for the first time:

    npm run reset

That removes `aar.config.json` and nothing else. No staff folder is touched.

Environment overrides, mostly for tests: `AAR_CONFIG` (path to the config
file), `AAR_STAFF_DIR`, `AAR_PORT`, `AAR_NO_OPEN=1` (do not open the browser).

    npm test

That runs the Node tests: parsers, state derivation and the server, with
inline fixtures and no browser. The browser suite drives the real pages in
the Chrome on your Mac (first run, the floor, the office page, the live
conversation, the hire wizard, the printed sheet), each test against a fresh
temp staff with a fake assistant writing transcript lines. It needs one
`npm install` (Playwright, a dev dependency only) and then:

    npm run test:browser

Set `AAR_BROWSER` to a browser executable if Chrome is not found.

## Where the staff folder goes

AAR is two things that live apart:

- **The app**: this folder, the AAR checkout. You run `npm start` here and
  never put your own files in it.
- **The staff folder**: one folder you choose, holding one subfolder per
  office. This is your data, and it should be its own git repository so that
  cloud sessions can see it and so the Unpushed and Behind badges mean
  something. Put it anywhere outside the app checkout, with no spaces in the
  path, for example `~/aar-staff` or `~/Sites/aar-staff`.

`aar.config.json` in the app folder records which staff folder the app is
pointed at. The first-run screen lets you type the path; afterwards, click
the path in the page header to point at another folder, or edit the file by
hand. `npm start` prints both paths every time it starts. A staff folder created inside the app checkout works, but
its git badges would then describe the app's repository rather than the
staff's, so `STAFF/` and `staff/` inside the checkout are gitignored as a
safety net.

Inside the staff folder every office is a subfolder with an `aa.conf`. The
**Hire** button in the lobby creates offices: it writes the folder from
`template/office/` with the assistant's name, role and brief filled in, and an
`avatar-prompts.md` with prompts for a standee and an office scene. You can
also copy an office and edit `aa.conf` by hand.

## Settings

`aar.config.json` in the app folder:

| Key | Default | Meaning |
|---|---|---|
| `staffDir` | `~/aar-staff` | The staff folder. |
| `port` | `3111` | The local port. |
| `brand` | `AAR` | The name shown everywhere. |
| `pollMs` | `5000` | How often live sessions are polled. |
| `stuckMs` | `900000` | Busy longer than this is flagged Stuck. |
| `gitFetchMs` | `300000` | How often to `git fetch` the staff repo; `0` disables. |
| `models` | `opus, sonnet, haiku` | Choices in the hire wizard. |

## What AAR reads

A folder directly under the staff folder is an office if it contains `aa.conf`.
In each office AAR reads only these files and lists the rest by name. The
full formats are in `docs/conventions.md`.

| File | What it is |
|---|---|
| `aa.conf` | `key=value`. Launch keys `model`, `name`, `resume`, `add_dir`; roster keys `role`, `avatar`, `accent`, `order`, `cos=yes` (exactly one office). |
| `status.md` | Three labelled lines: `Now:`, `Need from you:`, `Next:`. The bubble shows `Now`; a non-empty `Need from you` lights the badge. |
| `briefing.md` | What the assistant knows now. `## Key facts`, `## People`, `## Upcoming deadlines`, `## Open items` get special treatment. |
| `log.md` | One entry per session under `## YYYY-MM-DD`, newest at the bottom, append-only. |
| `README.md` | What the office is for. |
| `avatar.png`, `office.png` | The standee and the background scene, optional. |
| `mornings/` | Chief of Staff only: the daily printed sheet. |

## API

    GET  /api/staff              roster summary and config
    GET  /api/offices            every office snapshot
    GET  /api/offices/<folder>   one snapshot
    GET  /api/cos                the Chief of Staff's cross-office roll-up
    GET  /api/launch/<folder>    the copy-to-terminal command for the office
    GET  /api/transcript/<folder> the office's conversation: prompts, replies, folded tool calls
                                 ?session=<id> picks a transcript; ?before=<i>&limit=<n> pages back
    GET  /api/hire/options       models, starter cast, colours, next order number
    POST /api/hire               the hire wizard: writes one new office folder
    GET  /api/events             SSE: an init frame, then office / frontDesk / git / staff / stale frames
    GET  /avatars/<folder>/avatar.png, /avatars/<folder>/office.png, /avatars/cast/<file>
    POST /api/setup              first run only: create the staff folder

    POST /api/config             point the app at another staff folder (writes aar.config.json)
    GET  /api/talk/<folder>      the AAR-started session's state: phase, pending permissions
    POST /api/talk/<folder>/start|say|stop|answer|forget   talk to that assistant

Every other method is answered 405 before any path is resolved. AAR never
modifies or deletes a file it did not create: it adds a new office folder
inside the staff folder, and it rewrites its own `aar.config.json` and
`aar.sessions.json`. An assistant AAR runs for you writes into its office as
a terminal session would. The optional periodic `git fetch` updates the
staff repository's knowledge of origin and changes no file or branch.

## Status

Press **Talk** on an assistant and AAR starts a Claude Code session for them
in their office, so you can talk from the page; replies stream in, and when
they want to use a tool they wait for your Allow. Quit and come back and the
conversation resumes. Terminal sessions stay yours.

The lobby is a floor: every assistant stands on it with a name plate showing
their `Now` line (or their `Need from you` line, in red) and how long since
they were last heard. Figures fade after a day of silence and grey after a
week. Click one and the others recede while that assistant's status note,
deadlines, open items and recent log appear; the Chief of Staff also gets the
cross-office needs-you list. The older card grid is behind the Cards toggle.

Phases 1 to 6 of the plan: the reader, the JSON API, the live sources
(`claude agents --json` polling, session attribution, transcript tailing, git
status, the file watcher and the event stream), the lobby, the office view,
the Chief of Staff view with the printable morning sheet, and the hire wizard.
Phase 7 (`start.sh`, tuning, polish) is what remains of the MVP. The talk
layer (this branch) is the first step past it.
