# The files AAR reads and writes

An office is one folder inside the staff folder. AAR reads a fixed set of
files in it and lists the rest by name without opening them. This page is
the reference for those files: what AAR expects, what it does with each, and
what it ignores. Assistants get the same rules in the managed block of their
`CLAUDE.md`.

## The staff folder

One folder, anywhere outside the AAR checkout, holding one subfolder per
office. A folder counts as an office only if it contains `aa.conf`. Hidden
folders and folders without that file are ignored, so the staff folder can
hold anything else you like.

Make it a git repository. Cloud sessions see only what is committed, and the
Unpushed and Behind badges read this repository's state.

## `aa.conf`

Plain `key=value` lines. `#` starts a comment. Unknown keys are kept aside
and ignored. Values may be quoted.

Launch keys, the same ones Luke's `aa-start` reads:

| Key | Meaning |
|---|---|
| `model` | Passed to `claude --model`. |
| `name` | Passed to `claude --name`. The assistant's short name is the part before ` - `, if any: `Holly - Headhunter` is Holly. |
| `resume` | `yes` adds `--continue` to the launch command. Default no. |
| `add_dir` | Passed to `claude --add-dir`. |

Roster keys, read by AAR only:

| Key | Meaning |
|---|---|
| `role` | The job title shown under the name. Defaults to the part of `name` after ` - `. |
| `avatar` | A starter-cast file name (`cast-01.png` … ). The cast is numbered, not named, so it suggests no name or role. Ignored when the office has its own `avatar.png`. Empty means a neutral silhouette. The nine original names (`eric.png`, `maya.png`, …) still work and are written back as the numbered file. |
| `accent` | A hex colour, `#5b7c99`, used for the office's edges and panels. |
| `order` | An integer. Offices with one sort by it, after the Chief of Staff; the rest follow alphabetically by name. |
| `cos` | `yes` on exactly one office: the Chief of Staff, first on the floor, with the cross-office view. |

## `status.md`

Three labelled lines. The floor shows them; nothing else in the file is read.

    Now: what you are doing or just did, one line
    Need from you: one line if the user must act, otherwise empty
    Next: what you plan to do next, one line

Labels are matched by name, in any order, case-insensitively. A missing line
is treated as empty. Whitespace after `Need from you:` counts as empty. A
file with none of the three labels counts as missing, and the floor falls
back to the transcript: the newest away summary, else the last message,
else "Nothing yet."

A non-empty `Need from you` lights the pin on the floor, turns the plate's
summary red, and puts the line on the Chief of Staff's Needs-you tab.

## `briefing.md`

What the assistant knows now. Overwritten freely. AAR splits it into cards
on `##` headings only; `#` and `###` stay inside their section. Text before
the first `##` is a preamble card.

Four headings get special treatment; any others render as plain Markdown:

| Heading | What AAR does |
|---|---|
| `## Key facts` | Plain Markdown, recognised so the wizard can seed it. |
| `## People` | Renders inline images as small round thumbnails and shows every picture in a `people/` subfolder beside the text, captioned from the file name (`ada-lovelace.jpg` becomes Ada Lovelace). Image links written as `people/x.jpg` resolve to that folder. |
| `## Upcoming deadlines` | Each bullet's first date is found and the bullets sort by it, dated first, undated after. The Chief of Staff's Deadlines tab merges every office's bullets on one timeline. |
| `## Open items` | `- [ ]` and `- [x]` render as checkboxes. Unchecked ones appear on the Chief of Staff's Open items tab. Plain bullets are kept with a dotted box. |

Date forms recognised in a bullet: `2026-09-27`, `9/27` or `Mon 9/27`
(optionally with a year), `Sept 28`, `Sep. 28`, `28 September`, `October
3rd, 2027`. A date without a year is this year, unless that would put it
more than sixty days in the past, in which case next year.

## `log.md`

One entry per session, appended at the bottom, never edited. Two entry
styles are recognised, and either may carry a title after the date:

    ## 2026-09-27 Two replies
    - Drafted two replies for Ada.

    **2026-09-27** Two replies
    - Drafted two replies for Ada.

