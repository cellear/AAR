# Plan: AAR interface MVP

_Written 2026-09-26 by claude-fable-5-1 (blueprint session "building an interface to AAR")._
_Reference material: `INCOMING/` holds Luke's staff repo and eight related repos, all on GitHub. See the appendix "Reference repositories" at the end for addresses, summaries, and when each is worth consulting. The lineage is ams-trio → 3mt-avatars (avatar panels, SSE, file watching), ams-monitor (read-only window, no-write server), muse-monitor (read the tool's own logs), AMS/INTERFACE (floor plan, standees, Done/Next/Blockers bubble)._

## Refined prompt

> AAR interface: a read-only, Mac-only local web dashboard for a staff of AI administrative assistants (lobby with avatars and speech bubbles, per-office full-screen view, Chief of Staff cross-office view, hire wizard with avatar pipeline)
> * `00-AAR` is the app, separate from any staff folder. It points at a configured staff folder and ships a template Chief of Staff office that it copies into a new staff folder on first run.
> * A folder counts as an office only if it contains an `aa.conf`; the launch settings file is the roster, and everything else is ignored.
> * A live session is attributed to an office by its working directory first, then by matching the session's display name against the assistant's name in `aa.conf`; unmatched root-level sessions are listed separately as the "front desk."
> * Each office's `status.md` holds three labelled lines in fixed order (`Now:`, `Need from you:`, `Next:`); the bubble shows `Now`, a non-empty `Need from you` lights the needs-you badge, anything else is ignored, and the transcript's away summary is the fallback when the file is absent.
> * Office cards also flag unpushed local commits, a Mac that is behind origin, and a live session whose last message is an error or that has been busy unusually long; INCOMING is Luke's own convention, not AAR's, and AAR reads only its own files and leaves the rest of an office folder to the user's conventions.
> * The Chief of Staff's cross-office view rolls up every office's deadlines, open items, flags and last-heard; the morning sheet stays the Chief of Staff's own work, rendered by the app as a printable page from his latest `mornings/*.md`. Assistants flag what the Chief of Staff should raise with the user, and he respects those flags but may also go into any office and surface more.
> * The hire wizard writes the new office folder (`aa.conf`, `README.md`, `briefing.md`, `log.md`, `CLAUDE.md`, `status.md`) and a text file of style-locked image prompts; background removal and resizing is deferred to a later phase, and the MVP uses the starter cast or whatever image file the user places in the office.
> * AAR starts from a blank slate: Luke's existing seven-office staff is the model and inspiration, not a migration target, and no backwards compatibility with it is required.
> * Testing is automated checks on the reader and state derivation using small inline fixtures only; the demo is whatever staff Luke builds first.

Decisions made in conversation before the Q&A, carried into this plan:
* Watch first. The app reads files, `claude agents --json`, and Claude Code's own session transcripts. It runs no assistant sessions itself. In-page chat comes later.
* Mac-only for the MVP. The long-term direction is hosting on Drupal Forge / DevPanel, so the browser talks to the server only over HTTP and SSE, and every Mac-specific assumption sits in one module.
* The office view is metaphorical: text and headings get the space, in a warm illustrated style (paper, ink, pinned cards, sticky notes), with an optional generated background scene behind the assistant's standee.
* A starter cast of avatars ships with the app. Users can add their own; the app helps with prompts now and with image processing later.
* Assistants write their own bubble text. The Chief of Staff gets a cross-office view.
* The product is called "AAR" for now and may be rebranded; the name lives in one config value.

## Overview

