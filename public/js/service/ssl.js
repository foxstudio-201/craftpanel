/* SSL tab (Static) — real certificate status per domain, read from the live
   served certificate via Caddy. Issuer + expiry come from the actual cert; no
   fabricated statuses. */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  window.ServiceTabs.ssl = async function ({ content, server }) {
    const { escapeHtml, fmt, toastSuccess, toastError } = ui;
    const id = server.id;

    content.innerHTML = `
      <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
        <p class="text-slate-400 text-sm">TLS certificates are provisioned and auto-renewed by the reverse proxy once a domain is verified.</p>
        <button id="refresh" class="btn btn-ghost"><i data-lucide="refresh-cw" class="w-4 h-4"></i> Refresh status</button>
      </div>
      <div id="rows" class="space-y-3"><p class="text-slate-500 text-sm">Checking certificates…</p></div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    const badge = (d) => {
      if (d.ssl === 'active') return '<span class="badge badge-success"><i data-lucide="lock" class="w-3 h-3"></i> Secured</span>';
      if (d.ssl === 'error') return '<span class="badge badge-danger">Error</span>';
      return '<span class="badge badge-warn">Pending</span>';
    };
    const expiryNote = (d) => {
      if (!d.sslExpiry) return 'No certificate issued yet';
      const days = Math.round((new Date(d.sslExpiry) - Date.now()) / 86400000);
      return `Issued by ${escapeHtml(d.sslIssuer || 'CA')} · expires ${new Date(d.sslExpiry).toLocaleDateString()} (${days}d)`;
    };

    async function load() {
      let domains = [];
      try { domains = (await api.get(`/servers/${id}/ssl`)).domains; }
      catch (e) { document.getElementById('rows').innerHTML = `<p class="text-red-300 text-sm">${escapeHtml(e.message)}</p>`; return; }
      const rows = document.getElementById('rows');
      rows.innerHTML = domains.length ? domains.map((d) => `
        <div class="glass glass-card p-4 flex items-center justify-between flex-wrap gap-3" data-id="${d.id}">
          <div>
            <p class="font-semibold flex items-center gap-2">${escapeHtml(d.domain)} ${badge(d)}</p>
            <p class="text-xs text-slate-500 mt-1">${expiryNote(d)}</p>
            ${!d.verified ? '<p class="text-xs text-amber-300 mt-1">DNS not verified — point the domain here and verify it on the Domains page.</p>' : ''}
          </div>
          <button data-renew="${d.id}" class="btn btn-sm btn-ghost"><i data-lucide="rotate-cw" class="w-4 h-4"></i> Renew / re-check</button>
        </div>`).join('')
        : `<div class="glass glass-card p-10 text-center text-slate-500">No domains yet — add one on the <a href="/service/${id}/domains" class="text-brand-400 hover:underline">Domains</a> page.</div>`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      rows.querySelectorAll('[data-renew]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await api.post(`/servers/${id}/domains/${b.dataset.renew}/ssl/renew`); toastSuccess('Certificate re-checked'); load(); }
        catch (e) { toastError(e.message); b.disabled = false; }
      }));
    }

    document.getElementById('refresh').addEventListener('click', load);
    await load();
  };
})();
