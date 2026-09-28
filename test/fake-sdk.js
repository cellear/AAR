'use strict';
/* A scripted SDK: query() records its options, reads user messages from the
   prompt iterable, and answers each with a scripted turn. */
function fakeSdk(script = {}) {
  const calls = [];
  const permissions = [];
  const sdk = {
    calls, permissions,
    query({ prompt, options }) {
      const call = { options, sent: [] };
      calls.push(call);
      let interrupted = false;
      const gen = (async function* () {
        yield { type: 'system', subtype: 'init', session_id: options.resume || 'sess-' + calls.length, model: options.model || 'claude-sonnet-5', cwd: options.cwd };
        for await (const u of prompt) {
          call.sent.push(u.message.content);
          const text = u.message.content;
          if (script.permissionFor && text.includes(script.permissionFor)) {
            const r = await options.canUseTool('Bash', { command: 'ls -la' }, { signal: new AbortController().signal, suggestions: [] });
            permissions.push(r);
            if (r.behavior === 'deny') { yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Understood, I will not run it.' }] }, parent_tool_use_id: null }; yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.01, num_turns: 1 }; continue; }
          }
          for (const piece of ['Hello ', 'from ', 'the fake.']) yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } }, parent_tool_use_id: null };
          yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Hello from the fake.' }, { type: 'tool_use', name: 'Read', input: { file_path: 'briefing.md' } }] }, parent_tool_use_id: null };
          if (script.errorFor && text.includes(script.errorFor)) yield { type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] };
          else yield { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.02, num_turns: 1 };
          if (interrupted) break;
        }
      })();
      gen.interrupt = async () => { interrupted = true; };
      return gen;
    }
  };
  return sdk;
}


module.exports = { fakeSdk };