* **One window onto the staff.** A local web page shows every assistant as an avatar with a speech bubble, who is awake, who needs the user, and what is out of sync. Clicking an assistant opens her office full-screen. The Chief of Staff's office adds a roll-up across every office.
* **Read-only by design, with one exception.** The server has no write endpoint except the hire wizard, which creates a new office folder from a template. Everything else is a GET or an SSE stream. This is the ams-monitor rule: a window, not a control panel.
* **No activity contract to fork.** 3mt-avatars had to fork Three Man Team so roles would narrate. AAR does not, because Claude Code already leaves the traces: `claude agents --json` gives the live roster and idle/busy state, and each session's transcript carries the last assistant message and an "away summary" in the assistant's voice. `status.md` is the assistant's own, sharper version of the same thing, and the transcript is the fallback.
* **AAR owns a small set of files and ignores the rest.** In each office it reads `aa.conf`, `README.md`, `briefing.md`, `log.md`, `status.md`, `avatar.png` and `office.png`, and in the Chief of Staff's office also `mornings/`. Anything else in the folder belongs to the user's own conventions.
* **Blank slate.** First run creates a staff folder with a single Chief of Staff office from the shipped template. The user hires the rest through the wizard. Luke's existing staff is the model, not a migration target.
* **Stack.** Node 22, no runtime dependencies (Node's `http` module, as in ams-monitor's `serve.js`), SSE, vanilla JS with no build step, one vendored Markdown renderer. A `start.sh` launcher like 3mt-avatars'. A Mac app wrapper and remote hosting are later phases and do not change the page.

## Expected behavior

**Launch and first run**
* `./start.sh` checks for Node, starts the server on the configured port (default 3111), and opens the browser. `npm start` does the same without the console.
* `aar.config.json` in the app folder holds `staffDir`, `port`, `brand`, and tuning values (poll interval, stuck threshold, git fetch interval). If it is missing, the app writes defaults.
* If `staffDir` does not exist or contains no office, the page shows a first-run screen: confirm or change the staff folder path, then "Create staff." The app creates the folder, copies the template Chief of Staff office into it, and offers the command to `git init` it. The lobby then shows one card.
* The Chief of Staff's template name is a placeholder the user is invited to change in the wizard on first run. The name is written into `aa.conf`, `README.md` and `CLAUDE.md`.

**Lobby**
* One pinned card per office, Chief of Staff first, the rest in `aa.conf` order key `order=` if present, otherwise alphabetical.
* Each card shows the standee (`avatar.png` in the office, else the starter-cast image named in `aa.conf`, else a neutral silhouette), the assistant's name and role, a speech bubble, a "last heard" ticker, a liveness dot, and badges.
* The bubble text is, in order of preference: the `Now:` line of `status.md`; the most recent away summary in the office's transcript; the last assistant text in the transcript, truncated to one sentence; or "Nothing yet."
* The liveness dot is green when a live session for the office reports `busy`, amber when `idle`, grey when no session is running. The ticker says "last heard 12m ago" from the newest of `status.md` mtime, the last assistant message timestamp, and `log.md` mtime.
* Badges: **Needs you** when `Need from you:` is non-empty; **Unpushed** when the staff repo is ahead of origin; **Behind** when it is behind origin; **Stuck** when the last assistant message begins with "API Error" or the session has been `busy` longer than the stuck threshold (default 15 minutes).
* A **front desk** strip under the cards lists live sessions whose cwd is the staff folder root or an unknown subfolder and whose name matches no assistant. Each shows its name, status and cwd.
* A header shows the brand, the staff folder, the count of offices, the count needing the user, the last poll time, and a read-only pill. If the reader fails, the header turns stale and the last good state stays on screen.
* Cards flash briefly when their state changes.
* "Open her session" on a card copies a command to the clipboard: `cd "<office>" && claude --model <m> --name "<n>" [--add-dir <d>] [--continue]`, built from `aa.conf` the way `aa-start` builds it. If a live session exists for the office, the command is `claude attach <id>` for background sessions, or a note that the session is open in a terminal window. The app never starts a process.

**Office view** (`/office/<folder>`)
* Full-screen. `office.png` from the office folder is the background scene if present; otherwise a themed paper background. The standee stands at the lower left with the bubble beside it, showing all three `status.md` lines.
* The rest of the screen is pinned cards from `briefing.md`, one card per `##` section, in file order. Headings AAR recognises get special treatment: **People** renders any image links and a `people/` subfolder's pictures beside names; **Upcoming deadlines** sorts bullets by the first date found in each; **Open items** renders `- [ ]` and `- [x]` as checkboxes. Everything else renders as Markdown.
* `README.md` is a collapsed "About this office" card. `log.md` is a timeline, newest entry first, grouped by date, collapsed after the first five.
* A sidebar lists the office's other files by name, unopened, so the user knows what else is there without AAR interpreting it.
* The header carries the same badges as the card plus the launch button.

