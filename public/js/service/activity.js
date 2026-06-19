/* Activity tab — audit log scoped to this service. */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  window.ServiceTabs.activity = async function ({ content, server }) {
    const { escapeHtml, fmt } = ui;
    const id = server.id;

    content.innerHTML = `
      <div class="glass glass-card p-4 mb-4 flex flex-wrap items-center gap-3">
        <div class="relative flex-1 min-w-[12rem]"><i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"></i><input id="q" class="input pl-9 py-2" placeholder="Search actions, actors…"></div>
      </div>
      <div class="glass glass-card p-0 overflow-hidden"><div class="overflow-x-auto"><table class="table"><thead><tr><th>Action</th><th>Actor</th><th>IP</th><th>When</th></tr></thead><tbody id="rows"></tbody></table></div></div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    const all = ((await api.get('/dashboard/activity?limit=300')).logs || []).filter((a) => a.serverId === id);

    function render() {
      const q = document.getElementById('q').value.toLowerCase();
      const rows = all.filter((a) => !q || a.action.toLowerCase().includes(q) || (a.actor || '').toLowerCase().includes(q));
      document.getElementById('rows').innerHTML = rows.length ? rows.map((a) => `<tr>
        <td><span class="badge badge-muted">${escapeHtml(a.action)}</span></td>
        <td>${escapeHtml(a.actor)}</td><td class="text-slate-500">${a.ip || '—'}</td>
        <td class="text-slate-500" title="${a.createdAt}">${fmt.relative(a.createdAt)}</td></tr>`).join('')
        : `<tr><td colspan="4" class="text-center text-slate-500 py-8">No activity for this service yet.</td></tr>`;
    }
    render();
    document.getElementById('q').addEventListener('input', render);
  };
})();
