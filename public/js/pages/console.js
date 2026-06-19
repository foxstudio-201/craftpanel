/* Terminal — real container log stream + RCON commands.
 *
 * The stream lifecycle is owned by the backend: we subscribe once per server
 * and the server opens/closes the docker follow-stream as the container starts
 * and stops, pushing `console:status`. We never re-subscribe on status changes
 * (that was the old spam/leak source) — we only re-subscribe when switching
 * server or after a socket reconnect. */
Layout.mount(async (content) => {
  const { escapeHtml, fmt, toastError, toastSuccess, toastInfo, confirmDialog } = ui;

  const { servers } = await api.get('/servers');
  if (!servers.length) { content.innerHTML = `<div class="glass glass-card p-10 text-center text-slate-500">No servers yet. Deploy one from the Servers page.</div>`; return; }

  const params = new URLSearchParams(location.search);
  let current = params.get('server') && servers.find((s) => s.id === params.get('server')) ? params.get('server') : servers[0].id;
  let autoscroll = true, paused = false, filterLevel = 'ALL', searchTerm = '', lines = [], online = false;
  const history = []; let histIdx = -1;

  const REASONS = {
    offline: 'Server is offline — logs paused', stopping: 'Server is stopping…', starting: 'Server is starting…',
    restarting: 'Server is restarting…', crashed: 'Server crashed — check the logs above',
    'container-not-found': 'Container not found', 'daemon-unavailable': 'Docker daemon unavailable',
    'stream-error': 'Log stream error', 'stream-ended': 'Server stopped — stream ended', 'no-subscribers': 'Disconnected',
  };

  content.innerHTML = `
    <div class="grid grid-cols-1 xl:grid-cols-4 gap-4">
      <div class="xl:col-span-3 space-y-4">
        <div class="glass glass-card p-4 flex flex-wrap items-center gap-3">
          <select id="srv" class="select w-auto min-w-[12rem]">${servers.map((s) => `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
          <div id="power" class="flex flex-wrap gap-2"></div>
          <div class="relative ml-auto"><i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"></i><input id="search" class="input pl-9 py-2 w-40" placeholder="Search logs…"></div>
          <select id="filter" class="select w-auto"><option>ALL</option><option>INFO</option><option>WARN</option><option>ERROR</option></select>
          <button id="pause" class="btn btn-sm btn-ghost" title="Pause/resume stream"><i data-lucide="pause" class="w-4 h-4"></i></button>
          <button id="copy" class="btn btn-sm btn-ghost" title="Copy logs"><i data-lucide="clipboard" class="w-4 h-4"></i></button>
          <button id="autoscroll" class="btn btn-sm btn-primary" title="Auto-scroll"><i data-lucide="arrow-down" class="w-4 h-4"></i></button>
        </div>
        <div class="glass glass-card p-4">
          <div id="status-banner" class="hidden mb-2 text-xs px-3 py-2 rounded-lg"></div>
          <div id="console" class="console"></div>
          <form id="cmd" class="flex gap-2 mt-3">
            <span class="grid place-items-center px-3 glass rounded-xl text-brand-400 font-mono">&gt;</span>
            <input id="cmd-input" class="input font-mono" placeholder="Type a command (executes via RCON on the real server)…" autocomplete="off">
            <button class="btn btn-primary"><i data-lucide="send" class="w-4 h-4"></i></button>
          </form>
        </div>
      </div>
      <div class="glass glass-card p-5 h-fit">
        <h3 class="font-bold mb-3 flex items-center gap-2"><i data-lucide="info" class="w-4 h-4"></i> Server info</h3>
        <div id="info" class="space-y-2 text-sm"></div>
      </div>
    </div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  const consoleEl = document.getElementById('console');
  const banner = document.getElementById('status-banner');

  const stateBadgeClass = (s) => ({ running: 'badge-success', starting: 'badge-warn', restarting: 'badge-warn', stopping: 'badge-warn', crashed: 'badge-danger', installing: 'badge-info' }[s] || 'badge-muted');

  function render() {
    if (paused) return;
    const filtered = lines.filter((l) => (filterLevel === 'ALL' || l.level === filterLevel) && (!searchTerm || l.text.toLowerCase().includes(searchTerm)));
    consoleEl.innerHTML = filtered.map((l) => `<div class="log-${l.level}"><span class="log-time">${fmt.time(l.ts)}</span><span class="opacity-60">[${l.level}]</span> ${escapeHtml(l.text)}</div>`).join('') || '<p class="text-slate-600">No log lines.</p>';
    if (autoscroll) consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function setBanner(text, kind = 'warn') {
    if (!text) { banner.classList.add('hidden'); return; }
    const colors = { warn: 'bg-amber-500/10 text-amber-300 border border-amber-500/30', error: 'bg-red-500/10 text-red-300 border border-red-500/30', info: 'bg-brand-500/10 text-brand-300 border border-brand-500/30' };
    banner.className = `mb-2 text-xs px-3 py-2 rounded-lg ${colors[kind]}`;
    banner.textContent = text;
    banner.classList.remove('hidden');
  }

  function renderInfo(server, metrics) {
    const row = (k, v) => `<div class="flex justify-between gap-2"><span class="text-slate-500">${k}</span><span class="font-medium text-right break-all">${v}</span></div>`;
    document.getElementById('info').innerHTML = [
      row('Name', escapeHtml(server.name)),
      row('UUID', `<span class="font-mono text-xs">${server.uuid}</span>`),
      row('Owner', escapeHtml(server.owner)),
      row('Node', server.node),
      row('Container', `<span class="font-mono text-xs">${(server.dockerId || '—').slice(0, 12)}</span>`),
      row('Software', `${escapeHtml(server.softwareLabel)} ${escapeHtml(server.version)}`),
      row('CPU limit', `${server.limits.cpu} cores`),
      row('RAM limit', `${(server.limits.ramMb / 1024).toFixed(1)} GB`),
      row('Disk limit', `${(server.limits.diskMb / 1024).toFixed(1)} GB`),
      row('IP : Port', `${server.allocation.ip}:${server.allocation.port}`),
      row('State', `<span class="badge ${stateBadgeClass(server.state)}">${server.state}</span>`),
      row('TPS', metrics ? metrics.tps : '—'),
      row('Uptime', metrics && metrics.uptimeMs ? fmt.duration(metrics.uptimeMs) : '—'),
    ].join('');
  }

  function renderPower(server) {
    const running = server.state === 'running';
    const busy = ['starting', 'stopping', 'restarting', 'installing'].includes(server.state);
    document.getElementById('power').innerHTML = `
      ${!running && !busy ? `<button data-p="start" class="btn btn-sm btn-primary"><i data-lucide="play" class="w-4 h-4"></i> Start</button>` : ''}
      ${running ? `<button data-p="stop" class="btn btn-sm btn-ghost"><i data-lucide="square" class="w-4 h-4"></i> Stop</button>
      <button data-p="restart" class="btn btn-sm btn-ghost"><i data-lucide="rotate-cw" class="w-4 h-4"></i> Restart</button>
      <button data-p="kill" class="btn btn-sm btn-danger"><i data-lucide="zap" class="w-4 h-4"></i> Kill</button>` : ''}
      ${busy ? `<span class="badge ${stateBadgeClass(server.state)} self-center"><span class="dot dot-live"></span> ${server.state}…</span>` : ''}
      <button data-p="reinstall" class="btn btn-sm btn-ghost"><i data-lucide="refresh-cw" class="w-4 h-4"></i> Reinstall</button>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    document.querySelectorAll('#power [data-p]').forEach((b) => b.addEventListener('click', () => power(b.dataset.p)));
  }

  let detail;
  async function power(action) {
    try {
      if ((action === 'kill' || action === 'reinstall') && !(await confirmDialog({ title: `${action}?`, message: action === 'reinstall' ? 'Recreates the container (world kept).' : 'Force kills the process.', confirmText: action, danger: action === 'kill' }))) return;
      if (action === 'reinstall') await api.post(`/servers/${current}/reinstall`);
      else await api.post(`/servers/${current}/power`, { action });
      toastSuccess(`${action} issued`);
    } catch (e) { toastError(e.message); }
  }

  /** Lightweight state refresh — does NOT touch the console subscription. */
  async function refreshState() {
    try { detail = (await api.get(`/servers/${current}`)).server; renderInfo(detail, null); renderPower(detail); } catch { /* ignore */ }
  }

  /** Switch to a server: unsubscribe the previous, load logs, subscribe once. */
  async function switchServer(id) {
    if (current && current !== id) realtime.emit('unsubscribe:console', current), realtime.emit('unsubscribe:server', current);
    current = id;
    detail = (await api.get(`/servers/${current}`)).server;
    renderInfo(detail, null); renderPower(detail);
    const { logs } = await api.get(`/console/${current}/logs`);
    lines = logs.slice(); render();
    realtime.emit('subscribe:console', current);
    realtime.emit('subscribe:server', current);
  }

  // ── Real-time handlers (registered ONCE) ──────────────────────────
  realtime.on('console:line', (line) => {
    if (line.serverId !== current) return;
    lines.push(line); if (lines.length > 1000) lines.shift();
    render();
  });
  realtime.on('console:status', (s) => {
    if (s.serverId !== current) return;
    online = s.online;
    if (s.online) setBanner('');
    else setBanner(REASONS[s.reason] || 'Stream offline', s.reason === 'crashed' || s.reason === 'stream-error' ? 'error' : 'warn');
  });
  realtime.on('metrics:server', (m) => { if (m.serverId === current && detail) renderInfo(detail, m); });
  realtime.on('server:status', (e) => { if (e.serverId === current) refreshState(); });
  // Auto-reconnect: re-subscribe after the socket comes back.
  document.addEventListener('socket:status', (e) => {
    if (e.detail === 'connected' && current) {
      realtime.emit('subscribe:console', current);
      realtime.emit('subscribe:server', current);
      setBanner('Reconnected', 'info'); setTimeout(() => online && setBanner(''), 1500);
    } else if (e.detail === 'disconnected') {
      setBanner('Connection lost — reconnecting…', 'error');
    }
  });

  // ── Controls ──────────────────────────────────────────────────────
  document.getElementById('srv').addEventListener('change', (e) => switchServer(e.target.value));
  document.getElementById('search').addEventListener('input', (e) => { searchTerm = e.target.value.toLowerCase(); render(); });
  document.getElementById('filter').addEventListener('change', (e) => { filterLevel = e.target.value; render(); });
  document.getElementById('autoscroll').addEventListener('click', (e) => { autoscroll = !autoscroll; e.currentTarget.className = 'btn btn-sm ' + (autoscroll ? 'btn-primary' : 'btn-ghost'); if (autoscroll) consoleEl.scrollTop = consoleEl.scrollHeight; });
  document.getElementById('pause').addEventListener('click', (e) => {
    paused = !paused;
    e.currentTarget.className = 'btn btn-sm ' + (paused ? 'btn-warn' : 'btn-ghost');
    e.currentTarget.innerHTML = `<i data-lucide="${paused ? 'play' : 'pause'}" class="w-4 h-4"></i>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    if (!paused) render();
  });
  document.getElementById('copy').addEventListener('click', () => {
    const text = lines.filter((l) => (filterLevel === 'ALL' || l.level === filterLevel) && (!searchTerm || l.text.toLowerCase().includes(searchTerm)))
      .map((l) => `[${l.level}] ${l.text}`).join('\n');
    navigator.clipboard.writeText(text).then(() => toastSuccess('Logs copied')).catch(() => toastError('Copy failed'));
  });

  const cmdInput = document.getElementById('cmd-input');
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') { if (histIdx < history.length - 1) { histIdx++; cmdInput.value = history[history.length - 1 - histIdx] || ''; } e.preventDefault(); }
    else if (e.key === 'ArrowDown') { if (histIdx > 0) { histIdx--; cmdInput.value = history[history.length - 1 - histIdx] || ''; } else { histIdx = -1; cmdInput.value = ''; } e.preventDefault(); }
  });
  document.getElementById('cmd').addEventListener('submit', async (e) => {
    e.preventDefault();
    const command = cmdInput.value.trim();
    if (!command) return;
    history.push(command); histIdx = -1; cmdInput.value = '';
    try { await api.post(`/console/${current}/command`, { command }); }
    catch (err) { toastError(err.message); }
  });

  switchServer(current);
});
