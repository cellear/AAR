'use strict';
/* launch.js: the command the user pastes into a terminal to open an office's
   session. AAR never starts a process; it builds the same command aa-start
   would, from aa.conf, and the page copies it to the clipboard. When a live
   session already exists the command is `claude attach <id>` for a background
   session, or a note that it is open in a terminal window. */

const platform = require('./platform');

function shellQuote(s) {
  return `"${String(s).replace(/(["\\$`])/g, '\\$1')}"`;
}

/* `office` is a snapshot from state.js (it carries `launch` and `session`). */
function launchCommand(office) {
  const live = office.session;
  if (live) {
    if (live.kind === 'background') {
      return { kind: 'attach', command: `${platform.claudeBinary()} attach ${live.id}`, note: `${office.name} is running in the background; attach to talk to them.` };
    }
    return { kind: 'open', command: null, note: `${office.name}'s session is open in a terminal window.` };
  }
  const l = office.launch || {};
  const parts = [platform.claudeBinary()];
  if (l.model) parts.push('--model', l.model);
  if (l.name) parts.push('--name', shellQuote(l.name));
  if (l.addDir) parts.push('--add-dir', shellQuote(l.addDir));
  if (l.resume) parts.push('--continue');
  return { kind: 'start', command: `cd ${shellQuote(office.folder)} && ${parts.join(' ')}`, note: null };
}

module.exports = { launchCommand, shellQuote };
