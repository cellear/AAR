/* office.js: one office, full screen. The standee stands at the lower left
   with a bubble showing all three status lines. The briefing's ## sections
   are pinned cards; AAR's own headings get their own treatment. README is a
   collapsed card, the log a timeline. The sidebar lists what else is in the
   folder, unopened. Re-renders on every office frame for this office. */
(function () {
  'use strict';
  const { esc, markdown, relTime, badges, standee, toast, getJSON, connect } = window.AAR;
  const id = decodeURIComponent(location.pathname.replace(/^\/office\//, ''));
  const $ = (sel) => document.querySelector(sel);
  let office = null;
  let lastJSON = null;

  const imgBase = `/avatars/${encodeURIComponent(id)}/people/`;

  /* Markdown for this office: `people/x.jpg` links resolve to the office's
     people folder, served by AAR. */
  function md(text) {
    const html = markdown(text);
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('img').forEach((img) => {
      const src = img.getAttribute('src') || '';
      const m = /^(?:\.\/)?people\/([^/]+)$/.exec(src);
      if (m) img.setAttribute('src', imgBase + encodeURIComponent(m[1]));
    });
    return tpl.innerHTML;
  }

  function personName(file) {
    return file.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function sectionCard(s) {
    const heading = s.heading === null ? '' : `<h2>${esc(s.heading)}</h2>`;
    let body;
    let cls = '';
    if (s.kind === 'openItems' && s.items.length) {
      body = `<ul class="checklist">${s.items.map((i) => i.checked === null
        ? `<li><span class="box" style="border-style:dotted"></span><span>${md(i.text).replace(/^<p>|<\/p>$/g, '')}</span></li>`
        : `<li class="${i.checked ? 'done' : ''}"><span class="box">${i.checked ? '✓' : ''}</span><span>${md(i.text).replace(/^<p>|<\/p>$/g, '')}</span></li>`).join('')}</ul>`;
    } else if (s.kind === 'deadlines' && s.items.length) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const soon = new Date(today.getTime() + 7 * 86400000);
      body = `<ul class="deadlines">${s.items.map((i) => {
        const d = i.date ? new Date(i.date + 'T00:00:00') : null;
        const c = !d ? '' : d < today ? 'past' : d <= soon ? 'soon' : '';
        const when = d ? d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'undated';
        return `<li class="${c}"><span class="when">${esc(when)}</span><span>${md(i.text).replace(/^<p>|<\/p>$/g, '')}</span></li>`;
      }).join('')}</ul>`;
    } else if (s.kind === 'people') {
      const gallery = (office.people || []).length
        ? `<div class="people">${office.people.map((f) => `<figure><img src="${imgBase + encodeURIComponent(f)}" alt=""><figcaption>${esc(personName(f))}</figcaption></figure>`).join('')}</div>`
        : '';
      body = `<div class="md">${md(s.markdown) || (gallery ? '' : '<p>Nobody listed yet.</p>')}</div>${gallery}`;
      if (!s.markdown && !gallery) cls = 'empty';
    } else {
      body = `<div class="md">${md(s.markdown) || '<p>Nothing here yet.</p>'}</div>`;
      if (!s.markdown) cls = 'empty';
    }
    const wide = s.kind === 'preamble' || (s.markdown && s.markdown.length > 900) ? 'wide' : '';
    return `<article class="pcard ${cls} ${wide}" data-kind="${esc(s.kind)}">${heading}${body}</article>`;
  }

  function logCard() {
    if (!office.log) return '';
    const days = office.log;
    const render = (d) => `<li class="day"><div class="date">${esc(d.date || 'undated')}</div>${d.entries.map((e) => `<div class="entry">${e.title ? `<b>${esc(e.title)}</b>` : ''}<div class="md">${md(e.body)}</div></div>`).join('')}</li>`;
    let count = 0;
    const first = [], rest = [];
    for (const d of days) {
      const group = { ...d, entries: [] };
      for (const e of d.entries) { (count < 5 ? first : rest).push({ ...group, entries: [e] }); count++; }
    }
    const merge = (list) => list.map(render).join('');
    return `<article class="pcard wide"><h2>Log</h2>${days.length === 0 ? '<div class="md"><p>No entries yet.</p></div>' : `<ul class="timeline">${merge(first)}</ul>${rest.length ? `<details class="more"><summary>${rest.length} earlier ${rest.length === 1 ? 'entry' : 'entries'}</summary><ul class="timeline">${merge(rest)}</ul></details>` : ''}`}</article>`;
  }

  function readmeCard() {
    if (office.readme === null) return '';
    return `<article class="pcard wide"><details class="about"><summary>About this office</summary><div class="md">${md(office.readme)}</div></details></article>`;
  }

  /* ---------- the conversation ---------- */
  const convo = { session: null, messages: [], from: 0, total: 0, sessions: [], live: false, timer: null, stuck: true };

  function msgHTML(m) {
    const when = m.at ? new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const tools = (m.tools || []).map((t) => `<details class="tool ${t.isError ? 'err' : ''}"><summary><b>${esc(t.name)}</b> ${esc(t.input)}</summary>${t.result ? `<pre>${esc(t.result)}</pre>` : '<pre>(no result recorded)</pre>'}</details>`).join('');
    const body = m.role === 'user' ? `<div class="md">${markdown(m.text)}</div>` : `<div class="md">${m.text ? markdown(m.text) : ''}</div>${tools}`;
    return `<div class="msg ${esc(m.role)} ${m.apiError ? 'error' : ''}" data-i="${m.i}"><div class="who">${m.role === 'user' ? 'you' : esc(office.name)}<span class="t">${esc(when)}</span></div><div class="body">${body}</div></div>`;
  }

  function renderConvo() {
    const box = $('#convo');
    if (!box) return;
    const picker = convo.sessions.length > 1
      ? `<select id="sesspick">${convo.sessions.map((s) => `<option value="${esc(s.id)}" ${s.id === convo.session ? 'selected' : ''}>${s.live ? '● live · ' : ''}${esc(new Date(s.mtime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${esc(s.id.slice(0, 8))}</option>`).join('')}</select>`
      : '';
    const bar = `<div class="tools-bar">${convo.session ? `<span>${convo.live ? '<span class="dot busy"></span> live session' : 'transcript'} · ${convo.total} message${convo.total === 1 ? '' : 's'}</span>` : ''}${picker}<span>${convo.session ? 'Everything ' + esc(office.name) + ' said in the terminal, as recorded by Claude Code. Tool calls are folded; click one to see what it did.' : ''}</span></div>`;
    if (!convo.session) {
      box.innerHTML = `<h2>Conversation</h2>${bar}<div class="none">No transcript on this Mac for this office yet. Transcripts appear once a session has run in the office folder in a terminal here; sessions from the desktop app or the cloud leave none.</div>`;
      return;
    }
    const earlier = convo.from > 0 ? `<button class="btn earlier" id="earlier">Show ${Math.min(60, convo.from)} earlier</button>` : '';
    box.innerHTML = `<h2>Conversation</h2>${bar}<div class="msgs" id="msgs">${earlier}${convo.messages.map(msgHTML).join('') || '<div class="none">Nothing said yet.</div>'}</div>`;
    const msgs = $('#msgs');
    if (convo.stuck) msgs.scrollTop = msgs.scrollHeight;
    msgs.addEventListener('scroll', () => { convo.stuck = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40; });
    const pick = $('#sesspick');
    if (pick) pick.addEventListener('change', () => { convo.session = pick.value; convo.messages = []; convo.stuck = true; loadConvo({ reset: true }); });
    const more = $('#earlier');
    if (more) more.addEventListener('click', () => loadConvo({ before: convo.from }));
  }

  async function loadConvo({ before = null, reset = false } = {}) {
    try {
      const q = new URLSearchParams();
      if (convo.session && !reset) q.set('session', convo.session);
      if (reset && convo.session) q.set('session', convo.session);
      if (before !== null) q.set('before', String(before));
      const r = await getJSON(`/api/transcript/${encodeURIComponent(id)}?${q}`);
      convo.sessions = r.sessions; convo.total = r.total; convo.live = !!r.live;
      if (before !== null) {
        /* Prepend the earlier page and keep the scroll where it was. */
        const msgs = $('#msgs'); const h = msgs ? msgs.scrollHeight : 0;
        convo.messages = r.messages.concat(convo.messages); convo.from = r.from; convo.stuck = false;
        renderConvo();
        const m2 = $('#msgs'); if (m2) m2.scrollTop = m2.scrollHeight - h;
        return;
      }
      if (convo.session !== r.session) { convo.messages = []; convo.stuck = true; }
      convo.session = r.session;
      /* A poll returns the tail; merge by message index so earlier pages stay. */
      if (convo.messages.length && r.messages.length && r.from <= convo.messages[0].i) convo.messages = r.messages;
      else if (convo.messages.length) { const known = new Set(convo.messages.map((m) => m.i)); const fresh = r.messages.filter((m) => !known.has(m.i)); const last = convo.messages[convo.messages.length - 1]; if (last) { const upd = r.messages.find((m) => m.i === last.i); if (upd) convo.messages[convo.messages.length - 1] = upd; } convo.messages = convo.messages.concat(fresh); }
      else { convo.messages = r.messages; convo.from = r.from; }
      if (!convo.messages.length) convo.from = r.from;
      renderConvo();
    } catch (err) {
      const box = $('#convo'); if (box) box.innerHTML = `<h2>Conversation</h2><div class="none">${esc(err.message)}</div>`;
    }
  }

  function startConvoPolling() {
    if (convo.timer) clearInterval(convo.timer);
    convo.timer = setInterval(() => { if (document.visibilityState === 'visible') loadConvo(); }, 4000);
  }

  function renderMain() {
    const sections = office.briefing ? office.briefing.sections : [];
    const cards = sections.map(sectionCard).join('');
    const convoCard = '<article class="pcard wide convo" id="convo"><h2>Conversation</h2><div class="none">Loading…</div></article>';
    $('#main').innerHTML = convoCard + (office.briefing === null ? '<article class="pcard empty"><h2>Briefing</h2><div class="md"><p>No briefing.md yet.</p></div></article>' : cards) + logCard() + readmeCard();
    convo.stuck = true;
    loadConvo();
    if (location.hash === '#conversation') setTimeout(() => { const c = $('#convo'); if (c) c.scrollIntoView({ behavior: 'smooth' }); }, 300);
  }

  function renderSide() {
    const files = office.files || [];
    const l = office.launch || {};
    const how = office.session
      ? `${esc(office.name)}'s session is running. <b>Open session</b> copies the command to reach it.`
      : `Press <b>Open session</b> to copy a terminal command to the clipboard. Open a terminal, paste it, and Claude Code starts in this folder as ${esc(office.name)}, the ${esc(office.role || 'assistant')}. Say hello; the floor updates within seconds.`;
    $('#side').innerHTML = `
      <div class="side how"><h3>Talking to ${esc(office.name)}</h3>${how}</div>
      <div class="side"><h3>Also in this folder</h3>${files.length ? `<ul>${files.map((f) => `<li class="${f.endsWith('/') ? 'dir' : ''}">${esc(f)}</li>`).join('')}</ul>` : '<span class="k">Nothing beyond AAR\'s own files.</span>'}</div>
      <div class="side"><h3>Launch settings</h3><dl>
        <dt class="k">model</dt><dd>${esc(l.model || '—')}</dd>
        <dt class="k">name</dt><dd>${esc(l.name || '—')}</dd>
        <dt class="k">resume</dt><dd>${l.resume ? 'yes' : 'no'}</dd>
        ${l.addDir ? `<dt class="k">add_dir</dt><dd>${esc(l.addDir)}</dd>` : ''}
        <dt class="k">folder</dt><dd>${esc(office.folder)}</dd>
      </dl></div>
      ${office.session ? `<div class="side"><h3>Session</h3><dl><dt class="k">status</dt><dd>${esc(office.session.status)}</dd><dt class="k">kind</dt><dd>${esc(office.session.kind)}</dd><dt class="k">name</dt><dd>${esc(office.session.name || '—')}</dd><dt class="k">started</dt><dd>${esc(relTime(office.session.startedAt))}</dd>${office.sessions.length ? `<dt class="k">others</dt><dd>${office.sessions.map((s) => esc(s.name || s.id.slice(0, 8)) + ' (' + esc(s.status) + ')').join('<br>')}</dd>` : ''}</dl></div>` : ''}`;
  }

  function renderStage() {
    const st = office.status;
    const line = (label, value, cls) => `<span class="line ${cls} ${value ? '' : 'empty'}"><b>${label}</b>${value ? esc(value) : '—'}</span>`;
    const body = st
      ? line('Now', st.now, 'now') + line('Need from you', st.need, 'need') + line('Next', st.next, 'next')
      : `${esc(office.bubble.text)}<span class="src">${office.bubble.source === 'none' ? 'no status.md yet' : office.bubble.source === 'away' ? 'from their last session' : 'their last message'}</span>`;
    $('#stage').innerHTML = `${standee(office, office.liveness === 'none' ? 'off' : '')}<div class="bubble">${body}</div>`;
  }

  function renderHead() {
    document.title = `${office.name} · ${office.role || id}`;
    $('#name').textContent = office.name;
    $('#role').textContent = office.role || '';
    $('#dot').className = 'dot ' + office.liveness;
    $('#badges').innerHTML = badges(office.badges);
    $('#heard').textContent = 'last heard ' + relTime(office.lastHeard);
    $('#heard').dataset.heard = office.lastHeard || '';
    $('#tabs').innerHTML = office.cos ? `<a class="on" href="#">Office</a><a href="/cos">Cross-office</a>` : '';
    document.body.style.setProperty('--accent', office.accent || '#5b7c99');
    if (office.officeImage) { document.body.style.backgroundImage = `url("${office.officeImage}")`; document.body.classList.add('scene'); }
    else { document.body.style.backgroundImage = ''; document.body.classList.remove('scene'); }
  }

  function render() {
    const json = JSON.stringify(office);
    if (json === lastJSON) return;
    const first = lastJSON === null;
    lastJSON = json;
    renderHead(); renderStage(); renderSide();
    /* The main column re-renders in full only the first time; afterwards the
       briefing cards refresh in place so the conversation keeps its scroll. */
    if (first) { renderMain(); startConvoPolling(); }
    else {
      const sections = office.briefing ? office.briefing.sections : [];
      const keep = $('#convo');
      $('#main').innerHTML = '';
      $('#main').appendChild(keep);
      $('#main').insertAdjacentHTML('beforeend', (office.briefing === null ? '<article class="pcard empty"><h2>Briefing</h2><div class="md"><p>No briefing.md yet.</p></div></article>' : sections.map(sectionCard).join('')) + logCard() + readmeCard());
      loadConvo();
    }
  }

  $('#launch').addEventListener('click', async () => {
    try {
      const r = await getJSON('/api/launch/' + encodeURIComponent(id));
      if (r.command) { await navigator.clipboard.writeText(r.command); toast('Copied to clipboard: ' + r.command); }
      else toast(r.note);
    } catch (ex) { toast('Could not copy: ' + ex.message); }
  });

  setInterval(() => { const el = $('#heard'); if (el.dataset.heard) el.textContent = 'last heard ' + relTime(el.dataset.heard); }, 15000);

  connect('/api/events', (f) => {
    if (f.type === 'init') {
      const o = f.offices.find((x) => x.id === id);
      if (!o) { $('#main').innerHTML = `<div class="pcard"><div class="md">No office called <b>${esc(id)}</b>. <a href="/">Back to the lobby.</a></div></div>`; return; }
      office = o; render();
    } else if (f.type === 'office' && f.office.id === id) {
      office = f.office; render();
    }
  });
})();
