/* Domains — admin domain & reverse-proxy manager with DNS verification. */
Layout.mount(async (content) => {
  const { escapeHtml, fmt, modal, confirmDialog, toastSuccess, toastError } = ui;
  let types = [];

  content.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
      <p class="text-slate-400 text-sm">Map domains to servers. Caddy provides automatic HTTPS using the generated config.</p>
      <button id="new" class="btn btn-primary"><i data-lucide="plus" class="w-4 h-4"></i> Add Domain</button>
    </div>
    <div class="glass glass-card p-0 overflow-hidden"><div class="overflow-x-auto"><table class="table"><thead><tr><th>Domain</th><th>Type</th><th>Target</th><th>Verified</th><th>SSL</th><th class="text-right">Actions</th></tr></thead><tbody id="rows"></tbody></table></div></div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  async function load() {
    const d = await api.get('/domains');
    types = d.types;
    const servers = await api.get('/servers').then((r) => r.servers).catch(() => []);
    window._servers = servers;
    document.getElementById('rows').innerHTML = d.domains.length ? d.domains.map((dm) => `<tr data-id="${dm.id}">
      <td class="font-semibold">${escapeHtml(dm.domain)}</td><td><span class="badge badge-muted">${dm.type}</span></td>
      <td class="text-slate-400 font-mono text-xs">${escapeHtml(dm.target || '—')}</td>
      <td>${dm.verified ? '<span class="badge badge-success">verified</span>' : '<span class="badge badge-warn">pending</span>'}</td>
      <td class="text-xs">${escapeHtml(dm.ssl || '—')}</td>
      <td class="text-right whitespace-nowrap">
        <button data-act="verify" class="btn btn-sm btn-ghost" title="Verify DNS"><i data-lucide="check-circle" class="w-4 h-4"></i></button>
        <button data-act="config" class="btn btn-sm btn-ghost" title="Caddy config"><i data-lucide="file-code" class="w-4 h-4"></i></button>
        <button data-act="delete" class="btn btn-sm btn-ghost text-red-300" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </td></tr>`).join('') : `<tr><td colspan="6" class="text-center text-slate-500 py-8">No domains.</td></tr>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => onAction(b.closest('[data-id]').dataset.id, b.dataset.act)));
  }

  async function onAction(id, act) {
    try {
      if (act === 'verify') { const r = await api.post(`/domains/${id}/verify`); toastSuccess(r.domain?.verified ? 'Verified' : 'Not pointing here yet'); load(); }
      else if (act === 'config') { const r = await api.get(`/domains/${id}/config`); modal({ title: 'Caddyfile', body: `<p class="text-xs text-slate-400 mb-2">Add to your Caddyfile — Caddy issues SSL automatically on reload.</p><pre class="console" style="height:auto">${escapeHtml(r.caddyfile)}</pre>`, footer: `<button data-close class="btn btn-primary">Done</button>` }); }
      else if (act === 'delete') { if (!(await confirmDialog({ title: 'Remove domain?', message: '', confirmText: 'Remove', danger: true }))) return; await api.del(`/domains/${id}`); toastSuccess('Removed'); load(); }
    } catch (e) { toastError(e.message); }
  }

  document.getElementById('new').addEventListener('click', () => {
    const m = modal({ title: 'Add domain', body: `
      <form id="f" class="space-y-3">
        <div><label class="label">Domain</label><input name="domain" class="input" placeholder="play.example.com" required></div>
        <div><label class="label">Type</label><select name="type" class="select">${types.map((t) => `<option>${t}</option>`).join('')}</select></div>
        <div><label class="label">Server (target)</label><select name="serverId" class="select"><option value="">— manual target —</option>${(window._servers || []).map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (${s.allocation.port})</option>`).join('')}</select></div>
        <div><label class="label">Manual target (optional)</label><input name="target" class="input" placeholder="127.0.0.1:25700"></div>
      </form>`,
      footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="s" class="btn btn-primary">Add</button>` });
    m.$('#s').addEventListener('click', async () => { const body = Object.fromEntries(new FormData(m.$('#f'))); try { await api.post('/domains', body); m.close(); toastSuccess('Domain added'); load(); } catch (e) { toastError(e.message); } });
  });

  load();
});
