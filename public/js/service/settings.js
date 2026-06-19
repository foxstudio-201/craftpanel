/* Settings tab — per-service identity, SFTP, lifecycle (reinstall/clone/
   suspend/delete) and admin owner transfer. */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  window.ServiceTabs.settings = async function ({ content, server }) {
    const { escapeHtml, confirmDialog, toastSuccess, toastError } = ui;
    const canAdmin = auth.can('admin');
    const id = server.id;

    const s = (await api.get(`/servers/${id}`)).server;
    const users = canAdmin ? await api.get('/admin/users').then((d) => d.users).catch(() => []) : [];
    let sftp = null; try { sftp = await api.get(`/servers/${id}/sftp`); } catch { /* ignore */ }

    content.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="glass glass-card p-5">
          <h3 class="font-bold mb-4">Service identity</h3>
          <form id="idf" class="space-y-3">
            <div><label class="label">Name</label><input name="name" class="input" value="${escapeHtml(s.name)}" required></div>
            <div><label class="label">Description</label><input name="description" class="input" value="${escapeHtml(s.description || '')}" placeholder="Optional"></div>
            ${canAdmin ? `<div><label class="label">Owner</label><select name="ownerId" class="select">${users.map((u) => `<option value="${u.id}" ${u.id === s.ownerId ? 'selected' : ''}>${escapeHtml(u.username)}</option>`).join('')}</select></div>` : ''}
            <button class="btn btn-primary"><i data-lucide="save" class="w-4 h-4"></i> Save</button>
          </form>
        </div>

        <div class="glass glass-card p-5">
          <h3 class="font-bold mb-3">SFTP access</h3>
          ${sftp && sftp.enabled ? `<div class="text-sm space-y-2">
            ${kv('Host', escapeHtml(sftp.host))}${kv('Port', sftp.port)}${kv('Username', `<span class="font-mono text-xs">${escapeHtml(sftp.username)}</span>`)}
            <p class="text-xs text-slate-500 mt-2">${escapeHtml(sftp.note || '')}</p></div>` : '<p class="text-sm text-slate-500">SFTP is disabled.</p>'}
        </div>

        <div class="glass glass-card p-5 lg:col-span-2">
          <h3 class="font-bold mb-3">Lifecycle</h3>
          <div class="flex flex-wrap gap-2">
            <button data-a="reinstall" class="btn btn-ghost"><i data-lucide="refresh-cw" class="w-4 h-4"></i> Reinstall (recreate container, keep data)</button>
            <button data-a="clone" class="btn btn-ghost"><i data-lucide="copy" class="w-4 h-4"></i> Clone</button>
            ${canAdmin ? `<button data-a="suspend" class="btn btn-warn"><i data-lucide="pause-circle" class="w-4 h-4"></i> ${s.suspended ? 'Unsuspend' : 'Suspend'}</button>` : ''}
            <button data-a="delete" class="btn btn-danger"><i data-lucide="trash-2" class="w-4 h-4"></i> Delete service</button>
          </div>
        </div>
      </div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    document.getElementById('idf').addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      try { await api.put(`/servers/${id}`, body); toastSuccess('Saved'); }
      catch (err) { toastError(err.message); }
    });

    content.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a;
      try {
        if (a === 'reinstall') { if (!(await confirmDialog({ title: 'Reinstall?', message: 'Recreates the container (data kept).', confirmText: 'Reinstall' }))) return; await api.post(`/servers/${id}/reinstall`); toastSuccess('Reinstalled'); }
        else if (a === 'clone') { const r = await api.post(`/servers/${id}/clone`); toastSuccess('Cloned'); if (r.server?.id) location.href = `/service/${r.server.id}/overview`; }
        else if (a === 'suspend') { await api.post(`/servers/${id}/suspend`, { suspended: !s.suspended }); toastSuccess('Updated'); location.reload(); }
        else if (a === 'delete') { if (!(await confirmDialog({ title: 'Delete service?', message: 'Removes the container AND its data volume permanently.', confirmText: 'Delete', danger: true }))) return; await api.del(`/servers/${id}`); toastSuccess('Deleted'); location.href = '/services'; }
      } catch (err) { toastError(err.message); }
    }));

    function kv(k, v) { return `<div class="flex justify-between gap-2"><span class="text-slate-500">${k}</span><span class="font-medium text-right break-all">${v}</span></div>`; }
  };
})();
