'use strict';
/* git.js: is the staff repo ahead of or behind origin, and is it dirty? One
   `git status -sb` answers all three. An optional `git fetch` on a timer lets
   Behind appear without the user pulling. Nothing here changes the tree. */

const { execFile } = require('child_process');

const TIMEOUT_MS = 8000;

/* Parse `git status -sb` output. The first line is
   `## main...origin/main [ahead 1, behind 2]`; with no upstream it is just
   `## main`. Every other line is a changed file. */
function parseStatus(text) {
  const lines = String(text || '').split(/\r?\n/).filter((l) => l.length > 0);
  const head = lines[0] || '';
  const out = { branch: '', upstream: '', ahead: 0, behind: 0, dirty: false, repo: true };
  const fresh = /^## No commits yet on (\S+)/.exec(head);
  if (fresh) out.branch = fresh[1];
  const m = /^## (\S+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(head);
  if (m) {
    out.branch = m[1];
    out.upstream = m[2] || '';
    const flags = m[3] || '';
    const a = /ahead (\d+)/.exec(flags);
    const b = /behind (\d+)/.exec(flags);
    if (a) out.ahead = Number(a[1]);
    if (b) out.behind = Number(b[1]);
  }
  out.dirty = lines.slice(1).some((l) => !l.startsWith('##'));
  return out;
}

function run(args, cwd) {
  return new Promise((resolve) => {
    try {
      execFile('git', args, { cwd, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
      });
    } catch {
      resolve({ ok: false, stdout: '', stderr: '' });
    }
  });
}

/* Null when the staff folder is not a git repo (or git is missing). */
async function status(dir) {
  const r = await run(['status', '-sb', '--porcelain=v1'], dir);
  if (!r.ok) return { repo: false, branch: '', upstream: '', ahead: 0, behind: 0, dirty: false };
  return { ...parseStatus(r.stdout), fetchedAt: null };
}

async function fetch(dir) {
  const r = await run(['fetch', '--quiet'], dir);
  return r.ok;
}

module.exports = { parseStatus, status, fetch };
