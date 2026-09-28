'use strict';
/* status.js: the assistant's own three-line status.

       Now: <one line>
       Need from you: <one line or empty>
       Next: <one line>

   The labels are matched by name, so a missing line, an extra line, Windows
   line endings, or lines in the wrong order do not break the read. Anything
   that is not one of the three labelled lines is ignored. A file with none of
   the labels parses as null, the same as a missing file, so the transcript
   fallback applies. */

const LABELS = [
  { key: 'now', re: /^now\s*:\s*(.*)$/i },
  { key: 'need', re: /^need\s+from\s+you\s*:\s*(.*)$/i },
  { key: 'next', re: /^next\s*:\s*(.*)$/i }
];

function parseStatus(text) {
  if (text === null || text === undefined) return null;
  const lines = String(text).split(/\r?\n/);
  const out = { now: '', need: '', next: '' };
  const seen = new Set();
  for (const raw of lines) {
    const line = raw.trim();
    for (const { key, re } of LABELS) {
      if (seen.has(key)) continue;
      const m = re.exec(line);
      if (m) {
        out[key] = m[1].trim();
        seen.add(key);
        break;
      }
    }
  }
  return seen.size === 0 ? null : out;
}

module.exports = { parseStatus };
