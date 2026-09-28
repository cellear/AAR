'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../server/lib/config');
const setup = require('../server/lib/setup');
const { createTalk, createInputQueue, sessionsPath } = require('../server/lib/talk');

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

function cfg() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aar-talk-'));
  const c = { ...config.DEFAULTS, appRoot: config.APP_ROOT, staffDir: path.join(base, 'staff'), configPath: path.join(base, 'aar.config.json') };
  setup.createStaff({ cfg: c, name: 'Robin', persist: false });
  return c;
}

const frames = (talk) => { const out = []; talk.events.on('frame', (f) => out.push(f)); return out; };
const until = (list, pred, ms = 3000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  (function tick() { if (list.some(pred)) return resolve(); if (Date.now() - t0 > ms) return reject(new Error('timed out waiting; frames: ' + JSON.stringify(list.map((f) => f.kind || f.type)))); setTimeout(tick, 10); })();
});

test('the input queue delivers pushed items and ends', async () => {
  const q = createInputQueue();
  const it = q[Symbol.asyncIterator]();
  q.push(1);
  assert.deepEqual(await it.next(), { value: 1, done: false });
  const p = it.next();
  q.push(2);
  assert.deepEqual(await p, { value: 2, done: false });
  q.end();
  assert.deepEqual(await it.next(), { value: undefined, done: true });
});

test('start records the session, say streams a reply, the result returns to idle', async () => {
  const c = cfg();
  const sdk = fakeSdk();
  const talk = createTalk({ cfg: c, sdk });
  const got = frames(talk);
  const st = await talk.start('Chief of Staff');
  assert.equal(st.running, true);
  assert.equal(st.phase, 'idle');
  await until(got, (f) => f.kind === 'init');
  assert.equal(talk.status('Chief of Staff').sessionId, 'sess-1');
  assert.equal(JSON.parse(fs.readFileSync(sessionsPath(c), 'utf8'))['Chief of Staff'].sessionId, 'sess-1');
  assert.equal(sdk.calls[0].options.cwd, path.join(c.staffDir, 'Chief of Staff'));
  assert.equal(sdk.calls[0].options.model, 'opus');
  assert.deepEqual(sdk.calls[0].options.settingSources, ['user', 'project', 'local']);
  assert.equal(sdk.calls[0].options.permissionMode, 'default');

  const s2 = await talk.say('Chief of Staff', 'Hi Robin');
  assert.equal(s2.phase, 'thinking');
  await until(got, (f) => f.kind === 'result');
  assert.deepEqual(sdk.calls[0].sent, ['Hi Robin']);
  assert.equal(got.filter((f) => f.kind === 'delta').map((f) => f.text).join(''), 'Hello from the fake.');
  const msg = got.find((f) => f.kind === 'message');
  assert.equal(msg.text, 'Hello from the fake.');
  assert.deepEqual(msg.tools, [{ name: 'Read', input: 'briefing.md' }]);
  assert.equal(talk.status('Chief of Staff').phase, 'idle');
  assert.equal(talk.liveSessions()[0].kind, 'aar');
  assert.equal(talk.liveSessions()[0].status, 'idle');
  await talk.stop('Chief of Staff');
});

test('say refuses while thinking; a second say after the result works', async () => {
  const c = cfg();
  const talk = createTalk({ cfg: c, sdk: fakeSdk() });
  const got = frames(talk);
  await talk.say('Chief of Staff', 'one');
  await assert.rejects(() => talk.say('Chief of Staff', 'two'), (e) => e.status === 409);
  await until(got, (f) => f.kind === 'result');
  await talk.say('Chief of Staff', 'two');
  await until(got, (f) => got.filter((x) => x.kind === 'result').length === 2);
  await talk.stop('Chief of Staff');
});

