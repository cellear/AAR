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

  function renderMain() {
    const sections = office.briefing ? office.briefing.sections : [];
    const cards = sections.map(sectionCard).join('');
    $('#main').innerHTML = (office.briefing === null ? '<article class="pcard empty"><h2>Briefing</h2><div class="md"><p>No briefing.md yet.</p></div></article>' : cards) + logCard() + readmeCard();
  }

  function renderSide() {
    const files = office.files || [];
    const l = office.launch || {};
    $('#side').innerHTML = `
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
    lastJSON = json;
    renderHead(); renderStage(); renderMain(); renderSide();
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
