/* render.js: small helpers shared by the pages: escaping, sanitised
   Markdown, relative time, badges and the standee. */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* Markdown to HTML with scripts, event handlers and javascript: links
     removed. The renderer is the vendored marked; without it, escaped text. */
  function markdown(text) {
    if (!text) return '';
    if (!window.marked) return '<p>' + esc(text).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>') + '</p>';
    const html = window.marked.parse(String(text), { gfm: true, breaks: false });
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    tpl.content.querySelectorAll('script, style, iframe, object, embed, form').forEach((n) => n.remove());
    tpl.content.querySelectorAll('*').forEach((el) => {
      for (const attr of [...el.attributes]) {
        const name = attr.name.toLowerCase();
        const value = String(attr.value).trim().toLowerCase();
        if (name.startsWith('on') || ((name === 'href' || name === 'src') && (value.startsWith('javascript:') || value.startsWith('data:text/html')))) el.removeAttribute(attr.name);
      }
      if (el.tagName === 'A') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); }
    });
    return tpl.innerHTML;
  }

  function relTime(iso, now = Date.now()) {
    if (!iso) return 'never';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return 'never';
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 36) return `${h}h ago`;
    const d = Math.round(h / 24);
    if (d < 14) return `${d}d ago`;
    return new Date(t).toLocaleDateString();
  }

  function clock(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  const BADGE_LABEL = { needsYou: 'Needs you', unpushed: 'Unpushed', behind: 'Behind', stuck: 'Stuck' };
  function badges(list) {
    return (list || []).map((b) => `<span class="badge ${esc(b)}" title="${esc(BADGE_TITLE[b] || '')}">${esc(BADGE_LABEL[b] || b)}</span>`).join('');
  }
  const BADGE_TITLE = {
    needsYou: 'Their status.md has a "Need from you" line',
    unpushed: 'The staff repo has commits not yet pushed to origin',
    behind: 'Origin has commits this Mac has not pulled',
    stuck: 'Their last message is an API error, or they have been busy unusually long'
  };

  /* A neutral silhouette for an office with no picture. Tinted with the
     office accent so cards still tell apart. */
  function silhouette(accent) {
    const c = esc(accent || '#9a9284');
    return `<svg viewBox="0 0 90 170" aria-hidden="true"><g fill="${c}" opacity="0.75"><circle cx="45" cy="30" r="22"/><path d="M12 170 L12 95 Q12 62 45 60 Q78 62 78 95 L78 170 Z"/></g></svg>`;
  }

  function standee(office, cls = '') {
    const inner = office.avatar && office.avatar.url
      ? `<img src="${esc(office.avatar.url)}" alt="${esc(office.name)}">`
      : silhouette(office.accent);
    return `<a class="standee ${cls}" href="/office/${encodeURIComponent(office.id)}" title="Open ${esc(office.name)}'s office">${inner}</a>`;
  }

  function toast(text) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), 2200);
  }

  window.AAR = window.AAR || {};
  Object.assign(window.AAR, { esc, markdown, relTime, clock, badges, standee, silhouette, toast });
})();