**Chief of Staff view** (`/cos`)
* Available for the office whose `aa.conf` has `cos=yes`. Its own office view has a "Cross-office" tab.
* **Needs you**: every office's `Need from you:` line, with the assistant's name and a link to her office.
* **Deadlines**: every bullet from every office's Upcoming deadlines section, merged on one timeline, next 14 days first, then undated, each tagged with its office.
* **Open items**: every unchecked box from every office's Open items section, grouped by office.
* **Staff table**: name, role, model, liveness, last heard, flags.
* **Morning sheet**: renders the newest file in the Chief of Staff's `mornings/` folder with a print stylesheet sized for one double-sided page. A "Print" button calls the browser's print dialog. If the folder is empty, the tab says so.

**Hire wizard** (`/hire`)
* A form: assistant name, office folder name, role title, what she covers (a paragraph), model (list from config), accent colour, starter avatar (thumbnails of the starter cast) or "I'll supply my own."
* On submit the server writes the office folder from `template/office/` with placeholders filled: `aa.conf` (model, name, role, accent, avatar, order), `README.md`, `briefing.md` with AAR's canonical headings, an empty-but-headed `log.md`, `CLAUDE.md` with the AAR block (read README, briefing, status and the tail of the log at start; keep `status.md` current; append to the log, never edit it; ask before changes; write only inside this folder), and `status.md` with the three labelled lines empty.
* It also writes `avatar-prompts.md` in the office: a style-locked prompt for the standee and one for the office background scene, ready to paste into an image generator, plus the file names and sizes AAR expects (`avatar.png`, transparent, about 340 px tall; `office.png`, 16:9).
* The wizard refuses to overwrite an existing folder. It is the app's only write path.

**Live updates**
* The server watches the staff folder and re-reads changed offices, polls `claude agents --json` every 5 seconds, and tails each attributed session's transcript from its last byte offset.
* Clients receive a full snapshot on connect, then per-office snapshot frames when something changes. Reconnects replace state wholesale.
* Git status is refreshed on file changes and on a timer; `git fetch` runs every 5 minutes if enabled in config, so **Behind** can appear without the user pulling.

## Implementation plan

Folder layout of `00-AAR/`:

```
README.md                    what AAR is, quick start, the file conventions
start.sh                     node check, start, open browser, q/o/s console
package.json                 name, scripts (start, test); no dependencies
aar.config.json              staffDir, port, brand, pollMs, stuckMs, gitFetchMs (written on first run if absent)
server/
  server.js                  http server: static, JSON API, SSE, the hire POST
  lib/config.js              load/write aar.config.json, defaults, path expansion (~)
  lib/platform.js            THE Mac boundary: home dir, claude binary, transcript root, transcript bucket name for a cwd
  lib/staff.js               discover offices (folders with aa.conf), parse aa.conf, identify the Chief of Staff, ordering
  lib/office.js              read README/briefing/log/status per office; mtimes; list other files
  lib/markdown.js            split ## sections, find dates in bullets, checkbox items, log entries by date
  lib/status.js              parse status.md (three lines, strict), tolerate missing/extra lines
  lib/sessions.js            run `claude agents --json`; attribute sessions to offices (cwd, then name); front desk
  lib/transcripts.js         find the transcript file for a session/cwd; tail from byte offset; extract away summaries and last assistant text/timestamp/model; detect API errors
  lib/git.js                 ahead/behind/dirty for the staff repo; optional fetch
  lib/state.js               pure: build the per-office snapshot (bubble, liveness, lastHeard, badges) and the cross-office roll-up
  lib/watch.js               fs.watch (recursive) + poll backstop + debounce, from 3mt-avatars
  lib/sse.js                 client set, snapshot on connect, per-office frames, slow-client eviction
  lib/hire.js                validate form, render template/office/ with placeholders, write folder, write avatar-prompts.md
  lib/launch.js              build the copy-to-terminal command from aa.conf (mirrors aa-start's argument logic)
public/
  index.html                 lobby
  office.html                office view
  cos.html                   Chief of Staff cross-office view + morning sheet tab
  hire.html                  wizard
  styles.css                 theme: paper, ink, accents, pinned cards, sticky notes, badges, liveness
  print.css                  one double-sided page for the morning sheet
  js/api.js                  fetch + EventSource with reconnect backoff
  js/lobby.js, office.js, cos.js, hire.js
  js/render.js               markdown() with sanitising, relTime(), badge and bubble helpers
  vendor/marked.min.js       vendored, pinned
assets/avatars/              starter cast: the nine AMS standees (cody, quinn, lila, eric, priya, derek, maya, stacey, scrum-master), transparent PNG, 336 px tall
template/
  chief-of-staff/            aa.conf, README.md, briefing.md, log.md, CLAUDE.md, status.md, mornings/.gitkeep
  office/                    same set with {{name}}, {{role}}, {{covers}}, {{model}} placeholders
  prompts/                   avatar-prompt.md, office-prompt.md (style-locked text with placeholders)
test/                        node:test files, inline fixtures
blueprint/                   this plan
INCOMING/                    reference clones, gitignored
```

