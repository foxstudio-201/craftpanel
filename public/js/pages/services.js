/* My Services — list of every service instance the user owns (staff see all),
   across all types. Each card links into its per-service shell. */
Layout.mount(async (content, user) => {
  const { escapeHtml, confirmDialog, toastSuccess, toastError } = ui;
  const canAdmin = auth.can('admin');
  await ServiceRegistry.load();

  content.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-3 mb-5">
      <p class="text-slate-400 text-sm">${canAdmin ? 'Manage every deployed service.' : 'Your deployed services.'}</p>
      <a href="/marketplace" class="btn btn-primary"><i data-lucide="rocket" class="w-4 h-4"></i> Deploy a service</a>
    </div>
    <div id="grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger"></div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  const stateBadge = (s) => {
    if (s.suspended) return '<span class="badge badge-danger">suspended</span>';
    if (s.installStatus === 'installing') return '<span class="badge badge-warn"><span class="dot dot-live"></span> installing</span>';
    if (s.installStatus === 'failed') return '<span class="badge badge-danger">install failed</span>';
    if (s.state === 'running') return '<span class="badge badge-success"><span class="dot dot-live"></span> running</span>';
    return '<span class="badge badge-muted">stopped</span>';
  };

  async function load() {
    const { servers } = await api.get('/servers');
    const grid = document.getElementById('grid');
    if (!servers.length) {
      grid.innerHTML = `<div class="glass glass-card p-10 text-center text-slate-500 col-span-full">No services yet — <a href="/marketplace" class="text-brand-400 hover:underline">deploy your first one</a>.</div>`;
      return;
    }
    grid.innerHTML = servers.map(card).join('');
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    grid.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', onAction));
  }

  function card(s) {
    const type = ServiceRegistry.typeOf(s);
    const running = s.state === 'running';
    const icon = ServiceRegistry.iconFor(type);
    const needsPort = type !== 'static';
    return `
      <div class="glass glass-card p-5" data-id="${s.id}">
        <div class="flex items-start justify-between">
          <a href="/service/${s.id}/overview" class="flex items-center gap-3 group">
            <div class="w-12 h-12 rounded-xl grid place-items-center ${running ? 'bg-brand-500/20 text-brand-300 ring-brand' : 'bg-slate-500/15 text-slate-400'}"><i data-lucide="${icon}" class="w-6 h-6"></i></div>
            <div>
              <p class="font-bold leading-tight group-hover:text-brand-300">${escapeHtml(s.name)}</p>
              <p class="text-xs text-slate-500">${escapeHtml(ServiceRegistry.labelFor(type))}${s.softwareLabel ? ' · ' + escapeHtml(s.softwareLabel) : ''}</p>
            </div>
          </a>
          ${stateBadge(s)}
        </div>
        <div class="grid grid-cols-4 gap-2 mt-4 text-center text-xs">
          <div class="bg-white/5 rounded-lg py-2"><p class="text-slate-500">CPU</p><p class="font-bold">${s.limits.cpu}c</p></div>
          <div class="bg-white/5 rounded-lg py-2"><p class="text-slate-500">RAM</p><p class="font-bold">${(s.limits.ramMb/1024).toFixed(1)}G</p></div>
          <div class="bg-white/5 rounded-lg py-2"><p class="text-slate-500">${needsPort ? 'Port' : 'Disk'}</p><p class="font-bold">${needsPort ? s.allocation.port : (s.limits.diskMb/1024).toFixed(0) + 'G'}</p></div>
          <div class="bg-white/5 rounded-lg py-2"><p class="text-slate-500">Owner</p><p class="font-bold truncate">${escapeHtml(s.owner)}</p></div>
        </div>
        <div class="flex flex-wrap gap-2 mt-4">
          ${running
            ? `<button data-action="stop" class="btn btn-sm btn-ghost"><i data-lucide="square" class="w-4 h-4"></i></button>
               <button data-action="restart" class="btn btn-sm btn-ghost"><i data-lucide="rotate-cw" class="w-4 h-4"></i></button>`
            : `<button data-action="start" class="btn btn-sm btn-primary" ${s.suspended ? 'disabled' : ''}><i data-lucide="play" class="w-4 h-4"></i> Start</button>`}
          <a href="/service/${s.id}/overview" class="btn btn-sm btn-ghost ml-auto"><i data-lucide="settings" class="w-4 h-4"></i> Manage</a>
        </div>
      </div>`;
  }

  async function onAction(e) {
    const btn = e.currentTarget;
    const id = btn.closest('[data-id]').dataset.id;
    const action = btn.dataset.action;
    try { await api.post(`/servers/${id}/power`, { action }); toastSuccess(`${action} issued`); load(); }
    catch (err) { toastError(err.message); }
  }

  await load();
  realtime.on('server:status', load);
});
