/* Network tab — this service's allocation (IP, port, protocol, status).
   Admins can reassign the primary port (recreates the container). */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  window.ServiceTabs.network = async function ({ content, server, type }) {
    const { escapeHtml, modal, toastSuccess, toastError } = ui;
    const canAdmin = auth.can('admin');
    const id = server.id;

    async function load() {
      const s = (await api.get(`/servers/${id}`)).server;
      const a = s.allocation || {};
      const extra = a.additionalPorts || [];
      content.innerHTML = `
        <div class="glass glass-card p-5">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-bold">Primary allocation</h3>
            <span class="badge ${s.state === 'running' ? 'badge-success' : 'badge-muted'}">${s.state === 'running' ? '<span class="dot dot-live"></span> active' : 'idle'}</span>
          </div>
          <div class="overflow-x-auto"><table class="table"><thead><tr><th>IP</th><th>Port</th><th>Protocol</th><th>Purpose</th>${canAdmin ? '<th></th>' : ''}</tr></thead><tbody>
            <tr><td class="font-mono">${escapeHtml(a.ip || '—')}</td><td class="font-mono">${a.port ?? '—'}</td><td>tcp</td><td class="text-slate-400">Primary</td>
              ${canAdmin ? `<td class="text-right"><button id="reassign" class="btn btn-sm btn-ghost" title="Reassign"><i data-lucide="arrow-right-left" class="w-4 h-4"></i></button></td>` : ''}</tr>
            ${extra.map((p) => `<tr><td class="font-mono">${escapeHtml(a.ip || '—')}</td><td class="font-mono">${p}</td><td>tcp</td><td class="text-slate-400">Additional</td>${canAdmin ? '<td></td>' : ''}</tr>`).join('')}
          </tbody></table></div>
          ${type === 'static' ? '<p class="text-xs text-slate-500 mt-3">Public access for static sites is served through the reverse proxy — see the <a href="/service/' + id + '/domains" class="text-brand-400 hover:underline">Domains</a> page.</p>' : ''}
        </div>`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });

      document.getElementById('reassign')?.addEventListener('click', () => {
        const m = modal({ title: 'Reassign port', body: `<p class="text-xs text-amber-300 mb-2">Reassigning recreates the container to apply the new binding.</p><label class="label">New port</label><input id="port" class="input" type="number" value="${a.port}">`,
          footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="s" class="btn btn-primary">Reassign</button>` });
        m.$('#s').addEventListener('click', async () => { try { await api.post('/network/reassign', { serverId: id, port: Number(m.$('#port').value) }); m.close(); toastSuccess('Reassigned'); load(); } catch (e) { toastError(e.message); } });
      });
    }
    await load();
  };
})();