Key data shapes:

* `aa.conf` (key=value, `#` comments). Launch keys as in Luke's system: `model`, `name`, `resume`, `add_dir`. AAR roster keys: `role` (display title), `avatar` (file name in the office or in the starter cast), `accent` (hex), `order` (integer), `cos=yes` on exactly one office. The assistant's short name is the part of `name` before ` - ` if present, else the whole value.
* `status.md`:
  ```
  Now: <one line>
  Need from you: <one line or empty>
  Next: <one line>
  ```
* Office snapshot (JSON, one per office): `{ id, folder, name, role, model, accent, avatar, cos, bubble: {text, source}, status: {now, need, next} | null, session: {id, kind, status, name, cwd, startedAt} | null, lastHeard, liveness, badges: [..], briefing: {sections:[{heading, html, kind, items}]}, readme, log: [{date, entries}], files: [..], git: {ahead, behind, dirty} }`.
* Cross-office roll-up: `{ needs: [..], deadlines: [..], openItems: [..], staff: [..], morningSheet: {path, html} | null }`.
* SSE frames: `{type:'init', staff, offices, frontDesk, git, polledAt}` then `{type:'office', office}`, `{type:'frontDesk', sessions}`, `{type:'git', git}`, `{type:'stale', reason}`.

API:
* `GET /api/staff` roster and config summary
* `GET /api/offices` all snapshots; `GET /api/offices/:id`
* `GET /api/cos` roll-up
* `GET /api/launch/:id` the copy-to-terminal command
* `GET /api/events` SSE
* `GET /avatars/:id/avatar.png`, `/avatars/:id/office.png`, `/avatars/cast/:file` images, served read-only with path checks
* `GET /api/hire/options` models, cast, next order number; `POST /api/hire` the one write path
* `POST /api/setup` first run only: create the staff folder from the template (refused once a staff exists)

Transcript reading (in `lib/transcripts.js`): the transcript bucket for a cwd is the cwd with every non-alphanumeric character replaced by `-`, under `~/.claude/projects/`. For a live session use the file named by its session id; otherwise the newest `.jsonl` in the bucket. Lines of interest: `type: "assistant"` (text blocks, `timestamp`, `message.model`), `type: "system"` with `subtype: "away_summary"` (`content`, `timestamp`), `type: "custom-title"` / `agent-name`. Read only complete lines from the last byte offset; on truncation, reset and reread. Unknown line types are ignored.

## Implementation phases

1. **Skeleton and reader.** Config, platform module, staff discovery, office reading, status parsing, state derivation, JSON API, and the first-run setup that creates a staff from the template Chief of Staff. Result: `curl /api/offices` returns real snapshots for a freshly created staff.
2. **Live sources.** `claude agents --json` polling, session attribution, transcript tailing, git status, the watcher, and SSE. Result: snapshots update within seconds of a file change or a session going busy, visible in the API and event stream.
3. **Lobby.** Theme, cards, bubbles, liveness, badges, front desk, stale header, launch button. Result: the page Luke will look at all day exists and is honest.
4. **Office view.** Section cards with the recognised headings, people pictures, log timeline, file sidebar, background scene. Result: click-through works for every office.
5. **Chief of Staff view and print.** Roll-up tabs and the morning-sheet print page. Result: the cross-office view and a printable sheet.
6. **Hire wizard and starter cast.** Form, template rendering, prompts file, cast thumbnails. Result: a new user can go from one Chief of Staff to a full staff without touching the terminal, except to talk.
7. **Polish and README.** Card flash, tuning values, the README that documents the file conventions, and `start.sh`.

