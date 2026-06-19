/* Overview tab — per-service status, power controls and isolated resources
   (CPU · RAM · Disk · Network · IP · Ports · Uptime · Status). Live via the
   metrics:server + server:status sockets. Type-specific summary block. */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  window.ServiceTabs.overview = async function ({ content, server, type }) {
    const { escapeHtml, fmt, confirmDialog, toastSuccess, toastError } = ui;
    const reg = window.ServiceRegistry;
    const id = server.id;

    // Shared status presentation — identical to the Console badge (req #7).
    const stateBadge = (s) => ui.serverStatusBadge(s);

    content.innerHTML = `
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div class="glass glass-card p-5 xl:col-span-2">
          <div class="flex items-start justify-between flex-wrap gap-3">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-xl grid place-items-center bg-gradient-to-br from-brand-500 to-accent-500 shadow-glow"><i data-lucide="${reg.iconFor(type)}" class="w-6 h-6 text-white"></i></div>
              <div>
                <p class="font-bold text-lg leading-tight">${escapeHtml(server.name)}</p>
                <p class="text-sm text-slate-400">${escapeHtml(reg.labelFor(type))} · ${escapeHtml(server.softwareLabel || server.template || '')}</p>
              </div>
            </div>
            <div id="ov-state">${stateBadge(server.state)}</div>
          </div>
          <div id="power" class="flex flex-wrap gap-2 mt-5"></div>
        </div>

        <div class="glass glass-card p-5">
          <h3 class="font-bold mb-3 flex items-center gap-2"><i data-lucide="info" class="w-4 h-4"></i> Connection</h3>
          <div id="conn" class="space-y-2 text-sm"></div>
        </div>
      </div>

      <section class="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4 stagger">
        ${meter('CPU', 'cpu', 'cpu', 'brand')}
        ${meter('Memory', 'memory-stick', 'ram', 'accent')}
        ${meter('Disk', 'hard-drive', 'disk', 'info')}
        ${meter('Network', 'arrow-down-up', 'net', 'warn')}
      </section>

      <div id="type-summary" class="mt-4"></div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    function meter(label, icon, key, color) {
      return `<div class="glass glass-card p-5">
        <div class="flex items-center justify-between"><p class="text-xs text-slate-500 uppercase tracking-wide">${label}</p><i data-lucide="${icon}" class="w-4 h-4 text-${color}-300"></i></div>
        <p class="text-2xl font-extrabold mt-1" data-m="${key}">—</p>
        <p class="text-xs text-slate-500" data-msub="${key}">&nbsp;</p>
      </div>`;
    }

    function renderConn(s) {
      const row = (k, v) => `<div class="flex justify-between gap-2"><span class="text-slate-500">${k}</span><span class="font-medium text-right break-all">${v}</span></div>`;
      const needsPort = reg.featureValue(type, 'console') !== false || type !== 'static';
      document.getElementById('conn').innerHTML = [
        row('Status', `<span id="conn-state">${stateBadge(s.state)}</span>`),
        row('UUID', `<span class="font-mono text-xs">${escapeHtml(s.uuid)}</span>`),
        row('Owner', escapeHtml(s.owner)),
        row('Node', escapeHtml(s.node || 'local')),
        row('IP', `<span class="font-mono">${escapeHtml(s.allocation?.ip || '—')}</span>`),
        row('Port', `<span class="font-mono">${s.allocation?.port ?? '—'}</span>`),
        row('Container', `<span class="font-mono text-xs">${(s.dockerId || '—').slice(0, 12)}</span>`),
      ].join('');
    }

    function renderPower(s) {
      const running = s.state === 'running';
      const busy = ['starting', 'stopping', 'restarting', 'installing'].includes(s.state);
      document.getElementById('power').innerHTML = `
        ${!running && !busy ? `<button data-p="start" class="btn btn-primary" ${s.suspended ? 'disabled' : ''}><i data-lucide="play" class="w-4 h-4"></i> Start</button>` : ''}
        ${running ? `<button data-p="stop" class="btn btn-ghost"><i data-lucide="square" class="w-4 h-4"></i> Stop</button>
          <button data-p="restart" class="btn btn-ghost"><i data-lucide="rotate-cw" class="w-4 h-4"></i> Restart</button>
          <button data-p="kill" class="btn btn-danger"><i data-lucide="zap" class="w-4 h-4"></i> Kill</button>` : ''}
        ${busy ? `<span class="badge badge-warn self-center"><span class="dot dot-live"></span> ${s.state}…</span>` : ''}`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      document.querySelectorAll('#power [data-p]').forEach((b) => b.addEventListener('click', () => power(b.dataset.p)));
    }

    async function power(action) {
      try {
        if (action === 'kill' && !(await confirmDialog({ title: 'Kill container?', message: 'Force-kills the process (SIGKILL).', confirmText: 'Kill', danger: true }))) return;
        await api.post(`/servers/${id}/power`, { action });
        toastSuccess(`${action} issued`);
      } catch (e) { toastError(e.message); }
    }

    // Render metrics from the shared runtime-store record.
    function renderMetrics(r) {
      const set = (k, v, sub) => { const el = document.querySelector(`[data-m="${k}"]`); if (el) el.textContent = v; const s = document.querySelector(`[data-msub="${k}"]`); if (s && sub != null) s.innerHTML = sub; };
      set('cpu', `${(r.cpu ?? 0).toFixed(0)}%`, `${server.limits.cpu} cores`);
      set('ram', `${(r.ram?.pct ?? 0).toFixed(0)}%`, `${(r.ram?.usedMb ?? 0).toFixed(0)} / ${r.ram?.totalMb || server.limits.ramMb} MB`);
      set('disk', `${(r.disk?.pct ?? 0).toFixed(0)}%`, `${(r.disk?.usedGb ?? 0).toFixed(2)} / ${(r.disk?.totalGb ?? server.limits.diskMb / 1024).toFixed(1)} GB`);
      set('net', `${((r.networkIn ?? 0) + (r.networkOut ?? 0)).toFixed(2)} Mbps`, r.uptimeMs ? `up ${fmt.duration(r.uptimeMs)}` : '&nbsp;');
    }

    function renderTypeSummary(s) {
      const box = document.getElementById('type-summary');
      if (type === 'minecraft') {
        box.innerHTML = `<div class="glass glass-card p-5"><h3 class="font-bold mb-2">Minecraft</h3><div class="grid sm:grid-cols-3 gap-3 text-sm">
          ${kv('Software', escapeHtml(s.softwareLabel || s.software || ''))}${kv('Version', escapeHtml(s.version || 'LATEST'))}${kv('Max players', s.maxPlayers ?? '—')}</div></div>`;
      } else if (type === 'discord') {
        const env = s.env || {};
        box.innerHTML = `<div class="glass glass-card p-5"><h3 class="font-bold mb-2">Bot</h3><div class="grid sm:grid-cols-3 gap-3 text-sm">
          ${kv('Token', env.DISCORD_TOKEN || env.BOT_TOKEN || env.TOKEN ? '<span class="badge badge-success">set</span>' : '<span class="badge badge-warn">not set</span>')}
          ${kv('Git repo', env.GIT_ADDRESS ? escapeHtml(env.GIT_ADDRESS) : '—')}
          ${kv('Auto-update', env.AUTO_UPDATE === '1' ? 'on' : 'off')}</div>
          <a href="/service/${id}/environment" class="btn btn-sm btn-ghost mt-3"><i data-lucide="list" class="w-4 h-4"></i> Manage in Environment</a></div>`;
      } else {
        box.innerHTML = `<div class="glass glass-card p-5"><h3 class="font-bold mb-2">Runtime</h3><div class="grid sm:grid-cols-3 gap-3 text-sm">
          ${kv('Template', escapeHtml(s.template || '—'))}${kv('Image', `<span class="font-mono text-xs break-all">${escapeHtml(s.image || '')}</span>`)}</div></div>`;
      }
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    }
    const kv = (k, v) => `<div class="glass rounded-xl p-3"><p class="text-slate-500 text-xs">${k}</p><p class="font-semibold mt-0.5">${v}</p></div>`;

    // Static detail (uuid/env/software) from the API; live status+metrics from
    // the shared runtime store so Overview and Console never disagree.
    let detail = server;
    try { detail = (await api.get(`/servers/${id}`)).server; } catch { /* keep base */ }
    renderConn(detail); renderPower(detail); renderTypeSummary(detail);

    const store = window.RuntimeStore;
    store.track(id);
    store.hydrate(id);
    let lastStatus = null;
    const unsub = store.subscribe(id, (r) => {
      renderMetrics(r);
      const state = r.status || detail.state;
      document.getElementById('ov-state').innerHTML = stateBadge(state);
      const cs = document.getElementById('conn-state'); if (cs) cs.outerHTML = `<span id="conn-state">${stateBadge(state)}</span>`;
      if (state !== lastStatus) { lastStatus = state; detail.state = state; renderPower(detail); }
    });

    // Cleanup on tab switch: unsubscribe from the store (channel ref-counted).
    return () => { unsub(); store.untrack(id); };
  };
})();
