# The AA system as it stands — a memo for an agent designing an interface

_Written 2026-09-25 by Eric (Chief of Staff). Describes the system as built, not as planned._
_Repository: `cellear/aa-administrative-assistants`, private. 99 commits, 80 tracked files, ~9 MB._

---

## 1. What it is

Luke McCormick runs a staff of AI administrative assistants. **Each outside group he deals with gets an assistant**, so that before he talks to anyone from that group he can check with the assistant that covers it. That is his founding principle, from 2026-09-16.

The whole system is **a private git repository of Markdown files**. There is no application, no database, no server. An assistant *is* a folder plus a Claude Code session started in it.

**Luke's definition of an office: "a place where something gets done."** Resist the urge to derive a taxonomy from it.

---

## 2. Structure

One folder per office. Each contains:

| File | Role |
|---|---|
| `README.md` | Stable. What this office is for, who works in it, how it operates. |
| `briefing.md` | **What the assistant knows now. Edited in place, overwritten freely.** |
| `log.md` | **One entry per session, append-only, newest at the bottom. Never edited.** |
| `CLAUDE.md` | Startup instructions. Claude Code loads this automatically when a session opens in the folder. |
| `aa.conf` | Optional launch settings: `model`, `name`, `resume`, `add_dir`. |

**The briefing/log split is the core design idea.** Current state is mutable; history is append-only. A briefing that only accumulates becomes an archive nobody reads. A log that gets edited stops being evidence. Most systems put both in one file and get neither.

**Every assistant's memory is cleared between sessions. The folder is the memory.** This is deliberate, not a limitation — it forces the briefing to carry its weight.

Offices also hold whatever their work needs: `people.md` and a `people/` image folder (AI Community), `finances.md` (BADCamp), `timeline.md` / `story.md` / `projects.md` (Biography), `buffer-api.md` (BADCamp), draft posts (Marketing).

---

## 3. The roster, as of 2026-09-25

| Office | Assistant | Covers | Model |
|---|---|---|---|
| `Eric - Chief of Staff/` | **Eric Jr.** | Supervises the others, conventions, daily and weekly planning | Opus |
| `Prospects/` | **Holly** ("the Headhunter") | Potential employers *and* potential clients — the job hunt | Sonnet |
| `Marketing/` | **Maya** | Public presence: blog, websites, social media. Builds and deploys the sites. | Sonnet |
| `BADCamp/` | **Marissa** | BADCamp *and* SFDUG, including treasury | Sonnet |
| `Bluefly/` | **Katie** | Bluefly: the client relationship and a likely migration project | Sonnet |
| `Biography/` | **Walter** (for Isaacson) | The record of Luke's life and career. **Single source of truth for life facts.** | Sonnet |
| `AI Community/` | **Ivy** | Bay Area AI events and the people at them | Sonnet |

Plus **Erich**, Luke's father-figure assistant in Cowork, who holds memory of past claude.ai conversations, writes notes in `Erich/`, and **cannot commit** — his sandbox can't write to `.git`.

**Folders are offices; assistants are people.** The folder names the job; the assistant has a personal name used by Luke and Eric. Session titles combine both: `Holly - Headhunter`, `Walter - Biographer`.

---

## 4. How a session actually runs

**Two paths, and the difference matters for anything you build.**

**Terminal, on Luke's Mac.** An `aa-start` zsh function (copied to `Eric - Chief of Staff/aa-start.zsh` for reference) is run from inside an office folder. It reads `aa.conf`, saves any pending changes, and launches `claude --model <m> --name <n> [--add-dir <d>]`. It saves and pushes again when the session ends. **`resume=no` is the default, so every launch creates a new session.**

**Cloud** — Claude Code on the web, or the phone. The session starts at the repo root, and Luke's opening message names the assistant ("You are Holly…"). The root `CLAUDE.md` routes from there. **Cloud sessions see only what is committed.**

**Saving differs by path.** Terminal sessions are told not to run git — `aa-start` handles it. Cloud sessions commit and push to `main` themselves, with no approval step; git history is the safety net.

---

## 5. Storage and sync

