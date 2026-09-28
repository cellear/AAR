'use strict';
/* state.js: pure derivation. Given what the readers found for one office
   (its aa.conf, its files, a live session, a transcript summary, git status)
   and the clock, build the snapshot the page shows. No I/O here, so the rules
   for the bubble, the liveness dot, "last heard" and every badge can be tested
   with inline fixtures. Also the cross-office roll-up for the Chief of Staff. */

const md = require('./markdown');
const { parseStatus } = require('./status');
const { localISODate, addDays } = require('./dates');
const { castFile } = require('./cast');

const NOTHING_YET = 'Nothing yet.';
const MAX_BUBBLE = 160;

/* The first sentence of a message, cut to a readable length. */
function oneSentence(text) {
  const flat = String(text || '').replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const m = /^(.*?[.!?])(?:\s|$)/.exec(flat);
  let out = m ? m[1] : flat;
  if (out.length > MAX_BUBBLE) out = out.slice(0, MAX_BUBBLE - 1).replace(/\s+\S*$/, '') + '…';
  return out;
}

/* Bubble text, in order of preference: status.md's Now line, the newest away
   summary, the last assistant text as one sentence, or "Nothing yet." */
function bubbleFor(status, transcript) {
  if (status && status.now) return { text: status.now, source: 'status' };
  if (transcript && transcript.awaySummary) return { text: oneSentence(transcript.awaySummary), source: 'away' };
  if (transcript && transcript.lastText) return { text: oneSentence(transcript.lastText), source: 'transcript' };
  return { text: NOTHING_YET, source: 'none' };
}

/* busy (green), idle (amber), none (grey). */
function livenessFor(session) {
  if (!session) return 'none';
  return session.status === 'busy' ? 'busy' : 'idle';
}

function newest(...stamps) {
  let best = null;
  for (const s of stamps) {
    if (!s) continue;
    const t = Date.parse(s);
    if (!Number.isFinite(t)) continue;
    if (best === null || t > best) best = t;
  }
  return best === null ? null : new Date(best).toISOString();
}

function isApiError(text) {
  return /^\s*API Error/i.test(String(text || ''));
}

/* The badge rules. `git` is the staff repo's state, shared by every office. */
function badgesFor({ status, transcript, session, git, now, stuckMs }) {
  const badges = [];
  if (status && status.need && status.need.trim()) badges.push('needsYou');
  if (git && git.ahead > 0) badges.push('unpushed');
  if (git && git.behind > 0) badges.push('behind');
  let stuck = false;
  if (transcript && isApiError(transcript.lastText)) stuck = true;
  if (session && session.status === 'busy') {
    const since = Date.parse(session.busySince || session.startedAt || '');
    if (Number.isFinite(since) && now.getTime() - since > stuckMs) stuck = true;
  }
  if (stuck) badges.push('stuck');
  return badges;
}

function sectionItems(kind, body, now) {
  if (kind === 'deadlines') return md.deadlineItems(body, now);
  if (kind === 'openItems') return md.checkboxItems(body);
  if (kind === 'people') return md.imageLinks(body);
  return [];
}

function briefingFor(text, now) {
  if (text === null || text === undefined) return null;
  const sections = md.splitSections(text).map((s) => {
    const kind = s.heading === null ? 'preamble' : md.sectionKind(s.heading);
    return { heading: s.heading, kind, markdown: s.body, items: sectionItems(kind, s.body, now) };
  });
  return { sections };
}

function avatarFor(office, files) {
  if (files.images.avatar) return { source: 'office', url: `/avatars/${encodeURIComponent(office.id)}/avatar.png` };
  if (office.conf.avatar) return { source: 'cast', url: `/avatars/cast/${encodeURIComponent(castFile(office.conf.avatar))}` };
  return { source: 'none', url: null };
}

/* One office's snapshot. `session` is the newest live session attributed to
   the office; `sessions` any others. `transcript` is the transcript reader's
   summary. All three, and `git`, may be null before phase 2 fills them in. */
function buildOfficeSnapshot({ office, files, session = null, sessions = [], transcript = null, git = null, now = new Date(), stuckMs = 15 * 60000 }) {
  const status = parseStatus(files.status);
  const bubble = bubbleFor(status, transcript);
  const lastHeard = newest(files.mtimes.status, transcript && transcript.lastAt, files.mtimes.log);
  return {
    id: office.id,
    folder: office.folder,
    name: office.name,
    role: office.conf.role,
    model: office.conf.model,
    accent: office.conf.accent,
    avatar: avatarFor(office, files),
    officeImage: files.images.office ? `/avatars/${encodeURIComponent(office.id)}/office.png` : null,
    cos: office.conf.cos,
    launch: { name: office.conf.name, model: office.conf.model, resume: office.conf.resume, addDir: office.conf.addDir },
    bubble,
    status,
    session,
    sessions,
    lastHeard,
    liveness: livenessFor(session),
    badges: badgesFor({ status, transcript, session, git, now, stuckMs }),
    briefing: briefingFor(files.briefing, now),
    readme: files.readme,
    log: files.log === null ? null : md.logEntries(files.log),
    files: files.files,
    people: files.people,
    mornings: files.mornings,
    mtimes: files.mtimes,
    git
  };
}

/* The Chief of Staff's roll-up over every office snapshot. */
function buildRollup({ snapshots, cos = null, now = new Date(), horizonDays = 14 }) {
  const needs = [];
  const deadlines = [];
  const openItems = [];
  const staff = [];
  for (const s of snapshots) {
    if (s.status && s.status.need && s.status.need.trim()) needs.push({ office: s.id, name: s.name, text: s.status.need });
    for (const section of (s.briefing ? s.briefing.sections : [])) {
      if (section.kind === 'deadlines') for (const item of section.items) deadlines.push({ office: s.id, name: s.name, text: item.text, date: item.date });
      if (section.kind === 'openItems') {
        const open = section.items.filter((i) => i.checked === false).map((i) => i.text);
        if (open.length) openItems.push({ office: s.id, name: s.name, items: open });
      }
    }
    staff.push({ office: s.id, name: s.name, role: s.role, model: s.model, liveness: s.liveness, lastHeard: s.lastHeard, badges: s.badges, bubble: s.bubble });
  }
  const today = localISODate(now);
  const horizon = localISODate(addDays(now, horizonDays));
  const bucket = (d) => (!d.date ? 3 : d.date < today ? 0 : d.date <= horizon ? 1 : 2);
  deadlines.sort((a, b) => bucket(a) - bucket(b) || (a.date && b.date ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) : 0));
  const morningSheet = cos && cos.mornings && cos.mornings.length
    ? { office: cos.id, file: cos.mornings[0], path: `${cos.folder}/mornings/${cos.mornings[0]}` }
    : null;
  return { needs, deadlines, openItems, staff, morningSheet, horizon: { from: today, to: horizon } };
}

module.exports = { NOTHING_YET, oneSentence, bubbleFor, livenessFor, newest, isApiError, badgesFor, briefingFor, buildOfficeSnapshot, buildRollup };
