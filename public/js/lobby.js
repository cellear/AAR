/* lobby.js: the floor. Everyone stands on one floor with a name plate: the
   Now line (or the Need-from-you line, in red), and how long since they were
   last heard. Figures fade as an office goes quiet. Click one and the others
   recede to the lower right while the chosen assistant stands large at the
   left with their status note, deadlines, open items and recent log. The
   card grid is still there behind the Cards toggle. State arrives as an init
   frame over SSE and is patched by office / frontDesk / git / staff frames. */
(function () {
  'use strict';
  const { esc, markdown, relTime, clock, badges, standee, silhouette, toast, getJSON, postJSON, connect } = window.AAR;

  /* Recency: a figure fades after a day of silence and greys after a week. */
  const FADE_MS = 24 * 3600000;
  const GREY_MS = 7 * 24 * 3600000;

  const state = { staff: null, offices: [], frontDesk: [], git: null, polledAt: null, stale: null, errors: [], connected: false };
  const rendered = new Map();
  let first = true;
  let cosRollup = null;
  const $ = (sel) => document.querySelector(sel);

  /* ---------- routing: #cards for the grid, #<office id> for focus ---------- */
  function route() {
    const h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h === 'cards') return { view: 'cards', focus: null };
    return { view: 'floor', focus: h || null };
  }

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
    $('#hirebtn').style.display = s.count > 0 ? '' : 'none';
    $('#viewtoggle').style.display = s.count > 0 ? '' : 'none';
    const r = route();
    document.querySelectorAll('#viewtoggle a').forEach((a) => a.classList.toggle('on', a.dataset.view === r.view));
  }

  /* ---------- the floor ---------- */
  function quietClass(o) {
    if (o.liveness !== 'none') return '';
    const t = o.lastHeard ? Date.parse(o.lastHeard) : 0;
    const age = Date.now() - t;
    if (!t || age > GREY_MS) return 'q2';
    if (age > FADE_MS) return 'q1';
    return '';
  }

  function summary(o) {
    if (o.status && o.status.need) return `<div class="s need">Needs you: ${esc(o.status.need)}</div>`;
    if (o.bubble.source === 'none') return `<div class="s none">${esc(o.bubble.text)}</div>`;
    return `<div class="s">${esc(o.bubble.text)}</div>`;
  }

  function pin(o) {
    if (o.badges.includes('needsYou')) return '<span class="pin" title="Needs you">!</span>';
    if (o.badges.includes('stuck')) return '<span class="pin stuck" title="Stuck">⏱</span>';
    return '';
  }

  function figure(o) {
    return o.avatar && o.avatar.url ? `<img src="${esc(o.avatar.url)}" alt="">` : silhouette(o.accent);
  }

  function personHTML(o) {
    return `${pin(o)}<div class="fig">${figure(o)}</div><div class="shadow"></div>
      <div class="plate"><div class="n"><span class="dot ${esc(o.liveness)}"></span>${esc(o.name)} <span class="ago" data-heard="${esc(o.lastHeard || '')}">${esc(shortRel(o.lastHeard))}</span></div>${summary(o)}</div>`;
  }

  function shortRel(iso) {
    const r = relTime(iso);
    return r === 'just now' ? 'now' : r.replace(' ago', '');
  }

  function renderRow() {
    const row = $('#row');
    const { focus } = route();
    const seen = new Set();
    let prev = null;
    for (const o of state.offices) {
      seen.add(o.id);
      let el = row.querySelector(`.person[data-id="${CSS.escape(o.id)}"]`);
      if (!el) { el = document.createElement('a'); el.className = 'person'; el.dataset.id = o.id; el.href = '#' + encodeURIComponent(o.id); }
      const wanted = prev ? prev.nextElementSibling : row.firstElementChild;
      if (el !== wanted) row.insertBefore(el, wanted);
      const json = JSON.stringify(o);
      if (rendered.get(o.id) !== json) {
        el.innerHTML = personHTML(o);
        el.style.setProperty('--accent', o.accent || '#5b7c99');
        el.title = o.role || '';
        rendered.set(o.id, json);
      }
      el.className = `person ${quietClass(o)} ${focus === o.id ? 'sel' : ''}`;
      prev = el;
    }
    for (const el of [...row.children]) if (!seen.has(el.dataset.id)) { el.remove(); rendered.delete(el.dataset.id); }
  }

  /* ---------- the panels for the chosen assistant ---------- */
  const inline = (text) => markdown(text).replace(/^<p>|<\/p>\s*$/g, '');
  const fmtDay = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  function notePanel(o) {
    const st = o.status;
    const line = (label, value, cls) => `<span class="line ${cls} ${value ? '' : 'empty'}"><b>${label}</b>${value ? esc(value) : '—'}</span>`;
    const body = st
      ? line('Now', st.now, '') + line('Need from you', st.need, 'need') + line('Next', st.next, '')
      : `${esc(o.bubble.text)}<span class="src">${o.bubble.source === 'none' ? 'no status.md yet' : o.bubble.source === 'away' ? 'from their last session' : 'their last message'}</span>`;
    const session = o.session ? `${o.session.status} · ${o.session.kind} session` : 'no session';
    const where = [o.role, o.id].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ');
    return `<div class="fpanel note"><div class="head"><b>${esc(o.name)}</b><span>${esc(where)} · ${esc(session)} · last heard ${esc(relTime(o.lastHeard))}</span></div>${body}
      <div class="actions"><a class="btn primary" href="/office/${encodeURIComponent(o.id)}">Open office</a><button class="btn launch" data-id="${esc(o.id)}">Open session</button>${o.cos ? '<a class="btn" href="/cos">Cross-office view</a>' : ''}${badges(o.badges)}</div></div>`;
  }

  function deadlinesPanel(o) {
    const items = [];
    for (const s of (o.briefing ? o.briefing.sections : [])) if (s.kind === 'deadlines') items.push(...s.items);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const soon = new Date(today.getTime() + 14 * 86400000);
    const html = items.slice(0, 6).map((i) => {
      const d = i.date ? new Date(i.date + 'T00:00:00') : null;
      const cls = d && d <= soon ? '' : 'later';
      return `<li><span class="when ${cls}">${d ? esc(fmtDay(i.date)) : 'undated'}</span>${inline(i.text)}</li>`;
    }).join('');
    return `<div class="fpanel"><h3>Upcoming deadlines</h3>${html ? `<ul>${html}</ul>` : '<div class="empty">None in the briefing.</div>'}</div>`;
  }

  function openPanel(o) {
    const items = [];
    for (const s of (o.briefing ? o.briefing.sections : [])) if (s.kind === 'openItems') items.push(...s.items.filter((i) => i.checked === false));
    const html = items.slice(0, 8).map((i) => `<li><span class="box"></span><span>${inline(i.text)}</span></li>`).join('');
    return `<div class="fpanel"><h3>Open items</h3>${html ? `<ul class="checklist">${html}</ul>` : '<div class="empty">Nothing open.</div>'}</div>`;
  }

  function logPanel(o) {
    const entries = [];
    for (const day of (o.log || [])) for (const e of day.entries) { entries.push({ date: day.date, ...e }); if (entries.length >= 3) break; }
    const html = entries.slice(0, 3).map((e) => `<div class="e"><span class="d">${esc(e.date ? fmtDay(e.date) : 'undated')}</span><div class="md">${e.title ? `<b>${esc(e.title)}</b> ` : ''}${markdown(e.body)}</div></div>`).join('');
    return `<div class="fpanel wide"><h3>Recent log</h3>${html || '<div class="empty">No log entries yet.</div>'}</div>`;
  }

  function cosPanel(o) {
    if (!o.cos) return '';
    const needs = cosRollup ? cosRollup.needs.filter((n) => n.office !== o.id) : [];
    const html = needs.map((n) => `<li><a class="tag" href="#${encodeURIComponent(n.office)}">${esc(n.name)}</a> ${inline(n.text)}</li>`).join('');
    return `<div class="fpanel wide"><h3>Across the offices: needs you</h3>${cosRollup ? (html ? `<ul>${html}</ul>` : '<div class="empty">Nobody else needs you right now.</div>') : '<div class="empty">Loading…</div>'}</div>`;
  }

  function renderPanels() {
    const { focus } = route();
    const o = focus ? state.offices.find((x) => x.id === focus) : null;
    const box = $('#panels');
    if (!o) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = '';
    box.style.setProperty('--accent', o.accent || '#5b7c99');
    box.innerHTML = notePanel(o) + deadlinesPanel(o) + openPanel(o) + cosPanel(o) + logPanel(o);
    if (o.cos && !cosRollup) getJSON('/api/cos').then((r) => { cosRollup = r; if (route().focus === o.id) renderPanels(); }).catch(() => {});
  }

  function renderFloor() {
    const { focus } = route();
    const valid = focus && state.offices.some((o) => o.id === focus);
    $('#floor').classList.toggle('focus', !!valid);
    $('#close').style.display = valid ? '' : 'none';
    renderRow();
    renderPanels();
    renderFrontDesk();
  }

  function renderFrontDesk() {
    const list = state.frontDesk;
    $('#frontdesk').style.display = list.length ? '' : 'none';
    $('#frontdesk .strip').innerHTML = list.map((s) => `<div class="visitor"><span class="dot ${esc(s.status === 'busy' ? 'busy' : 'idle')}"></span><b>${esc(s.name || s.id.slice(0, 8))}</b><span>${esc(s.status)} · ${esc(s.kind)}</span><span class="cwd">${esc(s.cwd)}</span></div>`).join('');
  }

  /* ---------- the card grid (behind the toggle) ---------- */
  function cardHTML(o) {
    const need = o.status && o.status.need ? `<span class="need"><b>Need from you:</b> ${esc(o.status.need)}</span>` : '';
    return `<span class="pin"></span>${standee(o, o.liveness === 'none' ? 'off' : '')}
      <div class="who"><span class="dot ${esc(o.liveness)}"></span><a class="name" href="/office/${encodeURIComponent(o.id)}">${esc(o.name)}</a><span class="role">${esc(o.role || '')}</span></div>
      <div class="bubble ${o.bubble.source === 'none' ? 'none' : ''}">${esc(o.bubble.text)}${need}</div>
      <div class="foot"><span class="heard" data-heard="${esc(o.lastHeard || '')}">last heard ${esc(relTime(o.lastHeard))}</span>${badges(o.badges)}<button class="btn launch" data-id="${esc(o.id)}">Open session</button></div>`;
  }

  function renderCards() {
    const grid = $('#cards');
    grid.innerHTML = state.offices.map((o) => `<article class="card ${o.cos ? 'cos' : ''}" style="--accent:${esc(o.accent || '#5b7c99')}">${cardHTML(o)}</article>`).join('');
  }

  function renderWarnings() {
    const w = [...(state.staff ? state.staff.warnings : []), ...state.errors];
    $('#warnings').innerHTML = w.map((x) => `<div>${esc(x)}</div>`).join('');
    $('#warnings').style.display = w.length ? '' : 'none';
  }

  function renderAll() {
    renderHeader();
    if (!state.staff) return;
    const empty = state.staff.count === 0;
    const { view } = route();
    $('#firstrun').style.display = empty ? '' : 'none';
    $('#floor').style.display = !empty && view === 'floor' ? '' : 'none';
    $('#lobby').style.display = !empty && view === 'cards' ? '' : 'none';
    if (empty) { renderFirstRun(); return; }
    renderWarnings();
    if (view === 'cards') renderCards(); else renderFloor();
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

  /* ---------- clicks ---------- */
  document.addEventListener('click', async (e) => {
    const btn = e.target.closest('.launch');
    if (btn) {
      e.preventDefault();
      try {
        const r = await getJSON('/api/launch/' + encodeURIComponent(btn.dataset.id));
        if (r.command) { await navigator.clipboard.writeText(r.command); btn.classList.add('copied'); setTimeout(() => btn.classList.remove('copied'), 1500); toast('Copied to clipboard: ' + r.command); }
        else toast(r.note);
      } catch (ex) { toast('Could not copy: ' + ex.message); }
      return;
    }
    const sel = e.target.closest('.person.sel');
    if (sel) { e.preventDefault(); location.hash = ''; return; }
    if (e.target.closest('#close')) { e.preventDefault(); location.hash = ''; }
  });
  window.addEventListener('hashchange', renderAll);

  setInterval(() => {
    document.querySelectorAll('.heard').forEach((el) => { el.textContent = 'last heard ' + relTime(el.dataset.heard || null); });
    document.querySelectorAll('.ago').forEach((el) => { el.textContent = shortRel(el.dataset.heard || null); });
  }, 15000);

  /* ---------- frames ---------- */
  function onFrame(f) {
    switch (f.type) {
      case 'init':
        Object.assign(state, { staff: f.staff, offices: f.offices, frontDesk: f.frontDesk, git: f.git, polledAt: f.polledAt, stale: f.stale || null, errors: f.errors || [] });
        cosRollup = null;
        renderAll();
        break;
      case 'office': {
        const i = state.offices.findIndex((o) => o.id === f.office.id);
        if (i === -1) state.offices.push(f.office); else state.offices[i] = f.office;
        state.polledAt = f.polledAt; state.stale = null; cosRollup = null;
        renderAll();
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