- **GitHub `main` is canonical.** Everything of value must be committed.
- **`**/log.md merge=union`** in `.gitattributes`, so two sessions appending on the same day both survive instead of conflicting. Append-only files and union merges were made for each other.
- **`INCOMING/`** is gitignored. It is Luke's drop box for things an assistant can't fetch — transcripts, exports, pages behind a login. **A cloud session cannot see a file there until it is force-added** (`git add -f`), and *nothing warns when that is forgotten.*
- **`**/.claude/settings.local.json`** is gitignored and holds secrets (e.g. a Buffer API token).
- The repo currently lives in `~/Documents/AI-HOME/AA - Administrative Assistants`, **inside iCloud with Optimize Mac Storage on**. Evicted files hung `git status` twice. Mitigated by marking the folder "Keep Downloaded"; **a move to `~/Sites` with a shorter, space-free name is planned.**

---

## 6. Conventions an interface must not break

- **Logs are append-only.** Never edit or delete an entry. This is load-bearing.
- **Ask before making changes.** Every assistant's rule.
- **Never accept or decline anything on Luke's behalf** — not calendar invitations, not meetings. At most, remind him.
- **Route detail to the office that owns it.** Eric coordinates; the offices do the work.
- **Record a cross-office person once**, in their home office; others link rather than copy.
- **If a request looks meant for another assistant, ask.**
- **Assistants write only inside their own folder**, except where `add_dir` grants more (Maya has `~/Sites`, Walter has `~/Sites/GITHUB` read-only).

---

## 7. What is connected

- **Google Calendar** (read). Eighteen calendars; the ones that matter are `luke@kiza.com`, `luke.mccormick@bluefly.io` (**free/busy only — times without titles**), and **`lm2000@kiza.com`, where Luma event invitations land**, in full detail.
- **Gmail** for `elm20@kiza.com`, the job-hunt address (`elm18@` is an alias).
- **Buffer** (GraphQL) for LinkedIn scheduling. **One queue shared between BADCamp and Marketing** — the rule is read the queue before scheduling.
- Connectors are **account-wide, not folder-scoped**: any session can reach them, not only the office that set them up.

---

## 8. Known friction — the likeliest targets for an interface

1. **Terminals as life support.** Luke starts sessions in the terminal but interacts in the Mac desktop app, leaving terminal windows open solely to keep threads alive. `claude --bg` starts a session detached and returns an id (`claude agents|attach|logs|stop`) — **untested against the desktop app.**
2. **Every launch makes a new session** (`resume=no`), so each one lands ungrouped in the desktop app and has to be filed by hand.
3. **Sync friction.** A cloud push doesn't reach the Mac until Luke pulls, and nothing prompts him. Assistants have run against stale files.
4. **No cross-office view.** Nothing shows all seven offices' open items, deadlines or activity at once. Eric assembles a daily sheet by hand — Luke prints it, and it must fit one double-sided page.
5. **Capture is manual and lossy.** Luke loses meeting and event detail unless he debriefs an assistant immediately. **He also has difficulty recognising faces (self-identified prosopagnosia)**, so any people-facing surface should pair names with pictures. Google Meet's auto-generated Gemini summaries and screenshots of call grids are the best sources found so far.
6. **INCOMING's silent failure.** Forgetting `git add -f` means a cloud assistant never sees the file, with no warning.
7. **Session naming and grouping** are set at launch by `aa.conf` and adjusted by hand afterwards.

---

## 9. The rhythm

Eric writes a **morning sheet** (`Eric - Chief of Staff/mornings/YYYY-MM-DD.md`) — Luke prints it and keeps it beside the keyboard while working on screen. One double-sided page, hard limit. Sections: today's schedule, this week, today's plan with checkboxes, things only Luke can do, job-hunt status, and a reference footer. **Each evening the same file gets a close-out appended**, so one file holds the day's plan and its result.

---

## 10. Things worth knowing before designing anything

- **Luke prints things.** Paper is a real output format here, not a metaphor.
- **He works from the phone often**, which is why cloud sessions matter.
- **He prefers proportional fonts, light backgrounds and rich windowed interfaces over terminal aesthetics** — the terminal is where the work happens, not where he wants to live.
- **Markdown, human-readable, is non-negotiable.** The files must stay readable and editable by hand.
- **The system is about to be productized.** Luke committed on 2026-09-24 to packaging it for public download and local install, and has said so publicly. An interface should assume other people will run this, not only Luke.
