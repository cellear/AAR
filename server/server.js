#!/usr/bin/env node
'use strict';
/* server.js: the AAR server. Node's http module, no dependencies. Static files
   from public/, a JSON API, and images from the offices. Read-only by
   construction: only GET, HEAD and OPTIONS are answered, except the two POSTs
   the plan allows (first-run setup now, the hire wizard in phase 6). Every
   other method is 405 before any path is resolved. Bound to 127.0.0.1. */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const loadConfig = require('./lib/config');
const platform = require('./lib/platform');
const reader = require('./lib/reader');
const state = require('./lib/state');
const setup = require('./lib/setup');
const launch = require('./lib/launch');
const hire = require('./lib/hire');
const transcripts = require('./lib/transcripts');
const { createTalk } = require('./lib/talk');
const { createStore } = require('./lib/store');

const PUBLIC = path.join(loadConfig.APP_ROOT, 'public');
const CAST = path.join(loadConfig.APP_ROOT, 'assets', 'avatars');
const POST_ROUTES = new Set(['/api/setup', '/api/hire', '/api/config']);
const TALK_POST = /^\/api\/talk\/[^/]+\/(start|say|stop|answer|forget)$/;
const isPostRoute = (p) => POST_ROUTES.has(p) || TALK_POST.test(p);
const MAX_BODY = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8'
};

/* Resolve a request path inside a root, refusing anything that escapes it by
   `..`, a percent-encoded dot segment, a NUL byte, or a symlink out of the
   tree. Missing files come back as a path and 404 later. */
function resolveSafe(root, rel) {
  let decoded;
  try { decoded = decodeURIComponent(String(rel || '')); } catch { return null; }
  if (decoded.includes('\0')) return null;
  const full = path.resolve(root, './' + decoded.replace(/^\/+/, ''));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  /* Compare real paths on both sides: the root itself may sit behind a
     symlink (macOS's temp dir, an iCloud folder), and comparing a resolved
     target against an unresolved root would refuse every file under it.
     Return the path as addressed, so callers can still check its parent
     against the root they were given. */
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { realRoot = root; }
  let real;
  try { real = fs.realpathSync(full); } catch { return full; }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) return null;
  return full;
}

function send(res, status, headers, body) {
  headers['Cache-Control'] = 'no-store, max-age=0';
  res.writeHead(status, headers);
  res.end(body);
}

function json(res, status, body) {
  send(res, status, { 'Content-Type': MIME['.json'] }, JSON.stringify(body));
}

function sendFile(res, file, { head = false } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return json(res, 404, { error: 'not found' }); }
  if (!st.isFile()) return json(res, 404, { error: 'not found' });
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-store, max-age=0' });
  if (head) return res.end();
  fs.createReadStream(file).pipe(res);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/* Build the request handler around one store and the talk layer. */
