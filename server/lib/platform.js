'use strict';
/* platform.js: THE Mac boundary. Every assumption about where things live on
   the machine sits here so a later host (a Mac wrapper, Drupal Forge, a phone)
   changes one file. Nothing else in the server touches os.homedir() or the
   Claude Code folder layout. */

const os = require('os');
const path = require('path');

function homeDir() {
  return process.env.AAR_HOME || os.homedir();
}

function isMac() {
  return process.platform === 'darwin';
}

/* The Claude Code binary; on the user's PATH by default. */
function claudeBinary() {
  return process.env.AAR_CLAUDE_BIN || 'claude';
}

/* Claude Code keeps one folder of session transcripts per working directory. */
function transcriptRoot() {
  return process.env.AAR_TRANSCRIPT_ROOT || path.join(homeDir(), '.claude', 'projects');
}

/* The folder name Claude Code uses for a cwd: every character that is not a
   letter or digit becomes a dash. `/Users/luke/aar-staff/Prospects` becomes
   `-Users-luke-aar-staff-Prospects`. */
function bucketNameForCwd(cwd) {
  return String(cwd).replace(/[^A-Za-z0-9]/g, '-');
}

function transcriptDirForCwd(cwd) {
  return path.join(transcriptRoot(), bucketNameForCwd(cwd));
}

/* Where the Agent SDK should find Claude Code. Empty means the SDK's own
   bundled build; AAR_CLAUDE_BIN points it at the installed one instead. */
function sdkExecutable() {
  return process.env.AAR_CLAUDE_BIN || '';
}

/* The command that opens a URL in the default browser, for start.sh and npm start. */
function openCommand(url) {
  if (isMac()) return ['open', [url]];
  if (process.platform === 'win32') return ['cmd', ['/c', 'start', '', url]];
  return ['xdg-open', [url]];
}

module.exports = { homeDir, isMac, claudeBinary, sdkExecutable, transcriptRoot, bucketNameForCwd, transcriptDirForCwd, openCommand };
