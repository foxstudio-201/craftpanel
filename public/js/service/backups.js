/* Backups tab — real tar.gz backup manager for this service. */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  window.ServiceTabs.backups = async function ({ content, server }) {
    const { escapeHtml, fmt, confirmDialog, toastSuccess, toastError } = ui;
    const current = server.id;

    content.innerHTML = `
      <div class="flex justify-end mb-4"><button id="new" class="btn btn-primary"><i data-lucide="archive" class="w-4 h-4"></i> Create Backup</button></div>
      <div class="glass glass-card p-0 overflow-hidden"><div class="overflow-x-auto"><table class="table"><thead><tr><th>Name</th><th>Type</th><th>Size</th><th>Created</th><th class="text-right">Actions</th></tr></thead><tbody id="rows"></tbody></table></div></div>
      <p class="text-xs text-slate-500 mt-3">Automatic & scheduled backups: create a <a href="/service/${current}/schedules" class="text-brand-400 hover:underline">schedule</a> with the “backup” action.</p>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    async function load() {
      const { backups } = await api.get(`/servers/${current}/backups`);
      const rows = document.getElementById('rows');
      rows.innerHTML = backups.length ? backups.map((b) => `<tr data-id="${b.id}">
        <td class="font-mono text-xs">${escapeHtml(b.name)}</td>
        <td><span class="badge ${b.type === 'manual' ? 'badge-info' : b.type === 'scheduled' ? 'badge-warn' : 'badge-muted'}">${b.type}</span></td>
        <td>${fmt.bytes(b.sizeBytes || (b.sizeGb || 0) * 1e9)}</td>
        <td class="text-slate-400">${fmt.relative(b.createdAt)}</td>
        <td class="text-right whitespace-nowrap">
          <a href="/api/servers/${current}/backups/${b.id}/download" class="btn btn-sm btn-ghost" title="Download"><i data-lucide="download" class="w-4 h-4"></i></a>
          <button data-act="restore" class="btn btn-sm btn-ghost" title="Restore"><i data-lucide="rotate-ccw" class="w-4 h-4"></i></button>
          <button data-act="delete" class="btn btn-sm btn-ghost text-red-300" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </td></tr>`).join('') : `<tr><td colspan="5" class="text-center text-slate-500 py-8">No backups yet.</td></tr>`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      rows.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => onAction(b.closest('[data-id]').dataset.id, b.dataset.act)));
    }

    async function onAction(id, act) {
      try {
        if (act === 'restore') { if (!(await confirmDialog({ title: 'Restore backup?', message: 'Overwrites current data and restarts if running.', confirmText: 'Restore', danger: true }))) return; await api.post(`/servers/${current}/backups/${id}/restore`); toastSuccess('Restored'); }
        else if (act === 'delete') { if (!(await confirmDialog({ title: 'Delete backup?', message: '', confirmText: 'Delete', danger: true }))) return; await api.del(`/servers/${current}/backups/${id}`); toastSuccess('Deleted'); load(); }
      } catch (e) { toastError(e.message); }
    }

    document.getElementById('new').addEventListener('click', async (e) => {
      const btn = e.currentTarget; btn.disabled = true; btn.innerHTML = '<i data-lucide="loader" class="w-4 h-4 spin"></i> Backing up…'; window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      try { await api.post(`/servers/${current}/backups`); toastSuccess('Backup created'); load(); } catch (e) { toastError(e.message); }
      btn.disabled = false; btn.innerHTML = '<i data-lucide="archive" class="w-4 h-4"></i> Create Backup'; window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    });

    load();
  };
})();
