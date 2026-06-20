/* Console tab — REAL terminal (xterm.js) in a two-column layout: a wide terminal
 * (primary focus) beside a sticky, glassmorphism Server Information panel.
 *
 * Live-only + runtime-session bound: raw container bytes stream via console:data
 * only while running; F5 starts empty, the terminal clears on stop / new session,
 * nothing is cached to storage. All status + metrics come from the shared
 * RuntimeStore (one source of truth) so Console and Overview never disagree and
 * a freshly-mounted Console immediately shows the current state.
 *
 * Returns a cleanup fn the SPA router calls on tab switch — no duplicate
 * listeners, subscriptions, log streams or terminals.
 */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  const BADGE = {
    error: '\x1b[91m[ERROR]\x1b[0m', warn: '\x1b[93m[WARN]\x1b[0m', success: '\x1b[92m[SUCCESS]\x1b[0m',
    system: '\x1b[96m[SYSTEM]\x1b[0m', info: '\x1b[90m[INFO]\x1b[0m',
  };
  const stripAnsi = (s) => s.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, '');
  function classify(t) {
    if (/npm error|(^|[^a-z])Error:|EACCES|EADDRINUSE|ENOENT|ECONNREFUSED|uncaught ?exception|UnhandledPromiseRejection|\bERR!|\bFATAL\b|\bSEVERE\b|Traceback \(most recent/i.test(t)) return 'error';
    if (/npm warn|\bwarn(ing)?\b|deprecat/i.test(t)) return 'warn';
    if (/\b(server (started|listening)|listening on|logged in|ready\b|started\.|Done \(|compiled successfully|successfully started|Running on|online!)\b/i.test(t)) return 'success';
    if (/^>\s|^\s*\[?(docker|daemon|container)\b|startup command|Pulling |Image ready|^EULA|^\[Init\]|^\[mc-image-helper\]/i.test(t)) return 'system';
    return 'info';
  }

  // Mbps → human-readable byte rate (MB/s · KB/s).
  function fmtRate(mbps) {
    const bps = (mbps || 0) * 1e6 / 8;
    if (bps >= 1e6) return `${(bps / 1e6).toFixed(2)} MB/s`;
    if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} KB/s`;
    return `${Math.round(bps)} B/s`;
  }
  const fmtMB = (mb) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb || 0)} MB`);

  window.ServiceTabs.console = async function ({ content, server, type }) {
    const { escapeHtml, fmt, toastError, toastSuccess, confirmDialog, serverStatusBadge } = ui;
    const id = server.id;
    const usesRcon = window.ServiceRegistry.feature(type, 'rcon');
    const store = window.RuntimeStore;

    if (!window.Terminal) {
      content.innerHTML = `<div class="glass glass-card p-8 text-center text-amber-300">Terminal component failed to load (xterm.js). Check your network/CSP and reload.</div>`;
      return () => {};
    }

    content.innerHTML = `
      <div class="console-grid">
        <div class="console-main space-y-3">
          <div class="glass glass-card p-3 flex flex-wrap items-center gap-2">
            <div id="power" class="flex flex-wrap gap-2"></div>
            <div class="relative ml-auto">
              <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"></i>
              <input id="search" class="input pl-9 py-2 w-40" placeholder="Search">
            </div>
            <button id="copy" class="btn btn-sm btn-ghost" title="Copy"><i data-lucide="clipboard" class="w-4 h-4"></i></button>
            <button id="clear" class="btn btn-sm btn-ghost" title="Clear view"><i data-lucide="eraser" class="w-4 h-4"></i></button>
            <button id="autoscroll" class="btn btn-sm btn-primary" title="Auto-scroll"><i data-lucide="arrow-down" class="w-4 h-4"></i></button>
          </div>
          <div class="glass glass-card p-3">
            <div id="banner" class="hidden mb-2 text-xs px-3 py-2 rounded-lg"></div>
            <div id="term" class="terminal-host"></div>
            <form id="cmd" class="flex gap-2 mt-3">
              <span class="grid place-items-center px-3 glass rounded-xl text-brand-400 font-mono">&gt;</span>
              <input id="cmd-input" class="input font-mono" placeholder="${usesRcon ? 'Type a command (RCON)…' : 'Send to the process stdin…'}" autocomplete="off" spellcheck="false">
              <button class="btn btn-primary"><i data-lucide="send" class="w-4 h-4"></i></button>
            </form>
          </div>
        </div>
        <aside class="console-aside glass glass-card p-4">
          <div class="flex items-center justify-between gap-2 mb-3">
            <h3 class="font-bold flex items-center gap-2 min-w-0"><i data-lucide="server" class="w-4 h-4 text-brand-300 shrink-0"></i><span class="truncate" title="${escapeHtml(server.name)}">${escapeHtml(server.name)}</span></h3>
            <span id="info-status">${serverStatusBadge(server.state)}</span>
          </div>
          <div id="metric-grid" class="metric-grid mb-3"></div>
          <div id="info-rows"></div>
        </aside>
      </div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    // ── Terminal ──────────────────────────────────────────────────────
    const term = new Terminal({
      convertEol: false, cursorBlink: false, disableStdin: true, scrollback: 5000,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.2, allowProposedApi: true,
      theme: {
        background: '#0b0f17', foreground: '#cbd5e1', cursor: '#34d399', selectionBackground: 'rgba(52,211,153,0.25)',
        black: '#1e293b', red: '#f87171', green: '#34d399', yellow: '#fbbf24', blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e2e8f0',
        brightBlack: '#64748b', brightRed: '#fca5a5', brightGreen: '#86efac', brightYellow: '#fde047', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe', brightCyan: '#67e8f9', brightWhite: '#f8fafc',
      },
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    try { term.loadAddon(new WebLinksAddon.WebLinksAddon()); } catch { /* optional */ }
    const search = new SearchAddon.SearchAddon();
    term.loadAddon(search);
    term.open(document.getElementById('term'));
    const doFit = () => { try { fit.fit(); } catch { /* not visible yet */ } };
    setTimeout(doFit, 30);

    let autoscroll = true;

    // ── Line engine: collapse spinners, classify, real timestamp ──────
    let lineBuf = '';
    const pad = (n) => String(n).padStart(2, '0');
    function tsStr() { const d = new Date(); return `\x1b[90m${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}\x1b[0m`; }
    function commit() {
      const plain = stripAnsi(lineBuf);
      if (plain.trim() === '') { term.write('\r\n'); lineBuf = ''; return; }
      term.write(`\r\x1b[2K${tsStr()} ${BADGE[classify(plain)]} ${lineBuf}\x1b[0m\r\n`);
      lineBuf = '';
      if (autoscroll) term.scrollToBottom();
    }
    function live() { term.write('\r\x1b[2K' + lineBuf); }
    function resetLine() { lineBuf = ''; term.write('\r\x1b[2K'); }
    function feed(data) {
      const parts = data.split(/(\r\n|\n|\r|\x1B\[\d*[GK])/);
      for (const p of parts) {
        if (p === '') continue;
        if (p === '\n' || p === '\r\n') commit();
        else if (p === '\r' || /^\x1B\[\d*[GK]$/.test(p)) resetLine();
        else { lineBuf += p; live(); }
      }
    }
    function clearTerminal() { lineBuf = ''; term.clear(); term.write('\x1b[2K\r'); }

    // ── Server Information panel (from the shared runtime store) ───────
    let runtimeId = server.runtimeId || null;
    function renderInfo(r) {
      const ipPort = r.ip ? `${r.ip}:${r.port ?? '—'}` : '—';
      const card = (label, icon, value, sub) => `
        <div class="metric-card">
          <p class="metric-label"><i data-lucide="${icon}" class="w-3 h-3"></i>${label}</p>
          <p class="metric-value">${value}</p>
          ${sub ? `<p class="metric-sub">${sub}</p>` : ''}
        </div>`;
      document.getElementById('metric-grid').innerHTML = [
        card('CPU', 'cpu', `${(r.cpu ?? 0).toFixed(0)}%`, ''),
        card('Memory', 'memory-stick', `${fmtMB(r.ram?.usedMb)} <span class="text-slate-500 text-xs">/ ${fmtMB(r.ram?.totalMb)}</span>`, ''),
        card('Disk', 'hard-drive', `${(r.disk?.usedGb ?? 0).toFixed(1)} GB <span class="text-slate-500 text-xs">/ ${(r.disk?.totalGb ?? 0).toFixed(0)} GB</span>`, ''),
        card('Uptime', 'clock', r.uptimeMs ? fmt.duration(r.uptimeMs) : '—', ''),
        card('Network In', 'arrow-down', fmtRate(r.networkIn), ''),
        card('Network Out', 'arrow-up', fmtRate(r.networkOut), ''),
      ].join('');
      const row = (k, v) => `<div class="info-row"><span class="k">${k}</span><span class="v">${v}</span></div>`;
      document.getElementById('info-rows').innerHTML = [
        row('IP Address', `<span class="font-mono">${escapeHtml(ipPort)}</span>`),
        row('Status', serverStatusBadge(r.status)),
        row('Runtime ID', `<span class="font-mono text-xs">${r.runtimeId ? r.runtimeId.slice(0, 8) : '—'}</span>`),
        row('Container ID', `<span class="font-mono text-xs">${r.containerId ? r.containerId.slice(0, 12) : '—'}</span>`),
        row('Node', escapeHtml(r.node || 'local')),
        row('Owner', escapeHtml(r.owner || '—')),
      ].join('');
      const st = document.getElementById('info-status'); if (st) st.innerHTML = serverStatusBadge(r.status);
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    }

    // ── Banner + power ────────────────────────────────────────────────
    const banner = document.getElementById('banner');
    const REASONS = {
      offline: 'Service is offline — console cleared', stopping: 'Stopping…', starting: 'Starting…', restarting: 'Restarting…',
      crashed: 'Crashed — check the logs above', 'container-not-found': 'Container not found', 'daemon-unavailable': 'Docker daemon unavailable',
      'stream-error': 'Log stream error', 'stream-ended': 'Stopped — stream ended', 'no-subscribers': 'Disconnected',
    };
    let online = false;
    function setBanner(text, kind = 'warn') {
      if (!text) { banner.classList.add('hidden'); return; }
      const c = { warn: 'bg-amber-500/10 text-amber-300 border border-amber-500/30', error: 'bg-red-500/10 text-red-300 border border-red-500/30', info: 'bg-brand-500/10 text-brand-300 border border-brand-500/30' };
      banner.className = `mb-2 text-xs px-3 py-2 rounded-lg ${c[kind]}`;
      banner.textContent = text; banner.classList.remove('hidden');
    }
    let lastPowerState = null;
    function renderPower(state) {
      if (state === lastPowerState) return; lastPowerState = state;
      const running = state === 'running';
      const busy = ['starting', 'stopping', 'restarting', 'installing'].includes(state);
      document.getElementById('power').innerHTML = `
        ${!running && !busy ? `<button data-p="start" class="btn btn-sm btn-primary"><i data-lucide="play" class="w-4 h-4"></i> Start</button>` : ''}
        ${running ? `<button data-p="stop" class="btn btn-sm btn-ghost"><i data-lucide="square" class="w-4 h-4"></i> Stop</button>
          <button data-p="restart" class="btn btn-sm btn-ghost"><i data-lucide="rotate-cw" class="w-4 h-4"></i> Restart</button>
          <button data-p="kill" class="btn btn-sm btn-danger"><i data-lucide="zap" class="w-4 h-4"></i> Kill</button>` : ''}
        ${busy ? `<span class="badge badge-warn self-center"><span class="dot dot-live"></span> ${state}…</span>` : ''}`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      document.querySelectorAll('#power [data-p]').forEach((b) => b.addEventListener('click', () => power(b.dataset.p)));
    }
    async function power(action) {
      try {
        if (action === 'kill' && !(await confirmDialog({ title: 'Kill container?', message: 'Force-kills the process (SIGKILL).', confirmText: 'Kill', danger: true }))) return;
        await api.post(`/servers/${id}/power`, { action }); toastSuccess(`${action} issued`);
      } catch (e) { toastError(e.message); }
    }

    // ── Runtime state: ONE source of truth (RuntimeStore) ─────────────
    store.track(id);
    store.hydrate(id);
    let wasEnded = false;
    const unsubStore = store.subscribe(id, (r) => {
      // Session reconciliation: clear the terminal ONCE when the run ends or a
      // new runtime session begins (not on every metrics tick).
      const ended = !r.runtimeId || ['offline', 'crashed', 'stopping'].includes(r.status);
      const changed = r.runtimeId && r.runtimeId !== runtimeId;
      if (changed || (ended && !wasEnded)) clearTerminal();
      wasEnded = ended;
      runtimeId = r.runtimeId || null;
      renderInfo(r);
      renderPower(r.status);
    });

    // ── Log stream (separate from metrics; gated on a live session) ───
    // A `replay` message is the backend runtime buffer for the current session
    // (sent once on (re)subscribe — refresh / tab switch / re-navigation). It is
    // authoritative: clear first, then write it, so any live chunk that raced in
    // during attach can't duplicate. Subsequent live chunks append normally.
    const onData = (m) => {
      if (m.serverId !== id || !runtimeId) return;
      if (m.replay) { clearTerminal(); }
      feed(m.data);
    };
    const onStatus = (s) => {
      if (s.serverId !== id) return; online = s.online;
      if (!s.online) setBanner(REASONS[s.reason] || 'Stream offline', s.reason === 'crashed' || s.reason === 'stream-error' ? 'error' : 'warn');
      else setBanner('');
    };
    const onSocket = (e) => {
      if (e.detail === 'connected') { realtime.emit('subscribe:console', id); setBanner('Reconnected', 'info'); setTimeout(() => online && setBanner(''), 1500); }
      else if (e.detail === 'disconnected') setBanner('Connection lost — reconnecting…', 'error');
    };
    realtime.on('console:data', onData);
    realtime.on('console:status', onStatus);
    document.addEventListener('socket:status', onSocket);
    realtime.emit('subscribe:console', id);

    // ── Resize ────────────────────────────────────────────────────────
    let rt; const onResize = () => { clearTimeout(rt); rt = setTimeout(doFit, 80); };
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize); ro.observe(document.getElementById('term'));

    // ── Controls ──────────────────────────────────────────────────────
    const searchInput = document.getElementById('search');
    searchInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return; e.preventDefault();
      const q = searchInput.value; if (!q) return;
      e.shiftKey ? search.findPrevious(q) : search.findNext(q);
    });
    document.getElementById('copy').addEventListener('click', () => {
      let text = term.getSelection();
      if (!text) { term.selectAll(); text = term.getSelection(); term.clearSelection(); }
      navigator.clipboard.writeText(text).then(() => toastSuccess('Copied')).catch(() => toastError('Copy failed'));
    });
    document.getElementById('clear').addEventListener('click', () => clearTerminal());
    document.getElementById('autoscroll').addEventListener('click', (e) => {
      autoscroll = !autoscroll;
      e.currentTarget.className = 'btn btn-sm ' + (autoscroll ? 'btn-primary' : 'btn-ghost');
      if (autoscroll) term.scrollToBottom();
    });

    const cmdInput = document.getElementById('cmd-input');
    const history = []; let hi = -1;
    cmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowUp') { if (hi < history.length - 1) { hi++; cmdInput.value = history[history.length - 1 - hi] || ''; } e.preventDefault(); }
      else if (e.key === 'ArrowDown') { if (hi > 0) { hi--; cmdInput.value = history[history.length - 1 - hi] || ''; } else { hi = -1; cmdInput.value = ''; } e.preventDefault(); }
    });
    document.getElementById('cmd').addEventListener('submit', async (e) => {
      e.preventDefault();
      const command = cmdInput.value.trim(); if (!command) return;
      history.push(command); hi = -1; cmdInput.value = '';
      try { await api.post(`/console/${id}/command`, { command }); } catch (err) { toastError(err.message); }
    });

    // ── Cleanup for the SPA router ────────────────────────────────────
    return () => {
      try { realtime.emit('unsubscribe:console', id); } catch { /* */ }
      unsubStore(); store.untrack(id);
      realtime.off('console:data', onData);
      realtime.off('console:status', onStatus);
      document.removeEventListener('socket:status', onSocket);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      try { term.dispose(); } catch { /* */ }
    };
  };
})();
