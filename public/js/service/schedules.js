/* Schedules tab — real cron automation for this service. */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  window.ServiceTabs.schedules = async function ({ content, server }) {
    const { escapeHtml, fmt, modal, confirmDialog, toastSuccess, toastError } = ui;
    const current = server.id;
    let actions = [];
    let schedules = [];

    content.innerHTML = `
      <div class="flex justify-end mb-4"><button id="new" class="btn btn-primary"><i data-lucide="plus" class="w-4 h-4"></i> New Schedule</button></div>
      <div class="glass glass-card p-0 overflow-hidden"><div class="overflow-x-auto"><table class="table"><thead><tr><th>Name</th><th>Cron</th><th>Action</th><th>Status</th><th>Last run</th><th>Next run</th><th class="text-right">Actions</th></tr></thead><tbody id="rows"></tbody></table></div></div>
      <p class="text-xs text-slate-500 mt-3">Cron format: <code>min hour day month weekday</code> — e.g. <code>0 4 * * *</code> = daily 04:00.</p>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    async function load() {
      const d = await api.get(`/schedules?serverId=${current}`);
      actions = d.actions; schedules = d.schedules;
      const rows = document.getElementById('rows');
      rows.innerHTML = d.schedules.length ? d.schedules.map((s) => `<tr data-id="${s.id}">
        <td class="font-semibold">${escapeHtml(s.name)}</td><td class="font-mono text-xs">${escapeHtml(s.cron)}</td>
        <td><span class="badge badge-info">${s.action}${s.action === 'command' ? ': ' + escapeHtml((s.payload || '').slice(0, 20)) : ''}</span></td>
        <td>${s.enabled ? '<span class="badge badge-success">enabled</span>' : '<span class="badge badge-muted">disabled</span>'}</td>
        <td class="text-slate-400">${s.lastRun ? fmt.relative(s.lastRun) : 'never'}</td>
        <td class="text-slate-400">${s.nextRun ? new Date(s.nextRun).toLocaleString() : '—'}</td>
        <td class="text-right whitespace-nowrap">
          <button data-act="history" class="btn btn-sm btn-ghost" title="History"><i data-lucide="history" class="w-4 h-4"></i></button>
          <button data-act="run" class="btn btn-sm btn-ghost" title="Run now"><i data-lucide="play" class="w-4 h-4"></i></button>
          <button data-act="toggle" class="btn btn-sm btn-ghost" title="Enable/disable"><i data-lucide="power" class="w-4 h-4"></i></button>
          <button data-act="delete" class="btn btn-sm btn-ghost text-red-300"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
        </td></tr>`).join('') : `<tr><td colspan="7" class="text-center text-slate-500 py-8">No schedules.</td></tr>`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      rows.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => onAction(b.closest('[data-id]').dataset.id, b.dataset.act)));
    }

    async function onAction(id, act) {
      try {
        if (act === 'history') {
          const s = schedules.find((x) => x.id === id);
          const hist = s?.history || [];
          modal({ title: `Execution history — ${escapeHtml(s?.name || '')}`, body: hist.length
            ? `<div class="space-y-1 max-h-[50vh] overflow-y-auto">${hist.map((h) => `<div class="flex items-center justify-between glass rounded-lg p-2 text-sm"><span class="badge ${h.status === 'success' ? 'badge-success' : 'badge-danger'}">${h.status}</span><span class="text-slate-400">${new Date(h.ts).toLocaleString()}</span></div>${h.error ? `<p class="text-xs text-red-300 px-2">${escapeHtml(h.error)}</p>` : ''}`).join('')}</div>`
            : '<p class="text-slate-500 text-sm">No executions yet.</p>',
            footer: `<button data-close class="btn btn-primary">Close</button>` });
          return;
        }
        if (act === 'run') { await api.post(`/schedules/${id}/run`); toastSuccess('Queued'); }
        else if (act === 'toggle') { await api.post(`/schedules/${id}/toggle`); toastSuccess('Updated'); }
        else if (act === 'delete') { if (!(await confirmDialog({ title: 'Delete schedule?', message: '', confirmText: 'Delete', danger: true }))) return; await api.del(`/schedules/${id}`); toastSuccess('Deleted'); }
        load();
      } catch (e) { toastError(e.message); }
    }

    document.getElementById('new').addEventListener('click', () => {
      const m = modal({ title: 'New schedule', body: `
        <form id="f" class="space-y-3">
          <div><label class="label">Name</label><input name="name" class="input" placeholder="Nightly restart" required></div>
          <div><label class="label">Cron expression</label><input name="cron" class="input font-mono" placeholder="0 4 * * *" required></div>
          <div><label class="label">Action</label><select name="action" id="act" class="select">${actions.map((a) => `<option>${a}</option>`).join('')}</select></div>
          <div id="cmd-wrap" class="hidden"><label class="label">Command</label><input name="payload" class="input font-mono" placeholder="say Restarting soon!"></div>
        </form>`,
        footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="s" class="btn btn-primary">Create</button>` });
      const actSel = m.$('#act');
      const toggleCmd = () => m.$('#cmd-wrap').classList.toggle('hidden', actSel.value !== 'command');
      actSel.addEventListener('change', toggleCmd); toggleCmd();
      m.$('#s').addEventListener('click', async () => {
        const body = Object.fromEntries(new FormData(m.$('#f'))); body.serverId = current;
        try { await api.post('/schedules', body); m.close(); toastSuccess('Schedule created'); load(); } catch (e) { toastError(e.message); }
      });
    });

    load();
  };
})();
