/* api.js: fetch helpers and the event stream with reconnect backoff. The
   page calls connect() with handlers; on every (re)connect the server sends a
   full init frame, so state is replaced wholesale and nothing is missed. */
(function () {
  'use strict';

  async function getJSON(url, init) {
    const res = await fetch(url, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
    return body;
  }

  function postJSON(url, data) {
    return getJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data || {}) });
  }

  /* onFrame(frame) for every frame; onStatus('open'|'closed') on changes. */
  function connect(url, onFrame, onStatus) {
    let source = null;
    let delay = 500;
    let timer = null;
    let closed = false;

    function open() {
      if (closed) return;
      source = new EventSource(url);
      source.onopen = () => { delay = 500; onStatus && onStatus('open'); };
      source.onmessage = (e) => {
        let frame;
        try { frame = JSON.parse(e.data); } catch { return; }
        onFrame(frame);
      };
      source.onerror = () => {
        source.close();
        source = null;
        onStatus && onStatus('closed');
        timer = setTimeout(open, delay);
        delay = Math.min(delay * 2, 8000);
      };
    }

    open();
    return { close() { closed = true; if (source) source.close(); if (timer) clearTimeout(timer); } };
  }

  window.AAR = window.AAR || {};
  Object.assign(window.AAR, { getJSON, postJSON, connect });
})();
