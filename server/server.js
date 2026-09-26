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

const PUBLIC = path.join(loadConfig.APP_ROOT, 'public');
const CAST = path.join(loadConfig.APP_ROOT, 'assets', 'avatars');
const POST_ROUTES = new Set(['/api/setup']);
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

/* Build the request handler around one config. `read` is the reader; tests
   can pass their own. */
function createHandler(cfg, { read = (now) => reader.readAll(cfg, { now }) } = {}) {
  const offices = () => read(new Date());

  /* /avatars/<office id>/avatar.png and office.png, from the office folder;
     /avatars/cast/<file> from the starter cast. Only those file names. */
  function image(res, parts, head) {
    if (parts[0] === 'cast') {
      if (parts.length !== 2) return json(res, 404, { error: 'not found' });
      const file = resolveSafe(CAST, parts[1]);
      if (!file || path.dirname(file) !== CAST) return json(res, 404, { error: 'not found' });
      return sendFile(res, file, { head });
    }
    if (parts.length !== 2 || !['avatar.png', 'office.png'].includes(parts[1])) return json(res, 404, { error: 'not found' });
    const officeDir = resolveSafe(cfg.staffDir, parts[0]);
    if (!officeDir || path.dirname(officeDir) !== cfg.staffDir) return json(res, 404, { error: 'not found' });
    if (!fs.existsSync(path.join(officeDir, 'aa.conf'))) return json(res, 404, { error: 'not found' });
    return sendFile(res, path.join(officeDir, parts[1]), { head });
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
        const result = setup.createStaff({ cfg, staffDir: body.staffDir, name: body.name });
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
      return send(res, 204, { Allow: POST_ROUTES.has(p) ? 'GET, HEAD, OPTIONS, POST' : 'GET, HEAD, OPTIONS' }, '');
    }
    if (req.method === 'POST') {
      if (!POST_ROUTES.has(p)) return send(res, 405, { Allow: 'GET, HEAD, OPTIONS', 'Content-Type': MIME['.txt'] }, 'read-only');
      return void post(req, res, p);
    }
    if (req.method !== 'GET' && !head) {
      return send(res, 405, { Allow: POST_ROUTES.has(p) ? 'GET, HEAD, OPTIONS, POST' : 'GET, HEAD, OPTIONS', 'Content-Type': MIME['.txt'] }, 'read-only');
    }

    try {
      if (p === '/api/staff') {
        const all = offices();
        return json(res, 200, { staff: all.staff, polledAt: all.polledAt, errors: all.errors, config: { port: cfg.port, brand: cfg.brand, pollMs: cfg.pollMs, stuckMs: cfg.stuckMs, gitFetchMs: cfg.gitFetchMs, models: cfg.models } });
      }
      if (p === '/api/offices') {
        const all = offices();
        return json(res, 200, { staff: all.staff, offices: all.offices, frontDesk: all.frontDesk, git: all.git, polledAt: all.polledAt, errors: all.errors });
      }
      if (p.startsWith('/api/offices/')) {
        const id = decodeURIComponent(p.slice('/api/offices/'.length));
        const office = offices().offices.find((o) => o.id === id);
        return office ? json(res, 200, office) : json(res, 404, { error: 'no such office' });
      }
      if (p === '/api/cos') {
        const all = offices();
        if (!all.cos) return json(res, 404, { error: 'no office has cos=yes', warnings: all.staff.warnings });
        return json(res, 200, { cos: all.cos.id, ...state.buildRollup({ snapshots: all.offices, cos: all.cos }), polledAt: all.polledAt });
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
      const file = resolveSafe(PUBLIC, rel);
      if (!file) return json(res, 404, { error: 'not found' });
      return sendFile(res, file, { head });
    } catch (err) {
      return json(res, 500, { error: err.message });
    }
  };
}

function createServer(cfg, options) {
  return http.createServer(createHandler(cfg, options));
}

function start() {
  const cfg = loadConfig.load();
  if (cfg.written) console.log(`wrote defaults to ${cfg.configPath}`);
  const server = createServer(cfg);
  server.listen(cfg.port, '127.0.0.1', () => {
    const url = `http://localhost:${cfg.port}/`;
    console.log(`${cfg.brand}  read-only  staff: ${cfg.staffDir}`);
    console.log(`${' '.repeat(cfg.brand.length)}  ${url}`);
    if (!reader.staffExists(cfg.staffDir)) console.log('no staff yet: open the page to create one, or POST /api/setup');
    if (process.env.AAR_NO_OPEN !== '1' && process.stdout.isTTY) {
      const [cmd, args] = platform.openCommand(url);
      try { spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch { /* browser stays closed */ }
    }
  });
  return server;
}

if (require.main === module) start();

module.exports = { createServer, createHandler, resolveSafe, start };
