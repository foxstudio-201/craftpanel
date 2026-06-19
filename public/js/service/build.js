/* Build tab (Static) — trigger real builds, stream live logs, view history and
   roll back deployments. Logs/status come from the real container build. */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  const STATUS = { queued: 'badge-warn', running: 'badge-info', success: 'badge-success', failed: 'badge-danger', cancelled: 'badge-muted' };

  window.ServiceTabs.build = async function ({ content, server }) {
    const { escapeHtml, fmt, confirmDialog, toastSuccess, toastError } = ui;
    const id = server.id;
    let liveBuildId = null;

    content.innerHTML = `
      <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div class="xl:col-span-2 space-y-4">
          <div class="glass glass-card p-4 flex flex-wrap items-center gap-3">
            <button id="build" class="btn btn-primary"><i data-lucide="hammer" class="w-4 h-4"></i> Build & Publish</button>
            <button id="redeploy" class="btn btn-ghost"><i data-lucide="rocket" class="w-4 h-4"></i> Redeploy</button>
            <button id="cancel" class="btn btn-danger hidden"><i data-lucide="x" class="w-4 h-4"></i> Cancel</button>
            <span id="live-status" class="ml-auto"></span>
          </div>
          <div class="glass glass-card p-4">
            <div class="flex items-center justify-between mb-2"><h3 class="font-bold text-sm">Build log</h3><span id="log-meta" class="text-xs text-slate-500"></span></div>
            <div id="log" class="console" style="min-height:18rem"></div>
          </div>
        </div>
        <div class="space-y-4">
          <div class="glass glass-card p-4">
            <h3 class="font-bold mb-3 flex items-center gap-2"><i data-lucide="history" class="w-4 h-4"></i> History</h3>
            <div id="history" class="space-y-2 max-h-[20rem] overflow-y-auto"></div>
          </div>
          <div class="glass glass-card p-4">
            <h3 class="font-bold mb-3 flex items-center gap-2"><i data-lucide="layers" class="w-4 h-4"></i> Deployments</h3>
            <div id="deployments" class="space-y-2 max-h-[18rem] overflow-y-auto"></div>
          </div>
        </div>
      </div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    const logEl = document.getElementById('log');
    const setStatus = (s) => { document.getElementById('live-status').innerHTML = s ? `<span class="badge ${STATUS[s] || 'badge-muted'}">${s}</span>` : ''; };
    const showCancel = (on) => document.getElementById('cancel').classList.toggle('hidden', !on);

    function renderLog(logs) {
      logEl.innerHTML = (logs || []).map((l) => `<div class="log-${l.stream === 'stderr' ? 'ERROR' : l.stream === 'system' ? 'WARN' : 'INFO'}"><span class="log-time">${fmt.time(l.ts)}</span> ${escapeHtml(l.line)}</div>`).join('') || '<p class="text-slate-600">No output yet.</p>';
      logEl.scrollTop = logEl.scrollHeight;
      document.getElementById('log-meta').textContent = `${(logs || []).length} lines`;
    }
    function appendLogLine(l) {
      const div = document.createElement('div');
      div.className = `log-${l.stream === 'stderr' ? 'ERROR' : l.stream === 'system' ? 'WARN' : 'INFO'}`;
      div.innerHTML = `<span class="log-time">${fmt.time(l.ts)}</span> ${escapeHtml(l.line)}`;
      logEl.appendChild(div); logEl.scrollTop = logEl.scrollHeight;
    }

    async function openBuild(buildId) {
      liveBuildId = buildId;
      try { const { build } = await api.get(`/servers/${id}/builds/${buildId}`); renderLog(build.logs); setStatus(build.status); showCancel(['queued', 'running'].includes(build.status)); }
      catch (e) { toastError(e.message); }
    }

    async function load() {
      const { builds, deployments } = await api.get(`/servers/${id}/builds`);
      const hist = document.getElementById('history');
      hist.innerHTML = builds.length ? builds.map((b) => `<button data-build="${b.id}" class="w-full text-left glass rounded-lg p-2 hover:bg-white/5 flex items-center justify-between gap-2">
        <span class="min-w-0"><span class="badge ${STATUS[b.status] || 'badge-muted'}">${b.status}</span> <span class="text-xs text-slate-400">${b.trigger}</span></span>
        <span class="text-[0.65rem] text-slate-500 shrink-0">${fmt.relative(b.createdAt)}</span>
      </button>`).join('') : '<p class="text-xs text-slate-500">No builds yet.</p>';
      hist.querySelectorAll('[data-build]').forEach((b) => b.addEventListener('click', () => openBuild(b.dataset.build)));

      const dep = document.getElementById('deployments');
      dep.innerHTML = deployments.length ? deployments.map((d) => `<div class="glass rounded-lg p-2 flex items-center justify-between gap-2">
        <span class="min-w-0"><span class="badge ${d.status === 'live' ? 'badge-success' : 'badge-muted'}">${d.status}</span> <span class="text-[0.65rem] text-slate-500">${fmt.relative(d.createdAt)} · ${fmt.bytes(d.sizeBytes)}</span></span>
        ${d.status !== 'live' ? `<button data-rollback="${d.id}" class="btn btn-sm btn-ghost shrink-0" title="Roll back"><i data-lucide="rotate-ccw" class="w-4 h-4"></i></button>` : ''}
      </div>`).join('') : '<p class="text-xs text-slate-500">No published deployments yet.</p>';
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      dep.querySelectorAll('[data-rollback]').forEach((b) => b.addEventListener('click', async () => {
        if (!(await confirmDialog({ title: 'Roll back?', message: 'Restores this deployment and restarts the site.', confirmText: 'Roll back', danger: true }))) return;
        try { await api.post(`/servers/${id}/deployments/${b.dataset.rollback}/rollback`); toastSuccess('Rolled back'); load(); } catch (e) { toastError(e.message); }
      }));

      if (!liveBuildId && builds[0]) openBuild(builds[0].id);
    }

    document.getElementById('build').addEventListener('click', async () => {
      try { const { build } = await api.post(`/servers/${id}/builds`, { publish: true }); liveBuildId = build.id; logEl.innerHTML = ''; setStatus('queued'); showCancel(true); toastSuccess('Build queued'); load(); }
      catch (e) { toastError(e.message); }
    });
    document.getElementById('redeploy').addEventListener('click', async () => {
      try { const { build } = await api.post(`/servers/${id}/redeploy`); liveBuildId = build.id; logEl.innerHTML = ''; setStatus('queued'); showCancel(true); toastSuccess('Redeploy queued'); load(); }
      catch (e) { toastError(e.message); }
    });
    document.getElementById('cancel').addEventListener('click', async () => {
      if (!liveBuildId) return;
      try { await api.post(`/servers/${id}/builds/${liveBuildId}/cancel`); toastSuccess('Cancellation requested'); } catch (e) { toastError(e.message); }
    });

    // Live build stream (named handlers → detach on tab switch)
    const onLog = (l) => { if (l.serverId === id && l.buildId === liveBuildId) appendLogLine(l); };
    const onEvent = (e) => { if (e.serverId !== id) return; if (e.buildId === liveBuildId) { setStatus(e.status); showCancel(['queued', 'running'].includes(e.status)); } load(); };
    realtime.on('build:log', onLog);
    realtime.on('build:event', onEvent);
    realtime.emit('subscribe:build', id);

    await load();

    return () => {
      realtime.off('build:log', onLog);
      realtime.off('build:event', onEvent);
      realtime.emit('unsubscribe:build', id);
    };
  };
})();
