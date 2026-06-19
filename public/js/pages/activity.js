/* Activity — audit log (own actions + actions on your servers; staff see all). */
Layout.mount(async (content) => {
  const { escapeHtml, fmt } = ui;
  let all = [];

  content.innerHTML = `
    <div class="glass glass-card p-4 mb-4 flex flex-wrap items-center gap-3">
      <div class="relative flex-1 min-w-[12rem]"><i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"></i><input id="q" class="input pl-9 py-2" placeholder="Search actions, targets…"></div>
      <select id="cat" class="select w-auto"><option value="">All categories</option><option value="server">Server</option><option value="user">User</option><option value="auth">Auth</option><option value="schedule">Schedule</option><option value="apikey">API</option><option value="file">Files</option><option value="database">Database</option></select>
    </div>
    <div class="glass glass-card p-0 overflow-hidden"><div class="overflow-x-auto"><table class="table"><thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>IP</th><th>When</th></tr></thead><tbody id="rows"></tbody></table></div></div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  function render() {
    const q = document.getElementById('q').value.toLowerCase();
    const cat = document.getElementById('cat').value;
    const rows = all.filter((a) =>
      (!cat || a.action.startsWith(cat)) &&
      (!q || a.action.toLowerCase().includes(q) || (a.target || '').toLowerCase().includes(q) || (a.actor || '').toLowerCase().includes(q)));
    document.getElementById('rows').innerHTML = rows.length ? rows.map((a) => `<tr>
      <td><span class="badge badge-muted">${escapeHtml(a.action)}</span></td>
      <td>${escapeHtml(a.actor)}</td><td class="text-slate-400">${escapeHtml(a.target || '—')}</td>
      <td class="text-slate-500">${a.ip || '—'}</td><td class="text-slate-500" title="${a.createdAt}">${fmt.relative(a.createdAt)}</td></tr>`).join('')
      : `<tr><td colspan="5" class="text-center text-slate-500 py-8">No activity.</td></tr>`;
  }

  all = (await api.get('/dashboard/activity?limit=300')).logs;
  render();
  document.getElementById('q').addEventListener('input', render);
  document.getElementById('cat').addEventListener('change', render);
});
