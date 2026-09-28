/* hire.js: the wizard form. Options (models, starter cast, colours, next
   order number, taken folder names) come from /api/hire/options; the POST to
   /api/hire is the app's one write besides first-run setup. */
(function () {
  'use strict';
  const { esc, getJSON, postJSON, toast } = window.AAR;
  const $ = (sel) => document.querySelector(sel);
  const form = $('#hire');
  let opts = null;

  function renderCast() {
    /* The first picture is preselected; an office's own avatar.png, dropped
       in later, overrides whichever was chosen. */
    $('#cast').innerHTML = opts.cast.map((c, i) => `<label class="${i ? '' : 'on'}"><input type="radio" name="avatar" value="${esc(c.file)}" ${i ? '' : 'checked'}><div class="fig"><img src="${esc(c.faceUrl || c.url)}" alt=""></div></label>`).join('');
    $('#cast').addEventListener('change', () => {
      document.querySelectorAll('#cast label').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    });
  }

  function renderSwatches() {
    $('#swatches').innerHTML = opts.accents.map((a) => `<span class="swatch ${a === $('#accent').value ? 'on' : ''}" data-accent="${esc(a)}" style="background:${esc(a)}" title="${esc(a)}"></span>`).join('');
    $('#swatches').addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (!sw) return;
      $('#accent').value = sw.dataset.accent;
      document.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s === sw));
      form.style.setProperty('--accent', sw.dataset.accent);
    });
  }

  /* Suggest a folder name from the role until the user types one. */
  let folderTouched = false;
  form.folder.addEventListener('input', () => { folderTouched = true; });
  form.role.addEventListener('input', () => { if (!folderTouched) form.folder.value = form.role.value.trim(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#err').textContent = '';
    const data = Object.fromEntries(new FormData(form).entries());
    const btn = form.querySelector('button.primary');
    btn.disabled = true;
    try {
      const r = await postJSON('/api/hire', data);
      $('#done').style.display = '';
      $('#done').innerHTML = `<b>${esc(r.name)} has an office.</b> ${esc(r.folder)}<ul>${r.files.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        <p>Next: read <b>avatar-prompts.md</b> if you want pictures, then open the lobby and press <b>Open session</b> on ${esc(r.name)}'s card to start the first conversation.</p>
        <p><a href="/office/${encodeURIComponent(r.id)}">Open the office</a> · <a href="/">Back to the lobby</a> · <a href="/hire">Hire another</a></p>`;
      $('#done').scrollIntoView({ behavior: 'smooth' });
      toast(`Created ${r.id}`);
    } catch (ex) {
      $('#err').textContent = ex.message;
      btn.disabled = false;
    }
  });

  (async () => {
    try {
      opts = await getJSON('/api/hire/options');
      $('#model').innerHTML = opts.models.map((m) => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
      renderSwatches();
      renderCast();
    } catch (ex) {
      $('#err').textContent = ex.message;
    }
  })();
})();
