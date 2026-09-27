# Proposal: a CLAUDE.md for the AAR repository

_Not adopted. Luke asked for the suggestion as a document rather than the
file itself. If adopted it would live at the repo root as `CLAUDE.md` and be
loaded by any Claude Code session started in the checkout._

## Why

A coding session on this repo currently starts with nothing: it does not
know the three-writes rule, that the floor replaced the cards, that dates
are local, or that decisions live in `blueprint/DECISIONS.md`. Alfred's
office has a `CLAUDE.md`; the app that made it does not.

## Proposed contents, about sixty lines

**What this is.** One paragraph: AAR, Administrative Assistant Robots, a
read-only local web page over a staff folder of Markdown offices and Claude
Code's own session list. This version watches; a later one will talk.

**Read first.** `README.md` for the shape, `docs/conventions.md` for the file
formats, `blueprint/DECISIONS.md` for every ruling and standing assumption.
When a line there contradicts the plan, the decisions file wins.

**Rules that must hold.**
- The app writes exactly three things: the staff folder on first run, a new office on hire, its own `aar.config.json`. Never a fourth without a decision recorded first. Never modify or delete a file the app did not create.
- Only GET, HEAD and OPTIONS are served, plus the three POSTs; everything else is 405 before any path is resolved.
- Every Mac-specific assumption lives in `server/lib/platform.js`.
- `server/lib/state.js` is pure; no I/O in it.
- Dates stamped into files are the local calendar day.
- Pronouns in copy and templates are they/them.
- Figures on the floor are never transparent.
- No runtime dependencies. Vendored files go in `public/vendor/` with their licence.

**Map of the code.** One line per module in `server/lib/` and `public/js/`,
lifted from each file's header comment, so a session can find the right
file without reading them all.

**How to test.** `npm test` (Node, fast, no install) and `npm run
test:browser` (Playwright, needs `npm install` and a Chrome). Run both before
pushing. The browser suite fails on any page error, so a console error is a
failure, not noise. Screenshots for the user come from a headless run
against `npm run demo`.

**How to work.** Ask before making changes, as Luke prefers. Present any new
guess as a line for `blueprint/DECISIONS.md` and add it there in the same
commit. Commit each phase or feature separately with a message that says
what changed and why. Never put a model name in a commit.

**What not to do.** Do not add a fourth write path, a folder picker, or any
process launching without a recorded decision. Do not restyle the floor or
the cards without showing a screenshot first.

## Open point

Whether the map of the code belongs in `CLAUDE.md` or in a `docs/architecture.md`
that `CLAUDE.md` points to. The header comments are the source either way.
