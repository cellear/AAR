# AAR

A read-only local web dashboard for a staff of AI administrative assistants.
Each assistant is a folder of Markdown plus a Claude Code session started in
it; AAR is the window onto them. It reads files, never runs a session, and
writes nothing except a new office folder when you hire.

The design is in `blueprint/aar-interface-mvp/plan-aar-interface-mvp.md`.
The system it generalises is described in `aa-system-memo.md`.

## Quick start

Needs Node 22. No dependencies to install.

    npm start

On first start the app writes `aar.config.json` with defaults (staff folder
`~/aar-staff`, port 3111) and opens `http://localhost:3111/`. If the staff
folder has no office yet, the page offers to create one: a single Chief of
Staff office copied from `template/chief-of-staff/`. Give the assistant a name,
then start a session in the new folder:

    cd ~/aar-staff/"Chief of Staff" && claude --model opus --name "Casey - Chief of Staff"

Environment overrides, mostly for tests: `AAR_CONFIG` (path to the config
file), `AAR_STAFF_DIR`, `AAR_PORT`, `AAR_NO_OPEN=1` (do not open the browser).

    npm test

## What AAR reads

A folder directly under the staff folder is an office if it contains `aa.conf`.
In each office AAR reads only these files and lists the rest by name:

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
    GET  /api/events             SSE: an init frame, then office / frontDesk / git / staff / stale frames
    GET  /avatars/<folder>/avatar.png, /avatars/<folder>/office.png, /avatars/cast/<file>
    POST /api/setup              first run only: create the staff folder

Every other method is answered 405 before any path is resolved.

## Status

Phases 1 and 2 of the plan: the reader, the JSON API, and the live sources
(`claude agents --json` polling, session attribution, transcript tailing, git
status, the file watcher and the event stream). The lobby, the office view,
the Chief of Staff view and the hire wizard are the phases that follow.