function createHandler(cfg, store, talk) {
  const offices = () => store.current;

  /* /avatars/<office id>/avatar.png and office.png, from the office folder;
     /avatars/cast/<file> from the starter cast. Only those file names. */
  function image(res, parts, head) {
    if (parts[0] === 'cast') {
      if (parts.length !== 2) return json(res, 404, { error: 'not found' });
      const file = resolveSafe(CAST, parts[1]);
      if (!file || path.dirname(file) !== CAST) return json(res, 404, { error: 'not found' });
      return sendFile(res, file, { head });
    }
    /* /avatars/<office>/avatar.png, office.png, or people/<image>. */
    const isPeople = parts.length === 3 && parts[1] === 'people' && /\.(png|jpe?g|gif|webp)$/i.test(parts[2]);
    if (!isPeople && (parts.length !== 2 || !['avatar.png', 'office.png'].includes(parts[1]))) return json(res, 404, { error: 'not found' });
    const officeDir = resolveSafe(cfg.staffDir, parts[0]);
    if (!officeDir || path.dirname(officeDir) !== cfg.staffDir) return json(res, 404, { error: 'not found' });
    if (!fs.existsSync(path.join(officeDir, 'aa.conf'))) return json(res, 404, { error: 'not found' });
    const file = isPeople ? resolveSafe(path.join(officeDir, 'people'), parts[2]) : path.join(officeDir, parts[1]);
    if (!file || (isPeople && path.dirname(file) !== path.join(officeDir, 'people'))) return json(res, 404, { error: 'not found' });
    return sendFile(res, file, { head });
  }

  async function post(req, res, pathname) {
    let body;
    try {
      const text = await readBody(req);
      body = text ? JSON.parse(text) : {};
    } catch (err) {
      return json(res, 400, { error: `bad request body: ${err.message}` });
    }
    if (pathname === '/api/setup') {
      try {
        const result = setup.createStaff({ cfg, staffDir: body.staffDir, name: body.name, accent: body.accent, avatar: body.avatar });
        /* Remember the folder even when this run came from AAR_STAFF_DIR. */
        cfg.staffDir = result.staffDir;
        loadConfig.save(cfg);
        store.repoint();
        return json(res, 201, result);
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }
    if (pathname === '/api/config') {
      /* The third and last write: point the app at another staff folder. */
      try {
        const dir = loadConfig.setStaffDir(cfg, body.staffDir);
        store.repoint();
        const exists = reader.dirExists(dir);
        return json(res, 200, { staffDir: dir, exists, offices: reader.staffExists(dir) ? store.current.staff.count : 0, configPath: cfg.configPath });
      } catch (err) {
        return json(res, 400, { error: err.message });
      }
    }
    const tm = TALK_POST.exec(pathname);
    if (tm) {
      const id = decodeURIComponent(pathname.split('/')[3]);
      const verb = tm[1];
      try {
        let r;
        if (verb === 'start') r = await talk.start(id, { fresh: body.fresh === true });
        else if (verb === 'say') r = await talk.say(id, body.text);
        else if (verb === 'stop') r = await talk.stop(id);
        else if (verb === 'answer') r = talk.answer(id, body.requestId, body.allow === true, body.updatedInput);
        else r = talk.forget(id);
        return json(res, verb === 'say' ? 202 : 200, r);
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }
    if (pathname === '/api/hire') {
      try {
        const result = hire.hire(body, cfg);
        store.rebuild({ full: true });
        return json(res, 201, result);
      } catch (err) {
        return json(res, err.status || 500, { error: err.message });
      }
    }
    return json(res, 404, { error: 'not found' });
  }

  return function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;
    const head = req.method === 'HEAD';

    if (req.method === 'OPTIONS') {
      return send(res, 204, { Allow: isPostRoute(p) ? 'GET, HEAD, OPTIONS, POST' : 'GET, HEAD, OPTIONS' }, '');
    }
    if (req.method === 'POST') {
      if (!isPostRoute(p)) return send(res, 405, { Allow: 'GET, HEAD, OPTIONS', 'Content-Type': MIME['.txt'] }, 'read-only');
      return void post(req, res, p);
    }
    if (req.method !== 'GET' && !head) {
      return send(res, 405, { Allow: isPostRoute(p) ? 'GET, HEAD, OPTIONS, POST' : 'GET, HEAD, OPTIONS', 'Content-Type': MIME['.txt'] }, 'read-only');
    }

    try {
      if (p === '/api/staff') {
        const all = offices();
        return json(res, 200, { staff: all.staff, polledAt: all.polledAt, errors: all.errors, stale: store.stale, configPath: cfg.configPath, config: { port: cfg.port, brand: cfg.brand, pollMs: cfg.pollMs, stuckMs: cfg.stuckMs, gitFetchMs: cfg.gitFetchMs, models: cfg.models } });
      }
      if (p === '/api/offices') {
        const all = offices();
        return json(res, 200, { ...store.initFrame() });
      }
      if (p.startsWith('/api/offices/')) {
        const id = decodeURIComponent(p.slice('/api/offices/'.length));
        const office = offices().offices.find((o) => o.id === id);
        return office ? json(res, 200, office) : json(res, 404, { error: 'no such office' });
      }
      if (p.startsWith('/api/launch/')) {
        const id = decodeURIComponent(p.slice('/api/launch/'.length));
        const office = offices().offices.find((o) => o.id === id);
        return office ? json(res, 200, { office: id, ...launch.launchCommand(office) }) : json(res, 404, { error: 'no such office' });
      }
      if (p.startsWith('/api/talk/')) {
        const id = decodeURIComponent(p.slice('/api/talk/'.length));
        if (!offices().offices.some((o) => o.id === id)) return json(res, 404, { error: 'no such office' });
        return json(res, 200, talk.status(id));
      }
      if (p.startsWith('/api/transcript/')) {
        /* The conversation for one office: ?session=<id> picks a transcript
           (default: the live one, else the newest); ?before=<i>&limit=<n>
           page backwards through messages. */
        const id = decodeURIComponent(p.slice('/api/transcript/'.length));
        const office = offices().offices.find((o) => o.id === id);
        if (!office) return json(res, 404, { error: 'no such office' });
        const sessions = transcripts.sessionsFor(office.folder, office.session).map((s) => ({ id: s.id, mtime: s.mtime, size: s.size, live: s.live }));
        const want = url.searchParams.get('session');
        const chosen = transcripts.sessionsFor(office.folder, office.session).find((s) => (want ? s.id === want : true)) || null;
        if (!chosen) return json(res, 200, { office: id, sessions, session: null, messages: [], total: 0, from: 0 });
        const all = transcripts.conversationFor(chosen.file) || [];
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 60));
        const before = url.searchParams.has('before') ? Number(url.searchParams.get('before')) : all.length;
        const end = Math.max(0, Math.min(all.length, Number.isFinite(before) ? before : all.length));
        const from = Math.max(0, end - limit);
        return json(res, 200, { office: id, sessions, session: chosen.id, live: chosen.live, messages: all.slice(from, end), total: all.length, from });
      }
      if (p === '/api/hire/options') return json(res, 200, hire.options(cfg));
      if (p === '/api/cos') {
        const all = offices();
        if (!all.cos) return json(res, 404, { error: 'no office has cos=yes', warnings: all.staff.warnings });
        const rollup = state.buildRollup({ snapshots: all.offices, cos: all.cos });
        if (rollup.morningSheet) {
          /* The sheet's text, read here so the page needs one request. */
          const file = resolveSafe(path.join(all.cos.folder, 'mornings'), rollup.morningSheet.file);
          try { rollup.morningSheet.markdown = file ? fs.readFileSync(file, 'utf8') : null; } catch { rollup.morningSheet.markdown = null; }
          rollup.morningSheet.date = (/^(\d{4}-\d{2}-\d{2})/.exec(rollup.morningSheet.file) || [])[1] || null;
        }
        return json(res, 200, { cos: all.cos.id, cosName: all.cos.name, ...rollup, polledAt: all.polledAt });
      }
      if (p === '/api/events') {
        return store.hub.add(req, res, { type: 'init', ...store.initFrame() });
      }
      if (p.startsWith('/avatars/')) {
        return image(res, p.slice('/avatars/'.length).split('/').filter(Boolean), head);
      }
      if (p.startsWith('/api/')) return json(res, 404, { error: 'not found' });

      /* Static pages. `/office/<id>`, `/cos` and `/hire` map to their pages. */
      let rel = p === '/' ? 'index.html' : p.slice(1);
      if (p.startsWith('/office/')) rel = 'office.html';
      else if (p === '/cos') rel = 'cos.html';
      else if (p === '/hire') rel = 'hire.html';
      /* The docs folder is served read-only too, so the pages can link to it. */
      if (p.startsWith('/docs/')) {
        const doc = resolveSafe(path.join(loadConfig.APP_ROOT, 'docs'), p.slice('/docs/'.length));
        if (!doc) return json(res, 404, { error: 'not found' });
        return sendFile(res, doc, { head });
      }
      const file = resolveSafe(PUBLIC, rel);
      if (!file) return json(res, 404, { error: 'not found' });
      return sendFile(res, file, { head });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  };
}

