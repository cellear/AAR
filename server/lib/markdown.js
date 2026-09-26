'use strict';
/* markdown.js: the little structure AAR reads out of Markdown. It does not
   render HTML; the page does that with the vendored renderer. It splits a
   briefing into `##` sections, finds dates in bullets, reads checkboxes, and
   groups log entries by date. */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/* AAR's canonical briefing headings. Anything else is a plain card. */
const SECTION_KINDS = [
  { kind: 'keyFacts', re: /^key\s+facts$/i },
  { kind: 'people', re: /^people$/i },
  { kind: 'deadlines', re: /^(upcoming\s+)?deadlines$/i },
  { kind: 'openItems', re: /^open\s+items$/i }
];

function sectionKind(heading) {
  const h = String(heading || '').trim();
  for (const { kind, re } of SECTION_KINDS) if (re.test(h)) return kind;
  return 'plain';
}

/* Split on `## ` headings only. `#` titles and `###` subheadings stay inside
   the section they fall in. Text before the first `##` is a preamble with a
   null heading, kept only when non-empty. Fenced code blocks are not split. */
function splitSections(md) {
  const lines = String(md || '').split(/\r?\n/);
  const sections = [];
  let current = { heading: null, lines: [] };
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (m) {
      sections.push(current);
      current = { heading: m[1].trim(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  return sections
    .map((s) => ({ heading: s.heading, body: s.lines.join('\n').replace(/^\n+|\n+$/g, '') }))
    .filter((s) => s.heading !== null || s.body.length > 0);
}

/* Top-level bullets of a section body, with continuation lines joined. */
function bullets(body) {
  const items = [];
  let current = null;
  for (const line of String(body || '').split(/\r?\n/)) {
    const m = /^\s{0,3}[-*+]\s+(.*)$/.exec(line);
    if (m) {
      current = { text: m[1].trim() };
      items.push(current);
    } else if (current && /^\s+\S/.test(line) && !/^\s*[-*+]\s+/.test(line)) {
      current.text += ' ' + line.trim();
    } else if (!line.trim()) {
      current = null;
    } else {
      current = null;
    }
  }
  return items;
}

/* `- [ ] text` and `- [x] text`. Plain bullets in the same section are
   returned too, with checked null, so nothing in an Open items list is lost. */
function checkboxItems(body) {
  return bullets(body).map((item) => {
    const m = /^\[([ xX])\]\s*(.*)$/.exec(item.text);
    if (!m) return { text: item.text, checked: null };
    return { text: m[2].trim(), checked: m[1] !== ' ' };
  });
}

function pad(n) { return String(n).padStart(2, '0'); }

function iso(y, m, d) {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/* A year for a month/day written without one. The current year, unless that
   puts the date more than 60 days behind today, in which case next year: a
   deadline written as "Sept 28" in December means the coming one. */
function inferYear(month, day, now) {
  const year = now.getUTCFullYear();
  const candidate = Date.UTC(year, month - 1, day);
  const sixtyDays = 60 * 86400000;
  return candidate < now.getTime() - sixtyDays ? year + 1 : year;
}

/* The first date in a line of text, as YYYY-MM-DD, or null. Forms:
   `2026-09-27`, `9/27` or `Mon 9/27` (month/day, optional year), and
   `Sept 28` or `28 Sept` (month name, optional year). */
function findDate(text, now = new Date()) {
  const s = String(text || '');
  let m;
  if ((m = /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/.exec(s))) {
    return iso(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(s))) {
    const month = Number(m[1]), day = Number(m[2]);
    let year = m[3] ? Number(m[3]) : inferYear(month, day, now);
    if (m[3] && m[3].length === 2) year += 2000;
    return iso(year, month, day);
  }
  const monthRe = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
  if ((m = new RegExp(`\\b${monthRe}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i').exec(s))) {
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1, day = Number(m[2]);
    const year = m[3] ? Number(m[3]) : inferYear(month, day, now);
    return iso(year, month, day);
  }
  if ((m = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${monthRe}(?:,?\\s+(\\d{4}))?\\b`, 'i').exec(s))) {
    const month = MONTHS.indexOf(m[2].toLowerCase()) + 1, day = Number(m[1]);
    const year = m[3] ? Number(m[3]) : inferYear(month, day, now);
    return iso(year, month, day);
  }
  return null;
}

/* Bullets of a deadlines section, each with the first date found, sorted
   dated-first ascending, then undated in file order. */
function deadlineItems(body, now = new Date()) {
  const items = bullets(body).map((item, index) => ({ text: item.text, date: findDate(item.text, now), index }));
  return items
    .sort((a, b) => {
      if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : a.index - b.index;
      if (a.date || b.date) return a.date ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ text, date }) => ({ text, date }));
}

/* Log entries grouped by date, newest first. Two styles start an entry:
   a `## 2026-09-25 ...` heading, or a line beginning `**2026-09-25**`. Text
   until the next date marker belongs to that entry. Text before the first
   marker (the file's title and notes) is dropped once any dated entry exists;
   a log with no markers at all is one undated entry, so nothing is hidden. */
function logEntries(md) {
  const lines = String(md || '').split(/\r?\n/);
  const entries = [];
  let current = { date: null, title: '', lines: [] };
  for (const line of lines) {
    let m = /^#{1,6}\s+(\d{4}-\d{2}-\d{2})\b\s*(.*?)\s*#*\s*$/.exec(line);
    if (!m) {
      const b = /^\s*(?:[-*]\s+)?\*\*(\d{4}-\d{2}-\d{2})\*\*\s*[:—–-]?\s*(.*)$/.exec(line);
      if (b) m = b;
    }
    if (m) {
      entries.push(current);
      current = { date: m[1], title: m[2] || '', lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  entries.push(current);
  const dated = entries.some((e) => e.date !== null);
  const cleaned = entries
    .map((e) => ({ date: e.date, title: e.title.trim(), body: e.lines.join('\n').replace(/^\n+|\n+$/g, '') }))
    .filter((e) => e.date !== null || (!dated && e.body.length > 0));
  const byDate = new Map();
  for (const e of cleaned) {
    const key = e.date || '';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push({ title: e.title, body: e.body });
  }
  return [...byDate.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([date, list]) => ({ date: date || null, entries: list.reverse() }));
}

/* Image links in a body: `![alt](src)` pairs. Used by the People section. */
function imageLinks(body) {
  const out = [];
  const re = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m;
  while ((m = re.exec(String(body || '')))) out.push({ alt: m[1], src: m[2] });
  return out;
}

module.exports = { SECTION_KINDS, sectionKind, splitSections, bullets, checkboxItems, findDate, inferYear, deadlineItems, logEntries, imageLinks };
