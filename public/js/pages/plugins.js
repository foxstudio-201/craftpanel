/* Plugins — real plugin files + Modrinth marketplace install. */
Layout.mount(async (content) => {
  const { escapeHtml, fmt, modal, confirmDialog, toastSuccess, toastError } = ui;

  const { servers } = await api.get('/servers');
  if (!servers.length) { content.innerHTML = `<div class="glass glass-card p-10 text-center text-slate-500">No servers yet.</div>`; return; }
  let current = servers.find((s) => s.kind !== 'proxy')?.id || servers[0].id;

  content.innerHTML = `
    <div class="glass glass-card p-4 mb-4 flex flex-wrap items-center gap-3">
      <select id="srv" class="select w-auto min-w-[12rem]">${servers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select>
      <span id="count" class="text-sm text-slate-400"></span>
      <div class="ml-auto flex gap-2">
        <button id="url-install" class="btn btn-ghost"><i data-lucide="link" class="w-4 h-4"></i> Install from URL</button>
        <button id="browse" class="btn btn-primary"><i data-lucide="store" class="w-4 h-4"></i> Marketplace</button>
      </div>
    </div>
    <div id="grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger"></div>
    <p class="text-xs text-slate-500 mt-3">Plugins live in the server's <code>/plugins</code> folder. Restart the server to load changes.</p>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  async function load() {
    try {
      const { plugins } = await api.get(`/plugins?serverId=${current}`);
      document.getElementById('count').textContent = `${plugins.length} installed`;
      const grid = document.getElementById('grid');
      grid.innerHTML = plugins.length ? plugins.map(card).join('') : `<div class="glass glass-card p-10 text-center text-slate-500 col-span-full">No plugins installed.</div>`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      grid.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', onAction));
    } catch (e) { toastError(e.message); }
  }

  function card(p) {
    return `<div class="glass glass-card p-5" data-id="${p.id}">
      <div class="flex items-start justify-between">
        <div class="flex items-center gap-3"><div class="w-11 h-11 rounded-xl grid place-items-center bg-accent-500/15 text-accent-400"><i data-lucide="puzzle" class="w-6 h-6"></i></div>
        <div><p class="font-bold leading-tight break-all">${escapeHtml(p.name)}</p><p class="text-xs text-slate-500">${p.size} MB · ${fmt.relative(p.modified)}</p></div></div>
        <span class="badge ${p.enabled ? 'badge-success' : 'badge-muted'}">${p.enabled ? 'Enabled' : 'Disabled'}</span>
      </div>
      <div class="flex flex-wrap gap-2 mt-4">
        <button data-act="toggle" class="btn btn-sm btn-ghost">${p.enabled ? '<i data-lucide="pause" class="w-4 h-4"></i> Disable' : '<i data-lucide="play" class="w-4 h-4"></i> Enable'}</button>
        <button data-act="remove" class="btn btn-sm btn-ghost text-red-300"><i data-lucide="trash-2" class="w-4 h-4"></i> Remove</button>
      </div></div>`;
  }

  async function onAction(e) {
    const id = e.currentTarget.closest('[data-id]').dataset.id;
    const act = e.currentTarget.dataset.act;
    try {
      if (act === 'toggle') await api.put(`/plugins/${id}/toggle`, { serverId: current });
      else if (act === 'remove') { if (!(await confirmDialog({ title: 'Remove plugin?', message: 'Deletes the .jar file.', confirmText: 'Remove', danger: true }))) return; await api.del(`/plugins/${id}?serverId=${current}`); }
      toastSuccess('Done'); load();
    } catch (err) { toastError(err.message); }
  }

  document.getElementById('url-install').addEventListener('click', () => {
    const m = modal({ title: 'Install plugin from URL', body: `<form id="uf" class="space-y-3"><div><label class="label">Direct .jar URL (https)</label><input name="url" class="input" placeholder="https://…/plugin.jar"></div></form>`,
      footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="ui" class="btn btn-primary">Install</button>` });
    m.$('#ui').addEventListener('click', async () => { const url = m.$('[name=url]').value.trim(); if (!url) return; try { await api.post('/plugins/install', { serverId: current, url }); m.close(); toastSuccess('Installed'); load(); } catch (e) { toastError(e.message); } });
  });

  document.getElementById('browse').addEventListener('click', () => {
    const m = modal({ title: 'Plugin Marketplace (Modrinth)', size: 'max-w-3xl', body: `
      <div class="relative mb-3"><i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"></i><input id="mq" class="input pl-9" placeholder="Search plugins…"></div>
      <div id="mres" class="grid sm:grid-cols-2 gap-3 max-h-[55vh] overflow-y-auto pr-1"><p class="text-slate-500 text-sm">Type to search Modrinth…</p></div>`,
      footer: `<button data-close class="btn btn-ghost">Close</button>` });
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    let t;
    m.$('#mq').addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => search(e.target.value, m), 350); });
    search('', m);
  });

  async function search(q, m) {
    const box = m.$('#mres'); box.innerHTML = '<p class="text-slate-500 text-sm">Searching…</p>';
    try {
      const { results } = await api.get(`/plugins/marketplace/search?q=${encodeURIComponent(q)}`);
      box.innerHTML = results.map((r) => `<div class="glass rounded-xl p-3 flex flex-col">
        <div class="flex items-center gap-2"><img src="${r.icon || ''}" onerror="this.style.display='none'" class="w-8 h-8 rounded"><p class="font-semibold truncate">${escapeHtml(r.title)}</p></div>
        <p class="text-xs text-slate-400 my-2 flex-1 line-clamp-2">${escapeHtml(r.description || '')}</p>
        <button data-slug="${escapeHtml(r.slug)}" class="btn btn-sm btn-primary"><i data-lucide="download" class="w-4 h-4"></i> Install</button></div>`).join('') || '<p class="text-slate-500 text-sm">No results.</p>';
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      box.querySelectorAll('[data-slug]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = 'Installing…';
        try { const r = await api.get(`/plugins/marketplace/resolve/${b.dataset.slug}`); await api.post('/plugins/install', { serverId: current, url: r.url, filename: r.filename }); toastSuccess('Installed'); load(); }
        catch (e) { toastError(e.message); b.disabled = false; b.textContent = 'Install'; }
      }));
    } catch (e) { box.innerHTML = `<p class="text-red-300 text-sm">${escapeHtml(e.message)}</p>`; }
  }

  document.getElementById('srv').addEventListener('change', (e) => { current = e.target.value; load(); });
  load();
});