Text until the next date marker belongs to the entry. The office page shows
a timeline grouped by day, newest first, collapsed after five entries. The
file's title and any notes above the first dated entry are not shown once
dated entries exist.

`log.md` also feeds "last heard": the newest of its modification time, the
`status.md` modification time, and the last transcript message.

## `README.md`

What the office is for. Shown collapsed on the office page as "About this
office". Not otherwise interpreted.

## `CLAUDE.md`

How the assistant behaves. Claude Code loads it when a session starts in the
folder. AAR does not read it, but the wizard writes it with a managed block
between `<!-- aar:start -->` and `<!-- aar:end -->` that teaches the rules on
this page. Everything outside the block is yours.

## Pictures

| File | Use |
|---|---|
| `avatar.png` | The standee. Transparent PNG, about 340 px tall, no wider than 260. Overrides the `avatar=` key. |
| `face.png` | Optional waist-up picture, shown where figures are small: the floor's everyone view and the pickers. Focus mode and the office page use the standee. Falls back to the standee. Cast pictures carry their own as `cast-NN-face.png`. |
| `office.png` | The office page's background scene, 16:9, at least 1600 px wide, washed with paper so the cards stay readable. Optional. |
| `people/*.png`, `.jpg`, `.gif`, `.webp` | Pictures for the People section, captioned from the file name. |

`avatar-prompts.md`, written by the wizard, holds style-locked prompts for
the first two so new pictures match the starter cast.

### Cutting out a generated picture

A generated standee usually comes on a white or flat background, at any
size, sometimes with a name and role printed under the feet. The avatar
command turns it into a cast picture: transparent, 336 px tall, at most 260
wide, caption cropped, matching the rest of the cast.

    npm run avatar -- picture.png                 into assets/avatars/ as the next cast-NN.png
    npm run avatar -- --to ~/aar-staff/Prospects --name avatar picture.png
    npm run avatar -- --check picture.png         previews only, into ./avatar-previews/

`--split` cuts a sheet of figures standing side by side into one picture
each; `--no-caption` skips the caption crop; `--tolerance <n>` widens or
narrows what counts as background (default 28 of 255); `--force` overwrites.
It never overwrites otherwise. PNG and JPEG in; PNG out.

## `mornings/` (Chief of Staff only)

One file per day, `YYYY-MM-DD.md`. The newest by name is the Morning sheet
tab on the cross-office view, printable on one double-sided Letter page.
`- [ ]` lines print as checkboxes.

## Everything else

Any other file or folder in an office is listed by name in the office page's
sidebar and never opened. `people.md`, `finances.md`, drafts, `INCOMING/`:
all yours.

## What AAR writes

Three things only, and never into a file it did not create:

1. The staff folder, on the first-run screen: the folder if it is missing, and a `Chief of Staff/` office inside it from `template/chief-of-staff/`. Refused if that office already exists.
2. A new office folder, from the hire wizard, from `template/office/`. Refused if the folder exists.
3. `aar.config.json` in the app folder: the staff folder path, port and tuning. `npm run reset` removes it.

The optional periodic `git fetch` in the staff folder updates the
repository's record of origin. It changes no file and no branch.

## Settings (`aar.config.json`)

| Key | Default | Meaning |
|---|---|---|
| `staffDir` | `~/aar-staff` | The staff folder. Set on the first-run screen or by clicking the path in the header. |
| `port` | `3111` | The local port. |
| `brand` | `AAR` | The name shown everywhere. |
| `pollMs` | `5000` | How often the live session list is polled and snapshots rebuilt. |
| `stuckMs` | `900000` | Busy longer than this (fifteen minutes) is flagged Stuck. |
| `gitFetchMs` | `300000` | How often to `git fetch` the staff repo. `0` disables it. |
| `models` | `opus, sonnet, haiku` | The choices offered by the hire wizard. |

Environment overrides for one run: `AAR_CONFIG` (another settings file),
`AAR_STAFF_DIR`, `AAR_PORT` (`0` picks a free port), `AAR_NO_OPEN=1` (do
not open the browser), `AAR_TRANSCRIPT_ROOT` and `AAR_CLAUDE_BIN` (used by
the tests).
