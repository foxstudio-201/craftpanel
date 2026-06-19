/* Databases — real MySQL/MariaDB/PostgreSQL containers. */
Layout.mount(async (content) => {
  const { escapeHtml, fmt, modal, confirmDialog, toastSuccess, toastError } = ui;
  const canAdmin = auth.can('admin');
  const { engines } = await api.get('/databases/engines');

  content.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
      <p class="text-slate-400 text-sm">Managed database instances. ${canAdmin ? '' : 'Contact an administrator to provision a new database.'}</p>
      ${canAdmin ? `<button id="new" class="btn btn-primary"><i data-lucide="plus" class="w-4 h-4"></i> New Database</button>` : ''}
    </div>
    <div id="grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger"></div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });
  document.getElementById('new')?.addEventListener('click', openCreate);

  async function load() {
    const { databases } = await api.get('/databases');
    const grid = document.getElementById('grid');
    grid.innerHTML = databases.length ? databases.map(card).join('') : `<div class="glass glass-card p-10 text-center text-slate-500 col-span-full">No databases yet.</div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    grid.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', onAction));
    grid.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => { const el = b.closest('[data-id]').querySelector('[data-conn]'); el.classList.toggle('blur-sm'); }));
  }

  function card(d) {
    const running = d.status === 'running';
    return `<div class="glass glass-card p-5" data-id="${d.id}">
      <div class="flex items-start justify-between">
        <div class="flex items-center gap-3"><div class="w-11 h-11 rounded-xl grid place-items-center bg-accent-500/15 text-accent-400"><i data-lucide="database" class="w-6 h-6"></i></div>
        <div><p class="font-bold leading-tight">${escapeHtml(d.name)}</p><p class="text-xs text-slate-500">${d.engine} · port ${d.port}</p></div></div>
        <span class="badge ${running ? 'badge-success' : 'badge-muted'}">${running ? '<span class="dot dot-live"></span> running' : d.status}</span>
      </div>
      <div class="mt-3">
        <div class="flex items-center justify-between text-xs text-slate-500 mb-1"><span>Connection string</span><button data-reveal class="hover:text-white"><i data-lucide="eye" class="w-3.5 h-3.5"></i></button></div>
        <code data-conn class="block text-[0.7rem] glass rounded-lg p-2 break-all blur-sm select-all">${escapeHtml(d.connection)}</code>
      </div>
      <div class="flex flex-wrap gap-2 mt-4">
        ${running ? `<button data-act="stop" class="btn btn-sm btn-ghost"><i data-lucide="square" class="w-4 h-4"></i></button><button data-act="restart" class="btn btn-sm btn-ghost"><i data-lucide="rotate-cw" class="w-4 h-4"></i></button>`
          : `<button data-act="start" class="btn btn-sm btn-primary"><i data-lucide="play" class="w-4 h-4"></i> Start</button>`}
        <button data-act="delete" class="btn btn-sm btn-ghost text-red-300"><i data-lucide="trash-2" class="w-4 h-4"></i></button>
      </div></div>`;
  }

  async function onAction(e) {
    const id = e.currentTarget.closest('[data-id]').dataset.id;
    const act = e.currentTarget.dataset.act;
    try {
      if (act === 'delete') { if (!(await confirmDialog({ title: 'Delete database?', message: 'Removes the container and ALL its data.', confirmText: 'Delete', danger: true }))) return; await api.del(`/databases/${id}`); }
      else await api.post(`/databases/${id}/power`, { action: act });
      toastSuccess('Done'); load();
    } catch (err) { toastError(err.message); }
  }

  async function openCreate() {
    const users = await api.get('/admin/users').then((d) => d.users).catch(() => []);
    const m = modal({ title: 'Provision database', body: `
      <form id="df" class="space-y-3">
        <div><label class="label">Engine</label><select name="engine" class="select">${engines.map((e) => `<option value="${e.key}">${e.label}</option>`).join('')}</select></div>
        <div><label class="label">Database name</label><input name="name" class="input" placeholder="app_db" required></div>
        <div><label class="label">Owner</label><select name="ownerId" class="select">${users.map((u) => `<option value="${u.id}">${escapeHtml(u.username)}</option>`).join('')}</select></div>
      </form>`,
      footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="c" class="btn btn-primary">Provision</button>` });
    m.$('#c').addEventListener('click', async () => {
      const body = Object.fromEntries(new FormData(m.$('#df')));
      const btn = m.$('#c'); btn.disabled = true; btn.textContent = 'Provisioning…';
      try { await api.post('/databases', body); m.close(); toastSuccess('Database provisioned'); load(); }
      catch (e) { toastError(e.message); btn.disabled = false; btn.textContent = 'Provision'; }
    });
  }

  load();
});
