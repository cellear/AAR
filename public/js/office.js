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
  const talk = { state: null, draft: '', pendingText: '', countAtSend: undefined };

  function msgHTML(m) {
    const when = m.at ? new Date(m.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
    const tools = (m.tools || []).map((t) => `<details class="tool ${t.isError ? 'err' : ''}"><summary><b>${esc(t.name)}</b> ${esc(t.input)}</summary>${t.result ? `<pre>${esc(t.result)}</pre>` : '<pre>(no result recorded)</pre>'}</details>`).join('');
    const body = m.role === 'user' ? `<div class="md">${markdown(m.text)}</div>` : `<div class="md">${m.text ? markdown(m.text) : ''}</div>${tools}`;
    return `<div class="msg ${esc(m.role)} ${m.apiError ? 'error' : ''}" data-i="${m.i}"><div class="who">${m.role === 'user' ? 'you' : esc(office.name)}<span class="t">${esc(when)}</span></div><div class="body">${body}</div></div>`;
  }

  const drawn = new Map();   /* message index -> JSON last drawn */

  function barHTML() {
    const picker = convo.sessions.length > 1
      ? `<select id="sesspick">${convo.sessions.map((s) => `<option value="${esc(s.id)}" ${s.id === convo.session ? 'selected' : ''}>${s.live ? '● live · ' : ''}${esc(new Date(s.mtime).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} · ${esc(s.id.slice(0, 8))}</option>`).join('')}</select>`
      : '';
    return `<div class="tools-bar">${convo.session ? `<span>${convo.live ? '<span class="dot busy"></span> live session' : 'transcript'} · ${convo.total} message${convo.total === 1 ? '' : 's'}</span>` : ''}${picker}<span>${convo.session ? 'Everything ' + esc(office.name) + ' said in the terminal, as recorded by Claude Code. Tool calls are folded; click one to see what it did.' : ''}</span></div>`;
  }

  /* Draw the card. The message list is patched, not rebuilt: existing
     messages stay where they are (open tool details and all), changed ones
     are replaced in place, new ones appended, earlier pages prepended with
     the scroll held steady. The scroll position is only ever moved when the
     reader was already at the bottom. */
  function renderConvo({ prepended = 0 } = {}) {
    const box = $('#convo');
    if (!box) return;
    if (!convo.session) {
      /* No transcript yet. Keep any provisional messages the talk stream
         has drawn; only build the empty state when there is nothing. */
      const existing = $('#msgs');
      if (existing && existing.querySelector('.msg')) return;
      box.innerHTML = `<h2>Conversation</h2>${barHTML()}<div class="none">No transcript on this Mac for this office yet. Transcripts appear once a session has run in the office folder in a terminal here, or once you start talking below; sessions from the desktop app or the cloud leave none.</div><div class="msgs" id="msgs" style="display:none"></div>`;
      drawn.clear();
      renderReply();
      return;
    }
    let msgs = $('#msgs');
    if (!msgs) {
      box.innerHTML = `<h2>Conversation</h2>${barHTML()}<div class="msgs" id="msgs"><button class="btn earlier" id="earlier" style="display:none"></button></div>`;
      renderReply();
      msgs = $('#msgs');
      drawn.clear();
      msgs.addEventListener('scroll', () => { convo.stuck = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40; });
      msgs.addEventListener('click', (e) => { if (e.target.closest('#earlier')) loadConvo({ before: convo.from }); });
    } else {
      const bar = box.querySelector('.tools-bar');
      const fresh = barHTML();
      if (bar && bar.outerHTML !== fresh) bar.outerHTML = fresh;
    }
    const pick = $('#sesspick');
    if (pick && !pick.dataset.wired) { pick.dataset.wired = '1'; pick.addEventListener('change', () => { convo.session = pick.value; convo.messages = []; convo.stuck = true; drawn.clear(); msgs.querySelectorAll('.msg').forEach((n) => n.remove()); loadConvo({ reset: true }); }); }

    const before = msgs.scrollHeight;
    const top = msgs.scrollTop;
    const wasStuck = convo.stuck;
    const earlier = $('#earlier');
    earlier.style.display = convo.from > 0 ? '' : 'none';
    earlier.textContent = `Show ${Math.min(60, convo.from)} earlier`;

    /* Remove anything drawn that is no longer in the list (a truncated file). */
    const keep = new Set(convo.messages.map((m) => m.i));
    for (const el of [...msgs.querySelectorAll('.msg')]) if (!keep.has(Number(el.dataset.i))) { el.remove(); drawn.delete(Number(el.dataset.i)); }

    let anchor = earlier;   /* insert after this */
    for (const m of convo.messages) {
      const json = JSON.stringify(m);
      let el = msgs.querySelector(`.msg[data-i="${m.i}"]`);
      if (!el) {
        anchor.insertAdjacentHTML('afterend', msgHTML(m));
        el = anchor.nextElementSibling;
      } else if (drawn.get(m.i) !== json) {
        /* Keep any tool details the reader opened. */
        const open = new Set([...el.querySelectorAll('details[open]')].map((d, i) => i));
        el.outerHTML = msgHTML(m);
        el = msgs.querySelector(`.msg[data-i="${m.i}"]`);
        [...el.querySelectorAll('details')].forEach((d, i) => { if (open.has(i)) d.open = true; });
      }
      drawn.set(m.i, json);
      anchor = el;
    }
    /* Provisional messages from the talk stream go once the transcript has
       caught up with them. */
    if (talk.countAtSend !== undefined && convo.messages.length > talk.countAtSend) { msgs.querySelectorAll('.msg.settled, .msg.pending').forEach((n) => n.remove()); talk.countAtSend = undefined; }
    if (!convo.messages.length && !msgs.querySelector('.none') && !msgs.querySelector('.msg')) msgs.insertAdjacentHTML('beforeend', '<div class="none">Nothing said yet.</div>');
    if (convo.messages.length) { const n = msgs.querySelector('.none'); if (n) n.remove(); }

    if (prepended) msgs.scrollTop = top + (msgs.scrollHeight - before);   /* hold the reader's place */
    else if (wasStuck) msgs.scrollTop = msgs.scrollHeight;          /* follow the tail */
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
        convo.messages = r.messages.concat(convo.messages); convo.from = r.from; convo.stuck = false;
        renderConvo({ prepended: r.messages.length });
        return;
      }
      if (convo.session !== r.session) { convo.messages = []; convo.stuck = true; drawn.clear(); const m0 = $('#msgs'); if (m0) m0.querySelectorAll('.msg').forEach((n) => n.remove()); }
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

  /* ---------- talking ---------- */

  function talkStatusLine() {
    const t = talk.state;
    if (!t) return '';
    if (!t.available) return '';
    const dot = `<span class="dot ${t.running ? (t.phase === 'idle' ? 'idle' : 'busy') : 'none'}"></span>`;
    let text;
    if (!t.running) text = t.sessionId ? `Not running. Send a message to pick up the last conversation, or Start.` : `No session yet. Send a message or press Start; ${esc(office.name)} runs here, in this office, until you Stop.`;
    else if (t.phase === 'thinking') text = `${esc(office.name)} is thinking…`;
    else if (t.phase === 'waiting') text = `${esc(office.name)} is waiting for your answer below.`;
    else text = `${esc(office.name)} is listening${t.model ? ' · ' + esc(t.model) : ''}.`;
    const err = t.error ? `<span class="err">${esc(t.error)}</span>` : '';
    return `${dot}<span>${text}</span>${err}`;
  }

  function askHTML(p) {
    return `<div class="ask" data-req="${esc(p.requestId)}"><b>${esc(office.name)} wants to use ${esc(p.tool)}</b><code>${esc(p.input || '(no details)')}</code>
      <div class="rrow"><button class="btn primary" data-allow="1">Allow</button><button class="btn" data-allow="0">Deny</button><span class="hint">Nothing runs until you answer.</span></div></div>`;
  }

  function renderReply() {
    let box = $('#reply');
    const convoCard = $('#convo');
    if (!convoCard) return;
    if (!talk.state || !talk.state.available) { if (box) box.remove(); return; }
    if (!box) { box = document.createElement('div'); box.className = 'reply'; box.id = 'reply'; convoCard.appendChild(box); }
    const t = talk.state;
    const busy = t.running && t.phase !== 'idle';
    const draft = box.querySelector('textarea') ? box.querySelector('textarea').value : talk.draft;
    box.innerHTML = `<div class="rstatus">${talkStatusLine()}</div>
      ${(t.pending || []).map(askHTML).join('')}
      <textarea id="say" placeholder="Talk to ${esc(office.name)}… (Enter to send, Shift+Enter for a new line)" ${busy ? 'disabled' : ''}></textarea>
      <div class="rrow"><button class="btn primary" id="send" ${busy ? 'disabled' : ''}>Send</button>
        ${t.running ? '<button class="btn" id="stoptalk">Stop</button>' : '<button class="btn" id="starttalk">Start</button>'}
        ${!t.running && t.sessionId ? '<button class="btn" id="forgettalk" title="Forget the remembered conversation; the next Start begins fresh">New conversation</button>' : ''}
        <span class="hint">Sessions you open in a terminal are separate; this one is AAR's.</span></div>`;
    box.querySelector('textarea').value = draft;
  }

  /* The event stream is the source of truth for talk state; a POST's reply
     can be older than frames that already arrived, so it is not trusted for
     state, only for errors. */
  async function talkPost(verb, body) {
    try {
      const r = await getJSON(`/api/talk/${encodeURIComponent(id)}/${verb}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      await loadTalk();
      return r;
    } catch (err) { toast(err.message); await loadTalk(); return null; }
  }

  /* A provisional message at the end of the list while a reply streams;
     the transcript poll replaces it with the real thing. */
  function pendingEl(role) {
    const msgs = $('#msgs');
    if (!msgs) return null;
    if (msgs.style.display === 'none') { msgs.style.display = ''; const n = $('#convo .none'); if (n) n.remove(); }
    let el = msgs.querySelector(`.msg.pending.${role}`);
    if (!el) {
      msgs.insertAdjacentHTML('beforeend', `<div class="msg ${role} pending"><div class="who">${role === 'user' ? 'you' : esc(office.name)}<span class="t">now</span></div><div class="body"><div class="md"></div></div></div>`);
      el = msgs.querySelector(`.msg.pending.${role}`);
    }
    return el;
  }

  function onTalkFrame(f) {
    if (f.office !== id) return;
    if (f.type === 'permission') {
      if (f.answered) { if (talk.state) talk.state.pending = (talk.state.pending || []).filter((p) => p.requestId !== f.requestId); }
      else { if (talk.state) { talk.state.pending = [...(talk.state.pending || []), f]; talk.state.phase = 'waiting'; talk.state.running = true; } }
      renderReply(); renderHeadAsk();
      return;
    }
    switch (f.kind) {
      case 'sent': {
        talk.countAtSend = convo.messages.length;
        const el = pendingEl('user'); if (el) el.querySelector('.md').innerHTML = markdown(f.text);
        talk.pendingText = '';
        const msgs = $('#msgs'); if (msgs) msgs.scrollTop = msgs.scrollHeight;
        break;
      }
      case 'delta': {
        talk.pendingText += f.text;
        const el = pendingEl('assistant'); if (el) el.querySelector('.md').innerHTML = markdown(talk.pendingText);
        if (convo.stuck) { const msgs = $('#msgs'); if (msgs) msgs.scrollTop = msgs.scrollHeight; }
        break;
      }
      case 'result': case 'stopped': case 'error': case 'phase': case 'init': case 'started':
        if (talk.state) { if (f.phase) talk.state.phase = f.phase; if (f.kind === 'stopped') { talk.state.running = false; talk.state.phase = 'off'; talk.state.pending = []; } if (f.kind === 'started' || f.kind === 'init') { talk.state.running = true; if (f.sessionId) talk.state.sessionId = f.sessionId; if (f.model) talk.state.model = f.model; } if (f.kind === 'error') talk.state.error = f.message; if (f.kind === 'result' && !f.isError) talk.state.error = null; }
        if (f.kind === 'result' || f.kind === 'stopped') { talk.pendingText = ''; document.querySelectorAll('#msgs .msg.pending').forEach((n) => n.classList.replace('pending', 'settled')); loadConvo(); }
        renderReply(); renderHeadAsk();
        break;
      default: break;
    }
  }

  function renderHeadAsk() {
    let pin = $('#askpin');
    const n = talk.state && talk.state.pending ? talk.state.pending.length : 0;
    if (!n) { if (pin) pin.remove(); return; }
    if (!pin) { pin = document.createElement('span'); pin.id = 'askpin'; pin.className = 'askpin'; $('#badges').appendChild(pin); }
    pin.textContent = n === 1 ? 'Waiting for you' : `${n} waiting for you`;
  }

  async function loadTalk() {
    try { talk.state = await getJSON(`/api/talk/${encodeURIComponent(id)}`); } catch { talk.state = null; }
    renderReply(); renderHeadAsk();
  }

  document.addEventListener('click', async (e) => {
    if (e.target.closest('#send')) { const ta = $('#say'); const text = ta.value.trim(); if (!text) return; ta.value = ''; await talkPost('say', { text }); return; }
    if (e.target.closest('#starttalk')) { await talkPost('start'); return; }
    if (e.target.closest('#stoptalk')) { await talkPost('stop'); return; }
    if (e.target.closest('#forgettalk')) { await talkPost('forget'); return; }
    const a = e.target.closest('.ask [data-allow]');
    if (a) { const req = a.closest('.ask').dataset.req; await talkPost('answer', { requestId: req, allow: a.dataset.allow === '1' }); }
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'say' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#send').click(); }
  });

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
    if (first) { renderMain(); startConvoPolling(); loadTalk(); }
    else {
      /* Leave the conversation card in place: detaching a scroll container
         resets its scroll position. Replace only its siblings. */
      const sections = office.briefing ? office.briefing.sections : [];
      const keep = $('#convo');
      for (const el of [...$('#main').children]) if (el !== keep) el.remove();
      keep.insertAdjacentHTML('afterend', (office.briefing === null ? '<article class="pcard empty"><h2>Briefing</h2><div class="md"><p>No briefing.md yet.</p></div></article>' : sections.map(sectionCard).join('')) + logCard() + readmeCard());
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
    } else if (f.type === 'talk' || f.type === 'permission') {
      onTalkFrame(f);
    }
  });
})();
