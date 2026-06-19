/* Servers page — real Docker-backed lifecycle + the version installer. */
Layout.mount(async (content) => {
  const { escapeHtml, fmt, confirmDialog, modal, toastSuccess, toastError } = ui;
  const canAdmin = auth.can('admin');

  const [{ software }, _] = await Promise.all([api.get('/servers/meta/software'), Promise.resolve()]);

  content.innerHTML = `
    <div class="flex items-center justify-between flex-wrap gap-3 mb-5">
      <p class="text-slate-400 text-sm">${canAdmin ? 'Deploy and manage real Docker-backed servers.' : 'Your servers. Contact an administrator to provision a new one.'}</p>
      ${canAdmin ? `<button id="new-server" class="btn btn-primary"><i data-lucide="plus" class="w-4 h-4"></i> Deploy Server</button>` : ''}
    </div>
    <div id="grid" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger"></div>`;
  document.getElementById('new-server')?.addEventListener('click', openCreate);
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  // NOTE: stateBadge must be initialised before load() runs — load() → card()
  // references it. Declaring it after `await load()` put it in the temporal
  // dead zone ("Cannot access 'stateBadge' before initialization").
  const stateBadge = (s) => {
    if (s.suspended) return '<span class="badge badge-danger">suspended</span>';
    if (s.installStatus === 'installing') return '<span class="badge badge-warn"><span class="dot dot-live"></span> installing</span>';
    if (s.installStatus === 'failed') return '<span class="badge badge-danger">install failed</span>';
    if (s.state === 'running') return '<span class="badge badge-success"><span class="dot dot-live"></span> running</span>';
    return '<span class="badge badge-muted">stopped</span>';
  };

  await load();
  realtime.on('server:status', load);

  async function load() {
    const { servers } = await api.get('/servers');
    const grid = document.getElementById('grid');
    if (!servers.length) {
      grid.innerHTML = `<div class="glass glass-card p-10 text-center text-slate-500 col-span-full">No servers yet — deploy your first one.</div>`;
      return;
    }
    grid.innerHTML = servers.map(card).join('');
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    grid.querySelectorAll('[data-action]').forEach((b) => b.addEventListener('click', onAction));
  }

  function card(s) {
    const running = s.state === 'running';
    return `
      <div class="glass glass-card p-5" data-id="${s.id}">
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-3">
            <div class="w-12 h-12 rounded-xl grid place-items-center ${running ? 'bg-brand-500/20 text-brand-300 ring-brand' : 'bg-slate-500/15 text-slate-400'}"><i data-lucide="box" class="w-6 h-6"></i></div>
            <div>
              <p class="font-bold leading-tight">${escapeHtml(s.name)}</p>
              <p class="text-xs text-slate-500">${escapeHtml(s.softwareLabel)} · ${escapeHtml(s.version)}</p>
            </div>
          </div>
          ${stateBadge(s)}
        </div>
        <div class="grid grid-cols-4 gap-2 mt-4 text-center text-xs">
          <div class="bg-white/5 rounded-lg py-2"><p class="text-slate-500">CPU</p><p class="font-bold">${s.limits.cpu}c</p></div>
          <div class="bg-white/5 rounded-lg py-2"><p class="text-slate-500">RAM</p><p class="font-bold">${(s.limits.ramMb/1024).toFixed(1)}G</p></div>
          <div class="bg-white/5 rounded-lg py-2"><p class="text-slate-500">Port</p><p class="font-bold">${s.allocation.port}</p></div>
          <div class="bg-white/5 rounded-lg py-2"><p class="text-slate-500">Owner</p><p class="font-bold truncate">${escapeHtml(s.owner)}</p></div>
        </div>
        <div class="flex flex-wrap gap-2 mt-4">
          ${running
            ? `<button data-action="stop" class="btn btn-sm btn-ghost"><i data-lucide="square" class="w-4 h-4"></i></button>
               <button data-action="restart" class="btn btn-sm btn-ghost"><i data-lucide="rotate-cw" class="w-4 h-4"></i></button>
               <button data-action="kill" class="btn btn-sm btn-danger"><i data-lucide="zap" class="w-4 h-4"></i></button>`
            : `<button data-action="start" class="btn btn-sm btn-primary" ${s.suspended ? 'disabled' : ''}><i data-lucide="play" class="w-4 h-4"></i> Start</button>`}
          <a href="/console?server=${s.id}" class="btn btn-sm btn-ghost"><i data-lucide="terminal" class="w-4 h-4"></i></a>
          <a href="/files?server=${s.id}" class="btn btn-sm btn-ghost"><i data-lucide="folder" class="w-4 h-4"></i></a>
          <button data-action="backups" class="btn btn-sm btn-ghost"><i data-lucide="archive" class="w-4 h-4"></i></button>
          <button data-action="more" class="btn btn-sm btn-ghost"><i data-lucide="more-horizontal" class="w-4 h-4"></i></button>
        </div>
      </div>`;
  }

  async function onAction(e) {
    const btn = e.currentTarget;
    const id = btn.closest('[data-id]').dataset.id;
    const action = btn.dataset.action;
    try {
      if (['start', 'stop', 'restart', 'kill'].includes(action)) {
        if (action === 'kill' && !(await confirmDialog({ title: 'Kill container?', message: 'Force-kills the process (SIGKILL).', confirmText: 'Kill', danger: true }))) return;
        await api.post(`/servers/${id}/power`, { action });
        toastSuccess(`${action} issued`); load();
      } else if (action === 'backups') openBackups(id);
      else if (action === 'more') openMore(id);
    } catch (err) { toastError(err.message); }
  }

  function openMore(id) {
    const m = modal({ title: 'Server actions', body: `
      <div class="space-y-2">
        <button data-a="reinstall" class="btn btn-ghost w-full justify-start"><i data-lucide="refresh-cw" class="w-4 h-4"></i> Reinstall (recreate container, keep world)</button>
        <button data-a="clone" class="btn btn-ghost w-full justify-start"><i data-lucide="copy" class="w-4 h-4"></i> Clone server</button>
        ${canAdmin ? `<button data-a="suspend" class="btn btn-ghost w-full justify-start text-amber-300"><i data-lucide="pause-circle" class="w-4 h-4"></i> Suspend / Unsuspend</button>` : ''}
        <button data-a="delete" class="btn btn-ghost w-full justify-start text-red-300"><i data-lucide="trash-2" class="w-4 h-4"></i> Delete server</button>
      </div>` });
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    m.root.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', async () => {
      const a = b.dataset.a; m.close();
      try {
        if (a === 'reinstall') { await api.post(`/servers/${id}/reinstall`); toastSuccess('Reinstalled'); }
        else if (a === 'clone') { await api.post(`/servers/${id}/clone`); toastSuccess('Cloned'); }
        else if (a === 'suspend') {
          const { servers } = await api.get('/servers'); const s = servers.find((x) => x.id === id);
          await api.post(`/servers/${id}/suspend`, { suspended: !s.suspended }); toastSuccess('Updated');
        } else if (a === 'delete') {
          if (!(await confirmDialog({ title: 'Delete server?', message: 'Removes the container AND its data volume permanently.', confirmText: 'Delete', danger: true }))) return;
          await api.del(`/servers/${id}`); toastSuccess('Deleted');
        }
        load();
      } catch (e) { toastError(e.message); }
    }));
  }

  async function openCreate() {
    const users = canAdmin ? await api.get('/admin/users').then((d) => d.users).catch(() => []) : [];
    const m = modal({
      title: 'Deploy a new server', size: 'max-w-xl',
      body: `
        <form id="cf" class="space-y-3">
          <div><label class="label">Server name</label><input name="name" class="input" placeholder="My Survival Server" required></div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label">Software</label><select name="software" class="select">${software.map((s) => `<option value="${s.key}">${s.label}</option>`).join('')}</select></div>
            <div><label class="label">Version</label><select name="version" id="ver" class="select"><option>LATEST</option></select></div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div><label class="label">CPU cores</label><input name="cpu" type="number" step="0.5" class="input" value="2"></div>
            <div><label class="label">RAM (MB)</label><input name="ramMb" type="number" class="input" value="2048"></div>
            <div><label class="label">Disk (MB)</label><input name="diskMb" type="number" class="input" value="10240"></div>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label">Max players</label><input name="maxPlayers" type="number" class="input" value="20"></div>
            ${canAdmin ? `<div><label class="label">Owner</label><select name="ownerId" class="select">${users.map((u) => `<option value="${u.id}">${escapeHtml(u.username)}</option>`).join('')}</select></div>` : ''}
          </div>
          <p class="text-xs text-slate-500">The server jar is downloaded from the official source on first start.</p>
        </form>`,
      footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="cf-save" class="btn btn-primary"><i data-lucide="rocket" class="w-4 h-4"></i> Deploy</button>`,
    });
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    const swSel = m.$('[name=software]');
    const verSel = m.$('#ver');
    async function loadVersions() {
      verSel.innerHTML = '<option>loading…</option>';
      try { const { versions } = await api.get(`/servers/meta/versions/${swSel.value}`); verSel.innerHTML = versions.map((v) => `<option>${v}</option>`).join(''); }
      catch { verSel.innerHTML = '<option>LATEST</option>'; }
    }
    swSel.addEventListener('change', loadVersions);
    loadVersions();

    m.$('#cf-save').addEventListener('click', async () => {
      const body = Object.fromEntries(new FormData(m.$('#cf')));
      if (!body.name) return toastError('Name is required');
      const btn = m.$('#cf-save'); btn.disabled = true; btn.innerHTML = 'Deploying…';
      try { await api.post('/servers', body); m.close(); toastSuccess('Server deployed & installed'); load(); }
      catch (e) { toastError(e.message); btn.disabled = false; btn.innerHTML = 'Deploy'; }
    });
  }

  async function openBackups(id) {
    const m = modal({ title: 'Backups', size: 'max-w-2xl', body: `<div id="bk">Loading…</div>`,
      footer: `<button data-close class="btn btn-ghost">Close</button><button id="bk-new" class="btn btn-primary"><i data-lucide="archive" class="w-4 h-4"></i> Create backup</button>` });
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    async function refresh() {
      const { backups } = await api.get(`/servers/${id}/backups`);
      m.$('#bk').innerHTML = backups.length ? `<table class="table"><thead><tr><th>Name</th><th>Size</th><th>Created</th><th></th></tr></thead><tbody>
        ${backups.map((b) => `<tr><td class="font-mono text-xs">${escapeHtml(b.name)}</td><td>${fmt.bytes(b.sizeBytes||b.sizeGb*1e9)}</td><td class="text-slate-400">${fmt.relative(b.createdAt)}</td>
        <td class="text-right whitespace-nowrap"><button data-restore="${b.id}" class="btn btn-sm btn-ghost"><i data-lucide="rotate-ccw" class="w-4 h-4"></i></button>
        <button data-del="${b.id}" class="btn btn-sm btn-ghost text-red-300"><i data-lucide="trash-2" class="w-4 h-4"></i></button></td></tr>`).join('')}</tbody></table>`
        : `<p class="text-slate-500 text-sm text-center py-6">No backups yet.</p>`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      m.root.querySelectorAll('[data-restore]').forEach((b) => b.addEventListener('click', async () => { try { await api.post(`/servers/${id}/backups/${b.dataset.restore}/restore`); toastSuccess('Restored'); } catch (e) { toastError(e.message); } }));
      m.root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { try { await api.del(`/servers/${id}/backups/${b.dataset.del}`); toastSuccess('Deleted'); refresh(); } catch (e) { toastError(e.message); } }));
    }
    m.$('#bk-new').addEventListener('click', async () => { const btn = m.$('#bk-new'); btn.disabled = true; btn.textContent = 'Backing up…'; try { await api.post(`/servers/${id}/backups`); toastSuccess('Backup created'); refresh(); } catch (e) { toastError(e.message); } btn.disabled = false; btn.innerHTML = 'Create backup'; });
    refresh();
  }
});