test('a permission request waits for the answer; allow continues, deny is reported', async () => {
  const c = cfg();
  const sdk = fakeSdk({ permissionFor: 'run' });
  const talk = createTalk({ cfg: c, sdk });
  const got = frames(talk);
  await talk.say('Chief of Staff', 'please run ls');
  await until(got, (f) => f.type === 'permission' && !f.answered);
  const req = got.find((f) => f.type === 'permission');
  assert.equal(req.tool, 'Bash');
  assert.equal(req.input, 'ls -la');
  const st = talk.status('Chief of Staff');
  assert.equal(st.phase, 'waiting');
  assert.equal(st.pending.length, 1);
  assert.equal(talk.liveSessions()[0].status, 'busy');
  await assert.rejects(() => talk.say('Chief of Staff', 'again'), (e) => e.status === 409 && /waiting/.test(e.message));
  assert.throws(() => talk.answer('Chief of Staff', 'nope', true), (e) => e.status === 404);
  talk.answer('Chief of Staff', req.requestId, true);
  await until(got, (f) => f.kind === 'result');
  assert.equal(sdk.permissions[0].behavior, 'allow');
  assert.deepEqual(sdk.permissions[0].updatedInput, { command: 'ls -la' });

  await talk.say('Chief of Staff', 'run it again');
  await until(got, (f) => f.type === 'permission' && !f.answered && f.requestId !== req.requestId);
  const req2 = got.filter((f) => f.type === 'permission' && !f.answered)[1];
  talk.answer('Chief of Staff', req2.requestId, false);
  await until(got, (f) => got.filter((x) => x.kind === 'result').length === 2);
  assert.equal(sdk.permissions[1].behavior, 'deny');
  assert.equal(got.filter((f) => f.kind === 'message').pop().text, 'Understood, I will not run it.');
  await talk.stop('Chief of Staff');
});

test('stop denies pending requests, keeps the record, and the next start resumes', async () => {
  const c = cfg();
  const sdk = fakeSdk({ permissionFor: 'run' });
  const talk = createTalk({ cfg: c, sdk });
  const got = frames(talk);
  await talk.say('Chief of Staff', 'run it');
  await until(got, (f) => f.type === 'permission');
  await talk.stop('Chief of Staff');
  assert.equal(sdk.permissions[0].behavior, 'deny');
  assert.equal(talk.status('Chief of Staff').running, false);
  assert.equal(talk.status('Chief of Staff').sessionId, 'sess-1', 'remembered after stop');
  assert.ok(got.some((f) => f.kind === 'stopped'));

  await talk.start('Chief of Staff');
  assert.equal(sdk.calls[1].options.resume, 'sess-1');
  await talk.stop('Chief of Staff');

  talk.forget('Chief of Staff');
  assert.equal(talk.status('Chief of Staff').sessionId, null);
  await talk.start('Chief of Staff');
  assert.equal(sdk.calls[2].options.resume, undefined);
  await talk.stopAll();
  assert.equal(talk.liveSessions().length, 0);
});

test('a session record survives a new talk instance (AAR restart)', async () => {
  const c = cfg();
  const sdk = fakeSdk();
  let talk = createTalk({ cfg: c, sdk });
  let got = frames(talk);
  await talk.start('Chief of Staff');
  await until(got, (f) => f.kind === 'init');
  await talk.stopAll();
  talk = createTalk({ cfg: c, sdk });
  assert.equal(talk.status('Chief of Staff').sessionId, 'sess-1');
  assert.equal(talk.status('Chief of Staff').running, false);
  await talk.say('Chief of Staff', 'still there?');
  assert.equal(sdk.calls[1].options.resume, 'sess-1');
  await talk.stopAll();
});

test('an SDK error is reported and the session returns to idle; a missing SDK is a 503', async () => {
  const c = cfg();
  const talk = createTalk({ cfg: c, sdk: fakeSdk({ errorFor: 'explode' }) });
  const got = frames(talk);
  await talk.say('Chief of Staff', 'please explode');
  await until(got, (f) => f.kind === 'error');
  await until(got, (f) => f.kind === 'result');
  assert.equal(talk.status('Chief of Staff').phase, 'idle');
  assert.equal(talk.status('Chief of Staff').error, 'boom');
  await talk.stopAll();

  const none = createTalk({ cfg: c, loadSdk: async () => { throw new Error('Cannot find module'); } });
  await assert.rejects(() => none.start('Chief of Staff'), (e) => e.status === 503 && /npm install/.test(e.message));
  const off = createTalk({ cfg: { ...c, talk: { enabled: false } }, sdk: fakeSdk() });
  await assert.rejects(() => off.start('Chief of Staff'), (e) => e.status === 403);
  assert.equal(off.status('Chief of Staff').available, false);
  await assert.rejects(() => createTalk({ cfg: c, sdk: fakeSdk() }).start('Nobody'), (e) => e.status === 404);
});