Later, outside the MVP: avatar image processing (subject lift, trim, resize), "start in background" via `claude --bg`, in-page chat through the Agent SDK, expression sprites, a Mac wrapper, hosting on Drupal Forge / DevPanel, phone access.

## Testing strategy

Runner: `node --test` via `npm test`, no test dependencies. Fixtures are inline strings and temp directories created per test.

* **aa.conf parsing.** Comments, blank lines, unknown keys, missing name, short-name extraction from `Holly - Headhunter`, exactly-one `cos=yes`.
* **status.md parsing.** Happy path; missing file; missing line; extra lines; labels in the wrong order; Windows line endings. `Need from you:` with whitespace only counts as empty.
* **Markdown helpers.** Section splitting on `##` only; dates found in bullets in `YYYY-MM-DD`, `Mon 9/27` and `Sept 28` forms; checkbox detection; log entries grouped by `**YYYY-MM-DD**` and `## YYYY-MM-DD` styles.
* **Transcript extraction.** A fixture of a dozen JSONL lines covering assistant text, tool-use-only assistant turns, an away summary, an API error message, and an unknown type. Byte-offset tailing across two appends, and a truncation reset.
* **Session attribution.** cwd match; name match on a root session; no match to front desk; two sessions for one office picks the newest.
* **State derivation.** Bubble source order; liveness from session status; last-heard from the newest of three timestamps; every badge rule, including the stuck threshold.
* **Git parsing.** `git status -sb` lines for ahead, behind, both, and no upstream.
* **Hire.** Renders every template file with placeholders filled, refuses an existing folder, rejects a folder name with a slash, writes `avatar-prompts.md`.
* **Server.** Start on an ephemeral port against a temp staff folder; assert every route is GET except the two POSTs; POST to any other path returns 405; path traversal in image routes returns 404; the SSE stream sends `init` first and an `office` frame after a `status.md` write.
* **Manual checks each phase.** Open the page against a real staff, start an assistant in a terminal, watch the dot go green, write a `Need from you:` line, watch the badge; print the morning sheet to PDF and confirm it fits two pages.

## Open questions

**Assumptions made in this plan — to review with Luke on the first draft**
* Launch (Q10, unanswered): the MVP only copies a command to the clipboard. Starting sessions with `claude --bg` is deferred, keeping the app read-only apart from hiring.
* Zero runtime dependencies (Node `http`, not Express), one vendored Markdown renderer. Chosen to keep install to "have Node" and to make a Mac wrapper simpler.
* Default staff folder is `~/aar-staff` (no spaces, per the iCloud lesson). Default port 3111.
* AAR's roster metadata (`role`, `avatar`, `accent`, `order`, `cos`) lives in `aa.conf` alongside the launch keys, rather than in a second file.
* The Chief of Staff is marked by `cos=yes` in `aa.conf`; exactly one per staff.
* Office image file names are fixed: `avatar.png` and `office.png` in the office folder.
* AAR's canonical briefing headings are `## Key facts`, `## People`, `## Upcoming deadlines`, `## Open items`; other headings render as plain cards.
* `git fetch` runs on a timer (default every 5 minutes) so **Behind** shows without a manual pull; it can be disabled in config.
* The stuck threshold is 15 minutes of `busy`; "API Error" at the start of the last assistant message also counts.
* When several live sessions match one office, the card shows the newest and lists the rest in the office view.
* Cloud sessions are invisible except through git; the plan does not try to detect them.
* The morning sheet is the newest file by name in the Chief of Staff's `mornings/` folder.
* The starter cast is the nine AMS standees, reused as-is; a style-locked prompt for new ones is written to match them.

