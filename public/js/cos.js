/* cos.js: the Chief of Staff's cross-office view. Five tabs over /api/cos:
   every office's Need-from-you line, every deadline on one timeline, every
   unchecked box grouped by office, the staff table, and the newest morning
   sheet with a print button. Refetches when any office frame arrives. */
(function () {
  'use strict';
  const { esc, markdown, relTime, clock, badges, silhouette, getJSON, connect } = window.AAR;
  const $ = (sel) => document.querySelector(sel);
  let data = null;
  let offices = {};
  let timer = null;

  function thumb(officeId) {
    const o = offices[officeId];
    if (o && o.avatar && o.avatar.url) return `<span class="thumb"><img src="${esc(o.avatar.url)}" alt=""></span>`;
    return `<span class="thumb">${silhouette(o && o.accent)}</span>`;
  }
  const link = (id, name) => `<a class="tag" href="/office/${encodeURIComponent(id)}">${esc(name)}</a>`;
  const inline = (text) => markdown(text).replace(/^<p>|<\/p>\s*$/g, '');

  function renderNeeds() {
    const list = data.needs;
    $('#p-needs').innerHTML = list.length
      ? `<ul class="needs-list">${list.map((n) => `<li>${thumb(n.office)}<div><div>${inline(n.text)}</div><div class="who">${esc(n.name)} · <a href="/office/${encodeURIComponent(n.office)}">open office</a></div></div></li>`).join('')}</ul>`
      : '<p class="cos-empty">Nobody needs you right now.</p>';
    const c = $('#c-needs'); c.textContent = list.length; c.classList.toggle('hot', list.length > 0);
  }

  function renderDeadlines() {
    const today = data.horizon.from, to = data.horizon.to;
    const groups = { past: [], soon: [], later: [], undated: [] };
    for (const d of data.deadlines) groups[!d.date ? 'undated' : d.date < today ? 'past' : d.date <= to ? 'soon' : 'later'].push(d);
    const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    const list = (items, cls) => `<ul class="deadlines">${items.map((d) => `<li class="${cls}"><span class="when">${d.date ? esc(fmt(d.date)) : 'undated'}</span><span>${inline(d.text)}</span>${link(d.office, d.name)}</li>`).join('')}</ul>`;
    const titles = { past: 'Overdue', soon: 'Next 14 days', later: 'Later', undated: 'Undated' };
    const html = ['past', 'soon', 'later', 'undated'].filter((k) => groups[k].length).map((k) => `<h3>${titles[k]}</h3>${list(groups[k], k)}`).join('');
    $('#p-deadlines').innerHTML = html ? `<div class="dl-groups">${html}</div>` : '<p class="cos-empty">No deadlines in any briefing.</p>';
    $('#c-deadlines').textContent = groups.past.length + groups.soon.length;
  }

  function renderOpen() {
    const groups = data.openItems;
    $('#p-open').innerHTML = groups.length
      ? `<div class="open-groups">${groups.map((g) => `<article class="pcard" style="--accent:${esc((offices[g.office] || {}).accent || '#5b7c99')}"><h2>${esc(g.name)} · ${esc(g.office)}</h2><ul class="checklist">${g.items.map((t) => `<li><span class="box"></span><span>${inline(t)}</span></li>`).join('')}</ul></article>`).join('')}</div>`
      : '<p class="cos-empty">No open items anywhere.</p>';
    $('#c-open').textContent = groups.reduce((n, g) => n + g.items.length, 0);
  }

  function renderStaff() {
    $('#p-staff').innerHTML = `<table class="staff-table"><thead><tr><th>Assistant</th><th>Role</th><th>Model</th><th>Now</th><th>Last heard</th><th>Flags</th></tr></thead><tbody>${data.staff.map((s) => `<tr>
      <td>${thumb(s.office)}<a href="/office/${encodeURIComponent(s.office)}">${esc(s.name)}</a></td>
      <td>${esc(s.role || '')}</td><td>${esc(s.model || '')}</td>
      <td class="bubble-cell"><span class="dot ${esc(s.liveness)}"></span> ${esc(s.bubble.text)}</td>
      <td>${esc(relTime(s.lastHeard))}</td><td>${badges(s.badges)}</td></tr>`).join('')}</tbody></table>`;
  }

  function renderSheet() {
    const ms = data.morningSheet;
    if (!ms || ms.markdown === null) {
      $('#p-sheet').innerHTML = `<p class="cos-empty">No morning sheet yet. ${esc(data.cosName)} writes one to <code>mornings/YYYY-MM-DD.md</code> in the Chief of Staff's office.</p>`;
      return;
    }
    const html = markdown(ms.markdown).replace(/<li>\s*\[ \]\s*/g, '<li><input type="checkbox" disabled> ').replace(/<li>\s*\[x\]\s*/gi, '<li><input type="checkbox" checked disabled> ');
    $('#p-sheet').innerHTML = `<div class="sheet-tools"><span>${esc(ms.file)}${ms.date ? ' · ' + esc(new Date(ms.date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })) : ''}</span><button class="btn" id="print">Print</button><span>Sized for one double-sided page.</span></div><div class="sheet">${html}</div>`;
    $('#print').addEventListener('click', () => window.print());
  }

  function render() {
    $('#name').textContent = data.cosName;
    document.title = `${data.cosName} · cross-office`;
    const cos = offices[data.cos];
    if (cos) { $('#dot').className = 'dot ' + cos.liveness; document.body.style.setProperty('--accent', cos.accent || '#5b7c99'); }
    $('#officeLink').href = '/office/' + encodeURIComponent(data.cos);
    $('#polled').textContent = 'polled ' + clock(data.polledAt);
    renderNeeds(); renderDeadlines(); renderOpen(); renderStaff(); renderSheet();
    showTab();
  }

  function showTab() {
    const tab = (location.hash || '#needs').slice(1);
    document.querySelectorAll('.cos-tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === tab));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('on', p.id === 'p-' + tab));
  }
  window.addEventListener('hashchange', showTab);

  async function load() {
    try {
      data = await getJSON('/api/cos');
      render();
    } catch (err) {
      $('#p-needs').innerHTML = `<p class="cos-empty">${esc(err.message)}. Mark one office with <code>cos=yes</code> in its aa.conf.</p>`;
      $('#p-needs').classList.add('on');
    }
  }

  connect('/api/events', (f) => {
    if (f.type === 'init') { offices = {}; for (const o of f.offices) offices[o.id] = o; load(); }
    else if (f.type === 'office') { offices[f.office.id] = f.office; clearTimeout(timer); timer = setTimeout(load, 300); }
  });
})();
