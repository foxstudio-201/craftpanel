/* Network — IP & port allocations. Users view; admins manage. */
Layout.mount(async (content) => {
  const { escapeHtml, modal, confirmDialog, toastSuccess, toastError } = ui;
  const canAdmin = auth.can('admin');

  content.innerHTML = `<div id="root"></div>`;
  await load();

  async function load() {
    const d = await api.get('/network');
    document.getElementById('root').innerHTML = `
      ${canAdmin && d.stats ? `<section class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4 stagger">
        ${stat('IP addresses', d.stats.ips, 'globe', 'brand')}
        ${stat('Allocated ports', d.stats.allocated, 'plug', 'accent')}
        ${stat('Free ports', d.stats.free, 'circle-dot', 'info')}
        ${stat('Port range', d.pool.range, 'hash', 'warn')}
      </section>` : ''}

      ${canAdmin && d.ips ? `<div class="glass glass-card p-5 mb-4">
        <div class="flex items-center justify-between mb-3"><h3 class="font-bold">IP pool</h3><button id="add-ip" class="btn btn-sm btn-primary"><i data-lucide="plus" class="w-4 h-4"></i> Add IP</button></div>
        <div class="overflow-x-auto"><table class="table"><thead><tr><th>IP</th><th>Label</th><th>Primary</th><th></th></tr></thead><tbody>
        ${d.ips.map((ip) => `<tr data-ip="${ip.id}"><td class="font-mono">${escapeHtml(ip.ip)}</td><td class="text-slate-400">${escapeHtml(ip.label || '—')}</td><td>${ip.primary ? '<span class="badge badge-info">primary</span>' : ''}</td><td class="text-right">${ip.primary ? '' : `<button data-del-ip class="btn btn-sm btn-ghost text-red-300"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`}</td></tr>`).join('')}
        </tbody></table></div></div>` : ''}

      <div class="glass glass-card p-5">
        <h3 class="font-bold mb-3">Allocations</h3>
        <div class="overflow-x-auto"><table class="table"><thead><tr><th>Server</th>${canAdmin ? '<th>Owner</th>' : ''}<th>IP</th><th>Port</th><th>Protocol</th><th>Status</th>${canAdmin ? '<th></th>' : ''}</tr></thead><tbody>
        ${d.allocations.length ? d.allocations.map((a) => `<tr>
          <td class="font-semibold">${escapeHtml(a.server)}</td>${canAdmin ? `<td class="text-slate-400">${escapeHtml(a.owner || '—')}</td>` : ''}
          <td class="font-mono">${a.ip}</td><td class="font-mono">${a.port}</td><td>${a.protocol}</td>
          <td><span class="badge badge-success">${a.status}</span></td>
          ${canAdmin ? `<td class="text-right"><button data-reassign='${escapeHtml(JSON.stringify({ serverId: a.serverId, port: a.port }))}' class="btn btn-sm btn-ghost"><i data-lucide="arrow-right-left" class="w-4 h-4"></i></button></td>` : ''}
        </tr>`).join('') : `<tr><td colspan="7" class="text-center text-slate-500 py-6">No allocations.</td></tr>`}
        </tbody></table></div>
      </div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    bind();
  }

  const stat = (l, v, i, c) => `<div class="glass glass-card p-5"><div class="flex items-start justify-between"><div><p class="text-xs text-slate-500 uppercase">${l}</p><p class="text-2xl font-extrabold mt-1">${v}</p></div><div class="w-10 h-10 rounded-xl grid place-items-center bg-${c}-500/15 text-${c}-300"><i data-lucide="${i}" class="w-5 h-5"></i></div></div></div>`;

  function bind() {
    document.getElementById('add-ip')?.addEventListener('click', () => {
      const m = modal({ title: 'Add IP address', body: `<form id="f" class="space-y-3"><div><label class="label">IP address</label><input name="ip" class="input" placeholder="203.0.113.10"></div><div><label class="label">Label</label><input name="label" class="input" placeholder="Public"></div></form>`, footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="s" class="btn btn-primary">Add</button>` });
      m.$('#s').addEventListener('click', async () => { try { await api.post('/network/ips', Object.fromEntries(new FormData(m.$('#f')))); m.close(); toastSuccess('IP added'); load(); } catch (e) { toastError(e.message); } });
    });
    document.querySelectorAll('[data-del-ip]').forEach((b) => b.addEventListener('click', async () => { const id = b.closest('[data-ip]').dataset.ip; if (!(await confirmDialog({ title: 'Remove IP?', message: 'Remove from pool.', confirmText: 'Remove', danger: true }))) return; try { await api.del(`/network/ips/${id}`); toastSuccess('Removed'); load(); } catch (e) { toastError(e.message); } }));
    document.querySelectorAll('[data-reassign]').forEach((b) => b.addEventListener('click', () => {
      const cur = JSON.parse(b.dataset.reassign);
      const m = modal({ title: 'Reassign port', body: `<p class="text-xs text-amber-300 mb-2">Reassigning recreates the container to apply the new binding.</p><label class="label">New port</label><input id="port" class="input" type="number" value="${cur.port}">`, footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="s" class="btn btn-primary">Reassign</button>` });
      m.$('#s').addEventListener('click', async () => { try { await api.post('/network/reassign', { serverId: cur.serverId, port: Number(m.$('#port').value) }); m.close(); toastSuccess('Reassigned'); load(); } catch (e) { toastError(e.message); } });
    }));
  }
});
