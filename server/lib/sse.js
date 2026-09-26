'use strict';
/* sse.js: the event stream. Every client gets a full `init` frame on connect,
   then whatever frames the store broadcasts. A client whose socket has more
   than a few hundred KB queued is not reading and is dropped, so one stuck
   tab cannot hold the server's memory. A comment line every 25 seconds keeps
   proxies and browsers from closing an idle stream. */

const MAX_QUEUED = 512 * 1024;
const HEARTBEAT_MS = 25000;

function createHub() {
  const clients = new Set();
  let heartbeat = null;

  function frame(data) {
    return `data: ${JSON.stringify(data)}\n\n`;
  }

  function write(res, text) {
    if (res.writableEnded || res.destroyed) { clients.delete(res); return; }
    if (res.writableLength > MAX_QUEUED) { clients.delete(res); res.destroy(); return; }
    res.write(text);
  }

  function add(req, res, init) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store, max-age=0',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    res.write(frame(init));
    clients.add(res);
    req.on('close', () => clients.delete(res));
    if (!heartbeat) {
      heartbeat = setInterval(() => { for (const c of clients) write(c, ': ping\n\n'); }, HEARTBEAT_MS);
      if (heartbeat.unref) heartbeat.unref();
    }
  }

  function broadcast(data) {
    const text = frame(data);
    for (const c of [...clients]) write(c, text);
  }

  function close() {
    for (const c of clients) { try { c.end(); } catch { /* gone */ } }
    clients.clear();
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
  }

  return { add, broadcast, close, get size() { return clients.size; } };
}

module.exports = { createHub };
