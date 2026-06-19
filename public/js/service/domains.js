/* Domains tab — map custom hostnames to this site via the Cloudflare Tunnel.
   Each hostname routes to the service's local port; TLS is terminated at the
   Cloudflare edge. Routes are proposed + validated and go live when an admin
   applies them on the Infrastructure page. */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  window.ServiceTabs.domains = async function ({ content, server }) {
    const { escapeHtml, fmt, modal, confirmDialog, toastSuccess, toastError } = ui;
    const id = server.id;

    content.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
        <p class="text-slate-400 text-sm">Public hostnames routed to this site through the Cloudflare Tunnel.</p>
        <button id="add" class="btn btn-primary"><i data-lucide="plus" class="w-4 h-4"></i> Add hostname</button>
      </div>
      <div class="glass glass-card p-0 overflow-hidden"><div class="overflow-x-auto"><table class="table"><thead><tr><th>Hostname</th><th>Status</th><th>TLS</th><th>Added</th><th class="text-right">Actions</th></tr></thead><tbody id="rows"></tbody></table></div></div>
      <p class="text-xs text-slate-500 mt-3">New hostnames need a matching DNS record (or a wildcard) in Cloudflare. They are <b>proposed</b> until an administrator applies them on the Infrastructure page.</p>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    async function load() {
      const rows = document.getElementById('rows');
      let domains = [];
      try { domains = (await api.get(`/servers/${id}/domains`)).domains; }
      catch (e) { rows.innerHTML = `<tr><td colspan="5" class="text-center text-red-300 py-6">${escapeHtml(e.message)}</td></tr>`; return; }
      rows.innerHTML = domains.length ? domains.map((d) => `<tr data-id="${escapeHtml(d.id)}">
        <td class="font-semibold break-all">${escapeHtml(d.domain)}</td>
        <td>${d.live ? '<span class="badge badge-success"><span class="dot dot-live"></span> live</span>' : '<span class="badge badge-warn">proposed</span>'}</td>
        <td>${d.live ? '<span class="badge badge-info">edge</span>' : '<span class="badge badge-muted">pending</span>'}</td>
        <td class="text-slate-400">${d.createdAt ? fmt.relative(d.createdAt) : '—'}</td>
        <td class="text-right whitespace-nowrap">
          <button data-act="verify" class="btn btn-sm btn-ghost" title="Test connectivity"><i data-lucide="radio" class="w-4 h-4"></i></button>
          <button data-act="delete" class="btn btn-sm btn-ghost text-red-300" title="Remove"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </td></tr>`).join('') : `<tr><td colspan="5" class="text-center text-slate-500 py-8">No hostnames yet.</td></tr>`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      rows.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => onAction(b.closest('[data-id]').dataset.id, b.dataset.act)));
    }

    async function onAction(domainId, act) {
      try {
        if (act === 'verify') { const r = await api.post(`/servers/${id}/domains/${encodeURIComponent(domainId)}/verify`); r.domain?.reachable ? toastSuccess(`Reachable (HTTP ${r.domain.httpStatus})`) : toastError(r.domain?.error || 'Not reachable yet'); }
        else if (act === 'delete') { if (!(await confirmDialog({ title: 'Remove hostname?', message: domainId, confirmText: 'Remove', danger: true }))) return; await api.del(`/servers/${id}/domains/${encodeURIComponent(domainId)}`); toastSuccess('Removed from proposal'); load(); }
      } catch (e) { toastError(e.message); }
    }

    document.getElementById('add').addEventListener('click', () => {
      const m = modal({ title: 'Add hostname', body: `
        <form id="f" class="space-y-3">
          <div><label class="label">Hostname (or subdomain)</label><input name="domain" class="input" placeholder="app.example.com" required></div>
          <p class="text-xs text-slate-500">Routed to this service through the tunnel. Add the matching CNAME in Cloudflare, then apply on the Infrastructure page.</p>
        </form>`,
        footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="s" class="btn btn-primary">Add & validate</button>` });
      m.$('#s').addEventListener('click', async () => {
        const domain = m.$('[name=domain]').value.trim(); if (!domain) return;
        try { const r = await api.post(`/servers/${id}/domains`, { domain }); m.close(); r.domain?.validation?.ok === false ? toastError('Added but invalid: ' + r.domain.validation.output) : toastSuccess('Hostname proposed'); load(); }
        catch (e) { toastError(e.message); }
      });
    });

    load();
  };
})();
