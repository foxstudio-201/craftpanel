/* Database page — MySQL connection status, database list & statistics. */
Layout.mount(async (content) => {
  const { escapeHtml, fmt, modal, confirmDialog, toastSuccess, toastError } = ui;
  const canAdmin = auth.can('admin');

  content.innerHTML = `
    <div id="conn" class="glass glass-card p-5 mb-4"></div>
    <section class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4 stagger" id="stats"></section>
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div class="glass glass-card p-5 xl:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold">Databases</h3>
          <button id="new-db" class="btn btn-sm btn-primary ${canAdmin ? '' : 'hidden'}"><i data-lucide="plus" class="w-4 h-4"></i> New</button>
        </div>
        <div class="overflow-x-auto"><table class="table"><thead><tr><th>Name</th><th>Host</th><th>Size</th><th>Tables</th><th>Conns</th><th>Status</th><th></th></tr></thead><tbody id="rows"></tbody></table></div>
      </div>
      <div class="glass glass-card p-5">
        <h3 class="font-bold mb-4">Storage by database</h3>
        <div class="h-64"><canvas id="dbChart"></canvas></div>
      </div>
    </div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  let chart;

  async function load() {
    const [{ databases, stats }, conn] = await Promise.all([api.get('/databases'), api.get('/databases/test')]);

    document.getElementById('conn').innerHTML = `
      <div class="flex items-center gap-4 flex-wrap">
        <div class="w-12 h-12 rounded-xl grid place-items-center ${conn.configured ? 'bg-brand-500/20 text-brand-300' : 'bg-amber-500/20 text-amber-300'}"><i data-lucide="database" class="w-6 h-6"></i></div>
        <div class="flex-1 min-w-[12rem]">
          <p class="font-bold">MySQL Connection ${conn.configured ? '<span class="badge badge-success">Configured</span>' : '<span class="badge badge-warn">Mock mode</span>'}</p>
          <p class="text-sm text-slate-400">${escapeHtml(conn.message)}</p>
        </div>
        <code class="text-xs glass px-3 py-2 rounded-lg">${escapeHtml(conn.host)}:${conn.port} / ${escapeHtml(conn.database)}</code>
      </div>`;

    document.getElementById('stats').innerHTML = [
      ['Databases', stats.total, 'database', 'brand'],
      ['Total size', fmt.bytes(stats.totalSizeMb * 1024 * 1024), 'hard-drive', 'accent'],
      ['Tables', stats.totalTables, 'table', 'info'],
      ['Connections', stats.totalConnections, 'plug', 'warn'],
    ].map(([label, val, icon, color]) => `
      <div class="glass glass-card p-5">
        <div class="flex items-start justify-between">
          <div><p class="text-xs text-slate-500 uppercase">${label}</p><p class="text-2xl font-extrabold mt-1">${val}</p></div>
          <div class="w-10 h-10 rounded-xl grid place-items-center bg-${color}-500/15 text-${color}-300"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
        </div></div>`).join('');

    document.getElementById('rows').innerHTML = databases.map((d) => `
      <tr data-id="${d.id}">
        <td class="font-semibold">${escapeHtml(d.name)}</td>
        <td class="text-slate-400">${escapeHtml(d.host)}</td>
        <td>${fmt.bytes(d.sizeMb * 1024 * 1024)}</td>
        <td>${d.tables}</td>
        <td>${d.connections}</td>
        <td><span class="badge badge-success">${d.status}</span></td>
        <td class="text-right">${canAdmin ? `<button data-del class="btn btn-sm btn-ghost text-red-300"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}</td>
      </tr>`).join('');
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    document.querySelectorAll('#rows [data-del]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('[data-id]').dataset.id;
      if (!(await confirmDialog({ title: 'Delete database?', message: 'This cannot be undone.', confirmText: 'Delete', danger: true }))) return;
      try { await api.del(`/databases/${id}`); toastSuccess('Deleted'); load(); } catch (e) { toastError(e.message); }
    }));

    chart?.destroy();
    chart = charts.bar(document.getElementById('dbChart'), {
      labels: databases.map((d) => d.name),
      data: databases.map((d) => d.sizeMb),
      color: charts.PALETTE.accent,
    });
  }

  document.getElementById('new-db')?.addEventListener('click', () => {
    const m = modal({ title: 'Create database',
      body: `<form id="df" class="space-y-3"><div><label class="label">Name</label><input name="name" class="input" placeholder="my_database" required></div><div><label class="label">Host</label><input name="host" class="input" value="localhost"></div></form>`,
      footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="df-save" class="btn btn-primary">Create</button>` });
    m.$('#df-save').addEventListener('click', async () => {
      const body = Object.fromEntries(new FormData(m.$('#df')));
      try { await api.post('/databases', body); m.close(); toastSuccess('Database created'); load(); } catch (e) { toastError(e.message); }
    });
  });

  load();
});
