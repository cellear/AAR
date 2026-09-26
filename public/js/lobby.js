/* lobby.js: one card per office, the front desk, the header, and the first
   run screen. State arrives as an init frame over SSE and is patched by
   office / frontDesk / git / staff frames. Cards re-render only when their
   office changes, and flash when they do. */
(function () {
  'use strict';
  const { esc, relTime, clock, badges, standee, toast, getJSON, postJSON, connect } = window.AAR;

  const state = { staff: null, offices: [], frontDesk: [], git: null, polledAt: null, stale: null, errors: [], connected: false };
  const rendered = new Map();   /* office id -> JSON last drawn */
  let first = true;

  const $ = (sel) => document.querySelector(sel);

  /* ---------- header ---------- */
  function renderHeader() {
    const s = state.staff;
    if (!s) return;
    document.title = s.brand;
    $('#brand').textContent = s.brand;
    $('#staffdir').textContent = s.staffDir;
    $('#staffdir').title = s.staffDir;
    const needs = s.needsYou > 0 ? `<span class="pill needs">${s.needsYou} need${s.needsYou === 1 ? 's' : ''} you</span>` : '';
    const stale = state.stale ? `<span class="pill stale" title="${esc(state.stale)}">stale</span>` : (!state.connected ? '<span class="pill stale">reconnecting…</span>' : '');
    $('#stats').innerHTML =
      `<span><b>${s.count}</b> office${s.count === 1 ? '' : 's'}</span>` + needs +
      `<span title="last poll">polled ${esc(clock(state.polledAt))}</span>` + stale +
      '<span class="pill" title="AAR reads files; the only write is hiring">read-only</span>';
    document.body.classList.toggle('stale', !!state.stale || !state.connected);
  }

  /* ---------- cards ---------- */
  function bubbleHTML(o) {
    const need = o.status && o.status.need ? `<span class="need"><b>Need from you:</b> ${esc(o.status.need)}</span>` : '';
    const src = { status: '', away: 'from her last session', transcript: 'her last message', none: '' }[o.bubble.source] || '';
    return `<div class="bubble ${o.bubble.source === 'none' ? 'none' : ''}">${esc(o.bubble.text)}${need}${src ? `<span class="src">${src}</span>` : ''}</div>`;
  }

  function sessionTitle(o) {
    if (!o.session) return 'no session running';
    const extra = o.sessions.length ? ` (+${o.sessions.length} more)` : '';
    return `${o.session.status} · ${o.session.kind} session${o.session.name ? ' "' + o.session.name + '"' : ''}${extra}`;
  }

  function cardHTML(o) {
    return `
      <span class="pin"></span>
      ${standee(o, o.liveness === 'none' ? 'off' : '')}
      <div class="who">
        <span class="dot ${esc(o.liveness)}" title="${esc(sessionTitle(o))}"></span>
        <a class="name" href="/office/${encodeURIComponent(o.id)}">${esc(o.name)}</a>
        <span class="role">${esc(o.role || '')}${o.cos && !/chief of staff/i.test(o.role || '') ? ' · Chief of Staff' : ''}</span>
      </div>
      ${bubbleHTML(o)}
      <div class="foot">
        <span class="heard" data-heard="${esc(o.lastHeard || '')}">last heard ${esc(relTime(o.lastHeard))}</span>
        ${badges(o.badges)}
        <button class="btn launch" data-id="${esc(o.id)}" title="Copy the terminal command to the clipboard">Open her session</button>
      </div>`;
  }

  function renderCards() {
    const grid = $('#cards');
    const seen = new Set();
    let prev = null;
    for (const o of state.offices) {
      seen.add(o.id);
      const json = JSON.stringify(o);
      let el = grid.querySelector(`.card[data-id="${CSS.escape(o.id)}"]`);
      if (!el) {
        el = document.createElement('article');
        el.className = 'card';
        el.dataset.id = o.id;
      }
      /* Keep display order in sync with the roster. */
      const wanted = prev ? prev.nextElementSibling : grid.firstElementChild;
      if (el !== wanted) grid.insertBefore(el, wanted);
      if (rendered.get(o.id) !== json) {
        el.innerHTML = cardHTML(o);
        el.style.setProperty('--accent', o.accent || 'var(--accent)');
        el.classList.toggle('cos', !!o.cos);
        if (rendered.has(o.id) && !first) {
          el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
        }
        rendered.set(o.id, json);
      }
      prev = el;
    }
    for (const el of [...grid.children]) if (!seen.has(el.dataset.id)) { el.remove(); rendered.delete(el.dataset.id); }
  }

  function renderFrontDesk() {
    const list = state.frontDesk;
    $('#frontdesk .strip').innerHTML = list.length
      ? list.map((s) => `<div class="visitor"><span class="dot ${esc(s.status === 'busy' ? 'busy' : 'idle')}"></span><b>${esc(s.name || s.id.slice(0, 8))}</b><span>${esc(s.status)} · ${esc(s.kind)}</span><span class="cwd">${esc(s.cwd)}</span></div>`).join('')
      : '<span class="empty">Nobody at the front desk: no session in the staff folder is unaccounted for.</span>';
  }

  function renderWarnings() {
    const w = [...(state.staff ? state.staff.warnings : []), ...state.errors];
    $('#warnings').innerHTML = w.length ? w.map((x) => `<div>${esc(x)}</div>`).join('') : '';
    $('#warnings').style.display = w.length ? '' : 'none';
  }

  function renderAll() {
    renderHeader();
    if (!state.staff) return;
    const empty = state.staff.count === 0;
    $('#firstrun').style.display = empty ? '' : 'none';
    $('#lobby').style.display = empty ? 'none' : '';
    if (empty) { renderFirstRun(); return; }
    renderWarnings();
    renderCards();
    renderFrontDesk();
    first = false;
  }

  /* ---------- first run ---------- */
  function renderFirstRun() {
    const box = $('#firstrun');
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    box.innerHTML = `
      <h2>No staff yet</h2>
      <p>${esc(state.staff.brand)} is pointed at a folder with no office in it. Create a staff there with one office, the Chief of Staff, and hire the rest from the lobby.</p>
      <form id="setup">
        <label>Staff folder<input name="staffDir" value="${esc(state.staff.staffDir)}"></label>
        <label>The Chief of Staff's name<input name="name" placeholder="Pick a name; you can change it later in aa.conf"></label>
        <button class="primary" type="submit">Create staff</button>
        <div class="err"></div>
      </form>
      <div class="result"></div>`;
    $('#setup').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = new FormData(e.target);
      const err = box.querySelector('.err');
      err.textContent = '';
      try {
        const r = await postJSON('/api/setup', { staffDir: form.get('staffDir'), name: form.get('name') });
        box.querySelector('.result').innerHTML = `<p>Created <b>${esc(r.office)}</b> for ${esc(r.name)} in ${esc(r.staffDir)}. To keep it in git, run:</p><pre>${esc(r.gitInitCommand)}</pre>`;
        e.target.querySelector('button').disabled = true;
      } catch (ex) {
        err.textContent = ex.message;
      }
    });
  }

  /* ---------- launch button ---------- */
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.launch');
    if (!btn) return;
    try {
      const r = await getJSON('/api/launch/' + encodeURIComponent(btn.dataset.id));
      if (r.command) {
        await navigator.clipboard.writeText(r.command);
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1500);
        toast((r.kind === 'attach' ? 'Copied: ' : 'Copied to clipboard: ') + r.command);
      } else {
        toast(r.note);
      }
    } catch (ex) {
      toast('Could not copy: ' + ex.message);
    }
  });

  /* ---------- tickers ---------- */
  setInterval(() => {
    document.querySelectorAll('.heard').forEach((el) => { el.textContent = 'last heard ' + relTime(el.dataset.heard || null); });
  }, 15000);

  /* ---------- frames ---------- */
  function onFrame(f) {
    switch (f.type) {
      case 'init':
        Object.assign(state, { staff: f.staff, offices: f.offices, frontDesk: f.frontDesk, git: f.git, polledAt: f.polledAt, stale: f.stale || null, errors: f.errors || [] });
        renderAll();
        break;
      case 'office': {
        const i = state.offices.findIndex((o) => o.id === f.office.id);
        if (i === -1) state.offices.push(f.office); else state.offices[i] = f.office;
        state.polledAt = f.polledAt; state.stale = null;
        renderCards(); renderHeader();
        break;
      }
      case 'frontDesk': state.frontDesk = f.sessions; state.polledAt = f.polledAt; renderFrontDesk(); renderHeader(); break;
      case 'git': state.git = f.git; state.polledAt = f.polledAt; renderHeader(); break;
      case 'staff': state.staff = f.staff; state.polledAt = f.polledAt; renderHeader(); renderWarnings(); if (state.staff.count === 0) renderAll(); break;
      case 'polled': state.polledAt = f.polledAt; state.stale = null; renderHeader(); break;
      case 'stale': state.stale = f.reason; renderHeader(); break;
      default: break;
    }
  }

  connect('/api/events', onFrame, (status) => { state.connected = status === 'open'; renderHeader(); });
})();
