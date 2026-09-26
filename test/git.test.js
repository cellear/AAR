'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const git = require('../server/lib/git');

test('parseStatus: ahead, behind, both, none, no upstream, dirty', () => {
  assert.deepEqual(git.parseStatus('## main...origin/main [ahead 1]\n'), { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, dirty: false, repo: true });
  assert.equal(git.parseStatus('## main...origin/main [behind 3]').behind, 3);
  const both = git.parseStatus('## main...origin/main [ahead 2, behind 3]\n M Prospects/log.md\n?? new.md\n');
  assert.equal(both.ahead, 2);
  assert.equal(both.behind, 3);
  assert.equal(both.dirty, true);
  assert.deepEqual(git.parseStatus('## main...origin/main\n'), { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, dirty: false, repo: true });
  const none = git.parseStatus('## main\n');
  assert.equal(none.upstream, '');
  assert.equal(none.ahead, 0);
  assert.equal(git.parseStatus('## No commits yet on main\n').branch, 'main');
  assert.equal(git.parseStatus('').branch, '');
});

test('status on a non-repo reports repo: false', async () => {
  const s = await git.status(require('os').tmpdir());
  assert.equal(s.repo, false);
});