/* `live: false` skips the CLI, git and the watcher; tests use it. `sdk` is
   a fake Agent SDK for tests; otherwise the real one loads on first use. */
function createServer(cfg, { live = true, sdk = null } = {}) {
  /* AAR_TALK_FAKE=1 swaps in the scripted SDK from the tests, for driving
     the pages without a real assistant. */
  if (!sdk && process.env.AAR_TALK_FAKE === '1') sdk = require('../test/fake-sdk').fakeSdk({ permissionFor: 'run', slow: true });
  const talk = createTalk({ cfg, sdk, loadSdk: sdk ? null : () => import('@anthropic-ai/claude-agent-sdk') });
  const store = createStore(cfg, { live, talk });
  store.start();
  const server = http.createServer(createHandler(cfg, store, talk));
  server.store = store;
  server.talk = talk;
  server.on('close', () => { store.stop(); talk.stopAll(); });
  return server;
}

function start() {
  const cfg = loadConfig.load();
  const server = createServer(cfg);
  server.listen(cfg.port, '127.0.0.1', () => {
    const port = server.address().port;   /* AAR_PORT=0 picks a free one */
    const url = `http://localhost:${port}/`;
    const pad = ' '.repeat(cfg.brand.length);
    console.log(`${cfg.brand}  ${url}`);
    if (!cfg.settingsExist && !process.env.AAR_STAFF_DIR) {
      console.log(`${pad}  no settings yet (${cfg.configPath}). The page asks where the staff folder should go.`);
    } else {
      console.log(`${pad}  settings: ${cfg.configPath}${cfg.settingsExist ? '' : ' (not written yet)'}`);
      console.log(`${pad}  staff:    ${cfg.staffDir}${process.env.AAR_STAFF_DIR ? ' (from AAR_STAFF_DIR for this run only)' : ''}`);
    }
    if (cfg.settingsExist && !reader.dirExists(cfg.staffDir)) {
      console.log(`${pad}  that folder does not exist yet. Nothing is created until you press "Create staff" on the page.`);
    } else if ((cfg.settingsExist || process.env.AAR_STAFF_DIR) && !reader.staffExists(cfg.staffDir)) {
      console.log(`${pad}  that folder holds no office yet; the page offers to create the Chief of Staff.`);
    }
    console.log(`${pad}  the app writes only when you create the staff, hire, change the staff folder, or start talking to an assistant. "npm run reset" forgets the settings.`);
    if (!cfg.talk.enabled) console.log(`${pad}  talking from the page is off (talk.enabled in the settings).`);
    if (process.env.AAR_NO_OPEN !== '1' && process.stdout.isTTY) {
      const [cmd, args] = platform.openCommand(url);
      try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* browser stays closed */ }
    }
  });
  /* Stop every assistant AAR started before the process goes; the session
     record stays, so the next start resumes the conversation. */
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    const n = server.talk.liveSessions().length;
    if (n) console.log(`\n${signal}: stopping ${n} assistant session(s)…`);
    try { await server.talk.stopAll(); } catch { /* leaving anyway */ }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  return server;
}

if (require.main === module) start();

module.exports = { createServer, createHandler, resolveSafe, start };
