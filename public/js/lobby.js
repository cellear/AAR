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
      <div class="plate"><div class="n"><span class="dot ${esc(o.liveness)}"></span>${esc(o.name)} <span class="ago" data-heard="${esc(o.lastHeard || '')}">${esc(shortRel(o.lastHeard))}</span></div>${o.role ? `<div class="r">${esc(o.role)}</div>` : ''}${summary(o)}</div>`;
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
    const how = o.session
      ? `${esc(o.name)}'s session is running (${esc(o.session.kind)}). Open session copies the command to reach it.`
      : `To talk to ${esc(o.name)}: press <b>Open session</b>, which copies a command to the clipboard; open a terminal, paste it, and Claude Code starts in this office as ${esc(o.name)}.`;
    return `<div class="fpanel note"><div class="head"><b>${esc(o.name)}</b><span class="rolebig">${esc(where)}</span><span>${esc(session)} · last heard ${esc(relTime(o.lastHeard))}</span></div>${body}
      <div class="actions"><a class="btn primary" href="/office/${encodeURIComponent(o.id)}">Open office</a><a class="btn" href="/office/${encodeURIComponent(o.id)}#conversation">Conversation</a><button class="btn launch" data-id="${esc(o.id)}">Open session</button>${o.cos ? '<a class="btn" href="/cos">Cross-office view</a>' : ''}${badges(o.badges)}</div>
      <div class="how">${how}</div></div>`;
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
    delete $('#firstrun').dataset.ready;
    renderWarnings();
    if (view === 'cards') renderCards(); else renderFloor();
    first = false;
  }

  /* ---------- how it works, first run, change folder ---------- */
  function howItWorks(brand) {
    return `
      <h2>How ${esc(brand)} works</h2>
      <p class="expand"><b>${esc(brand)}</b> stands for <b>Administrative Assistant Robots</b>: a staff of AI assistants, one for each outside group you deal with, each with an office of their own.</p>
      <p>This version is a window onto the staff. It shows who is awake, what each assistant is doing, and who needs you. It reads their files and Claude Code's session list, and it never edits an assistant's files. Talking to an assistant happens in a terminal; a later version will let you talk from here.</p>
      <ol class="steps">
        <li><b>The staff folder.</b> One folder you choose, outside this app, with one subfolder per office. Make it a git repository so cloud sessions can see it. A path with no spaces is safest, such as <code>~/aar-staff</code>.</li>
        <li><b>An office</b> is one assistant's folder: a handful of Markdown files that hold what they know, what they have done, and how they behave. The office page explains each file.</li>
        <li><b>The Chief of Staff</b> is the first office, created for you on the next screen. The others come from the <b>Hire</b> button.</li>
        <li><b>Talking to an assistant</b> happens in a terminal. From their office, copy the command ${esc(brand)} gives you, paste it into a terminal, and Claude Code starts there as that assistant. The floor updates within seconds.</li>
      </ol>
      <div class="note"><p>${esc(brand)} writes exactly three things: the staff folder when you create it here, a new office when you hire, and its own settings file (<code>aar.config.json</code> in the app folder). <code>npm run reset</code> forgets the settings; it never touches a staff folder.</p>
      <p>${esc(brand)} never modifies or deletes a file it didn't create. It writes only inside the staff folder you name here, and only to add a new office; it never edits an existing one. The one exception is its own settings file in the app folder. If git fetch is left on, ${esc(brand)} also asks your staff repository what origin has, which changes nothing in your files or branches.</p></div>`;
  }

  let castOptions = null;
  async function loadCast() {
    if (castOptions) return castOptions;
    try { castOptions = await getJSON('/api/hire/options'); } catch { castOptions = { cast: [], accents: ['#5b7c99', '#c2603f', '#8a5a9e', '#2e7d6b'] }; }
    return castOptions;
  }

  function pickerHTML(opts, accent) {
    const swatches = opts.accents.map((a) => `<span class="swatch ${a === accent ? 'on' : ''}" data-accent="${esc(a)}" style="background:${esc(a)}"></span>`).join('');
    const own = `<label class="on"><input type="radio" name="avatar" value="own" checked><div class="fig">${silhouette(accent)}</div>Supply my own</label>`;
    const cast = opts.cast.map((c) => `<label><input type="radio" name="avatar" value="${esc(c.file)}"><div class="fig"><img src="${esc(c.url)}" alt=""></div>${esc(c.label)}</label>`).join('');
    return `<label>Accent colour<input name="accent" value="${esc(accent)}" pattern="#[0-9a-fA-F]{6}"><div class="swatches">${swatches}</div></label>
      <label>Standee<span class="path-note"> a starter picture, or drop your own avatar.png into the office later</span></label><div class="cast">${own}${cast}</div>`;
  }

  function wirePicker(form) {
    form.querySelector('.swatches').addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch'); if (!sw) return;
      form.accent.value = sw.dataset.accent;
      form.querySelectorAll('.swatch').forEach((x) => x.classList.toggle('on', x === sw));
      const fig = form.querySelector('.cast label:first-child .fig'); if (fig) fig.innerHTML = silhouette(sw.dataset.accent);
    });
    form.querySelector('.cast').addEventListener('change', () => {
      form.querySelectorAll('.cast label').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    });
  }

  async function renderFirstRun() {
    const box = $('#firstrun');
    if (box.dataset.ready) return;
    box.dataset.ready = '1';
    const s = state.staff;
    box.innerHTML = howItWorks(s.brand) + `<div class="actions"><button class="primary" id="begin" type="button">Choose a folder and create the Chief of Staff</button></div>`;
    $('#begin').addEventListener('click', async () => {
      const opts = await loadCast();
      box.innerHTML = `
        <h2>Create the Chief of Staff</h2>
        <p>First, where the staff folder goes. Then the first assistant: the Chief of Staff, who coordinates the others. You can rename either later by editing the files.</p>
        <form id="setup">
          <label>Staff folder<input name="staffDir" value="${esc(s.staffDir)}" autocomplete="off"><div class="path-note ${s.exists ? '' : 'new'}" id="pathnote">${s.settingsExist ? (s.exists ? 'This folder exists and holds no office yet.' : 'This folder does not exist yet. It will be created.') : 'A suggestion. Change it to any folder outside this app; it will be created if it does not exist.'}</div></label>
          <label>The Chief of Staff's name<input name="name" placeholder="A first name; it goes into aa.conf, README.md and CLAUDE.md"></label>
          ${pickerHTML(opts, '#5b7c99')}
          <div class="actions"><button class="primary" type="submit">Create the Chief of Staff</button><button class="secondary" type="button" id="back">Back</button><span class="err"></span></div>
        </form>
        <div class="result"></div>`;
      const form = $('#setup');
      wirePicker(form);
      $('#back').addEventListener('click', () => { delete box.dataset.ready; renderFirstRun(); });
      form.staffDir.addEventListener('input', () => { $('#pathnote').textContent = 'The folder will be created if it does not exist; the next screen says which happened.'; $('#pathnote').className = 'path-note'; });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form).entries());
        const err = box.querySelector('.err');
        err.textContent = '';
        try {
          const r = await postJSON('/api/setup', data);
          form.querySelector('button.primary').disabled = true;
          openOverlay(`<h2>${esc(r.name)} has an office</h2>
            <p>${r.createdFolder ? `The folder <code>${esc(r.staffDir)}</code> did not exist, so it was created.` : `<code>${esc(r.staffDir)}</code> already existed; the office was added to it.`} It holds one office, <code>${esc(r.office)}</code>, and the app now points at it (remembered in <code>aar.config.json</code>).</p>
            <p>To keep the staff in git, run this in a terminal:</p><pre>${esc(r.gitInitCommand)}</pre>
            <p>Click the button below to go to the <b>floor</b>, where you will see the Chief of Staff you just created. From there you can do two things:</p>
            <ol><li>Click ${esc(r.name)} to open their office, which explains how to start talking to them.</li><li>Create more staff members with the <b>Hire</b> button.</li></ol>
            <div class="actions"><button class="primary" type="button" id="tofloor">Go to the floor</button></div>`);
          $('#tofloor').addEventListener('click', closeOverlay);
        } catch (ex) {
          err.textContent = ex.message;
        }
      });
    });
  }

  function openOverlay(html) {
    $('#overlay').innerHTML = `<div class="overlay"><section class="firstrun"><a class="closex" href="#">✕ close</a>${html}</section></div>`;
    $('#overlay .closex').addEventListener('click', (e) => { e.preventDefault(); closeOverlay(); });
    $('#overlay .overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) closeOverlay(); });
  }
  function closeOverlay() { $('#overlay').innerHTML = ''; if (location.hash === '#help') history.replaceState(null, '', location.pathname); }

  function changeFolder() {
    const s = state.staff;
    openOverlay(`
      <h2>Change the staff folder</h2>
      <p>The app is pointed at <code>${esc(s.staffDir)}</code>. The choice is stored in the app's settings file; the staff folder itself is never moved or changed. Point at a folder with offices in it and the floor switches to them. Point at an empty or missing folder and you get the first-run screen.</p>
      <form id="repoint"><label>Staff folder<input name="staffDir" value="${esc(s.staffDir)}" autocomplete="off"></label>
      <div class="actions"><button class="primary" type="submit">Use this folder</button><span class="err"></span></div></form>`);
    $('#repoint').addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('#repoint .err');
      try {
        const r = await postJSON('/api/config', { staffDir: new FormData(e.target).get('staffDir') });
        toast(`Now pointed at ${r.staffDir}` + (r.exists ? '' : ' (does not exist yet)'));
        closeOverlay();
        delete $('#firstrun').dataset.ready;
      } catch (ex) { err.textContent = ex.message; }
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
    if (e.target.closest('#close')) { e.preventDefault(); location.hash = ''; return; }
    if (e.target.closest('#helplink')) { e.preventDefault(); openOverlay(howItWorks(state.staff ? state.staff.brand : 'AAR')); return; }
    if (e.target.closest('#staffdir') && state.staff) { e.preventDefault(); changeFolder(); }
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