**Genuinely open**
* Should the transcript away summary be shown at all when `status.md` exists but `Now:` is stale, say older than the last assistant message by more than a day?
* How much of the template CLAUDE.md is AAR's, and how much is the user's? A marked block that AAR owns, with the rest free, is the likely answer.
* Whether the office view should render files AAR doesn't own (people.md, finances.md) as plain Markdown on request, or stay strictly to its own files.
* What the front desk should do with a session whose cwd is a subfolder of an office (Eric's `add_dir=..` case is the reverse and is fine).
* Rebranding: everything reads `brand` from config, but the folder name `aar-staff` and the `aa.conf` file name would survive a rename.

## Appendix: reference repositories

All are under https://github.com/cellear. `INCOMING/` is gitignored, so a cloud session does not have these clones; it can `git clone` any public one into a scratch folder if the summary below says it is worth it. Only the staff repo is private and needs the GitHub connection to include it. None is a dependency: the MVP can be built from this plan alone.

| Repo | Visibility | Last commit | One line |
|---|---|---|---|
| [aa-administrative-assistants](https://github.com/cellear/aa-administrative-assistants) | private | 2026-09-26 | Luke's live staff: seven offices of Markdown, the model AAR generalises |
| [3mt-avatars](https://github.com/cellear/3mt-avatars) | public | 2026-07-09 | Read-only avatar dashboard fed by per-role activity files; closest ancestor |
| [ams-monitor](https://github.com/cellear/ams-monitor) | public | 2026-09-09 | Read-only sprint-board page over an AMS repo; zero-dep local server |
| [ams-trio](https://github.com/cellear/ams-trio) | public | 2026-07-22 | One chat panel per avatar, each an Agent SDK session; the "talk" layer |
| [AMS](https://github.com/cellear/AMS) | public | 2026-08-24 | The methodology kit, plus static floor-plan and daily-scrum mockups and nine standees |
| [muse-monitor](https://github.com/cellear/muse-monitor) | public | 2026-08-17 | Go companion that tails Muse Code session logs; snapshot + merge-patch SSE |
| [pocket-dev-team](https://github.com/cellear/pocket-dev-team) | public | 2026-07-11 | iOS app + Node backend for the trio; early scaffold |
| [agent-scrum](https://github.com/cellear/agent-scrum) | public | 2026-04-27 | Markdown Scrum/Kanban convention; state lives in file names |
| [agent-trio-pattern](https://github.com/cellear/agent-trio-pattern) | public | 2026-05-24 | Librarian / Engineer / QA roles talking only through files |

**aa-administrative-assistants** (private). One folder per office with `README.md` (stable), `briefing.md` (current state, overwritten), `log.md` (append-only, newest at bottom), `CLAUDE.md` (startup), `aa.conf` (launch settings: `model`, `name`, `resume`, `add_dir`). `Eric - Chief of Staff/` holds `aa-start.zsh` (the launcher AAR's launch command mirrors), `aa-system-memo.md` (the memo this plan grew from), and `mornings/YYYY-MM-DD.md` (the printed sheet with an evening close-out appended). `AI Community/people.md` shows the people-with-pictures format. `.gitattributes` sets `**/log.md merge=union`. Consult it for: the shape of real briefings and logs when writing the Markdown helpers and the office view, the `aa-start` argument logic, and the morning-sheet layout for `print.css`. Not needed for phases 1, 2 or 6.

**3mt-avatars** (public). Node + Express + SSE + vanilla JS. `3mt-avatars/lib/watch.js` is the file watcher with debounce, re-arm after delete, and a 5-second poll backstop; `lib/activity.js` has the full-line-identity diff that tells an append from a rewrite; `server.js` shows the SSE init-then-frames pattern and a degraded mode; `public/app.js` has the liveness ticker, the "waiting on you" Owner card, chime, and sprite-sheet expressions (calibration constants at the top); `docs/activity-contract.md` is the narration grammar AAR's `status.md` replaces. Consult it for: phase 2 (watcher, SSE), phase 3 (ticker, badge behaviour), and later for expressions. Its README credits ams-trio as the visual ancestor.

**ams-monitor** (public). Vanilla JS, no build, one pinned `marked`. `serve.js` is a zero-dependency Node server, about 260 lines: GET/OPTIONS only with 405 otherwise, path-traversal and symlink defence (`resolveSafe`), `Cache-Control: no-store`, and a `/manifest.json` mtime token so the page polls cheaply. `js/frontmatter.js` (small safe YAML subset), `js/agents.js` (deterministic persona colours), `js/render.js` (sanitised `markdown()` and `relTime()`), `js/app.js` (refresh, diff, flash), `css/monitor.css` (status bar, stale state). `checks.html` runs 175 browser checks with no runner. Concept docs state the rules AAR adopts: a window not a control panel, files are the truth, a "needs you" queue is what the human is there to drain. `AMS/OFFICES/PROTOCOL.md` in its vendored kit defines `desk.md`, the same idea as `briefing.md`. Consult it for: phase 1 (`serve.js` as the server base), phase 3 (stale header, card flash, colours), phase 7 (a checks page if wanted).

**ams-trio** (public). Express + `@anthropic-ai/claude-agent-sdk`. `lib/sessions.js` runs one `query()` per avatar with `resume: sessionId`, composes the persona at runtime, and mirrors transcripts in `.sessions.json`. `DOC/sessions-and-cli.md` documents the non-obvious fact AAR's `lib/platform.js` depends on: Claude Code buckets transcripts under `~/.claude/projects/<cwd with non-alphanumerics as dashes>/`, so `claude --resume` only works from the same cwd. `HANDOFF/handoff-2026-07-23-connect-with-cli-claude.md` records the GUI/CLI divergence problem, which reading the transcript directly avoids. `assets/avatars/` has seven of the standees. Consult it for: phase 2 (transcript bucket rule), and the post-MVP chat layer.

**AMS** (public). The methodology, not an app. `kit/` is the installable protocol (`AGENT.md`, `OFFICES/_template/{desk,identity,working-notes,open-threads}.md`). `INTERFACE/floorplan.html`, `office.html`, `daily-scrum.html` are static mockups with inline CSS and hardcoded data: rooms with standees, click for a Role / Recently / Right Now bubble, and a Done / Next / Blockers bubble. `INTERFACE/avatars/` has the nine transparent standees (171 to 257 px wide, 336 px tall) that become AAR's starter cast, displayed with `object-fit: contain; object-position: bottom center`. `images/scrum-personas.jpeg` shows the illustration style. Consult it for: phase 3 and 4 (bubble and standee CSS), phase 6 (copy the nine PNGs into `assets/avatars/`).

**muse-monitor** (public). Go binary with an embedded Svelte front end; reads Muse Code JSONL logs. Two ideas transfer: tail from a byte offset reading only complete lines and rebuild on truncation (`internal/ingest/watcher.go`, `readonly_test.go` greps the source for write calls to enforce read-only); and SSE as one `snapshot` then RFC 7396 merge-patch `diff` frames with slow-client eviction (`internal/server/hub.go`, `web/src/lib/mergePatch.ts`, `web/src/stores/session.ts` with reconnect backoff 500 ms to 8 s). Its status rule "never infer state from prose, show confidence instead" is why AAR's badges come from `status.md` lines and session status, not from reading messages. Consult it for: phase 2 (transcript tailing, SSE robustness). Go code; do not port wholesale.

**pocket-dev-team** (public). Early scaffold, two commits. `backend/lib/sessions.js` is the same per-agent `query()` loop as ams-trio with a `.sessions.json` mirror; `backend/server.js` has a bearer-token middleware and a POST-response SSE stream; the iOS app is a thin SwiftUI client that parses SSE by hand. Known bugs: `tool_end` never fires, history entries lack an `id` the iOS model requires. Consult it for: the post-MVP chat and phone layers only. Not needed for the MVP.

**agent-scrum** (public). Markdown convention layered on agent-handoff: `SPRINTS/`, `EPICS/<epic>/{0-backlog,1-in-progress,2-finished}-<task>.md`, `LEARNINGS/`. State is the filename prefix; a rename is a transition. `wizard.md` adds an append-only `.scrum/events.csv` with an `actor` column. Consult it for: ideas only, if AAR later derives "what is she working on" from files. Not needed for the MVP.

**agent-trio-pattern** (public). Librarian / Engineer / QA, each a fresh session with a persona, communicating only through `SPECIFICATIONS/`, `QA/`, `HANDOFF/`. Decisions move from `D-XX` to `R-XX`; handoff filenames carry a role suffix; `specs-log.md` is newest-first. Consult it for: ideas only. Not needed for the MVP.
