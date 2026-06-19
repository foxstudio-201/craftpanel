/* Console tab — a REAL terminal (xterm.js).
 *
 * The backend streams raw container bytes (console:data); this module is the
 * terminal emulator. xterm renders ANSI colors/bold/italic/underline natively;
 * a small line engine collapses carriage-return spinners (\r, CSI nG, CSI nK)
 * so npm progress overwrites a single row instead of flooding, classifies each
 * completed line (error/warn/success/system/info) and prefixes it with a real
 * timestamp + badge — like a Pterodactyl wing console. Nothing is synthesised;
 * we render exactly what the container emits, cleaned of control characters.
 */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  const BADGE = {
    error:   '\x1b[91m[ERROR]\x1b[0m',
    warn:    '\x1b[93m[WARN]\x1b[0m',
    success: '\x1b[92m[SUCCESS]\x1b[0m',
    system:  '\x1b[96m[SYSTEM]\x1b[0m',
    info:    '\x1b[90m[INFO]\x1b[0m',
  };

  const stripAnsi = (s) => s.replace(/\x1B\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\x1B\][^\x07]*(\x07|\x1B\\)/g, '');

  function classify(plain) {
    const t = plain;
    if (/npm error|(^|[^a-z])Error:|EACCES|EADDRINUSE|ENOENT|ECONNREFUSED|uncaught ?exception|UnhandledPromiseRejection|\bERR!|\bFATAL\b|\bSEVERE\b|Traceback \(most recent/i.test(t)) return 'error';
    if (/npm warn|\bwarn(ing)?\b|deprecat/i.test(t)) return 'warn';
    if (/\b(server (started|listening)|listening on|logged in|ready\b|started\.|Done \(|compiled successfully|successfully started|Running on|online!)\b/i.test(t)) return 'success';
    if (/^>\s|^\s*\[?(docker|daemon|container)\b|startup command|Pulling |Image ready|^EULA|^\[Init\]|^\[mc-image-helper\]/i.test(t)) return 'system';
    return 'info';
  }

  window.ServiceTabs.console = async function ({ content, server, type }) {
    const { escapeHtml, toastError, toastSuccess, confirmDialog } = ui;
    const id = server.id;
    const usesRcon = window.ServiceRegistry.feature(type, 'rcon');

    if (!window.Terminal) {
      content.innerHTML = `<div class="glass glass-card p-8 text-center text-amber-300">Terminal component failed to load (xterm.js). Check your network/CSP and reload.</div>`;
      return;
    }

    content.innerHTML = `
      <div class="space-y-4">
        <div class="glass glass-card p-3 flex flex-wrap items-center gap-2">
          <div id="power" class="flex flex-wrap gap-2"></div>
          <div class="relative ml-auto">
            <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"></i>
            <input id="search" class="input pl-9 py-2 w-44" placeholder="Search (Enter / Shift+Enter)">
          </div>
          <button id="copy" class="btn btn-sm btn-ghost" title="Copy selection / all"><i data-lucide="clipboard" class="w-4 h-4"></i></button>
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
      </div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    // ── Terminal ──────────────────────────────────────────────────────
    const term = new Terminal({
      convertEol: false, cursorBlink: false, disableStdin: true, scrollback: 5000,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontSize: 12.5, lineHeight: 1.2,
      allowProposedApi: true,
      theme: {
        background: '#0b0f17', foreground: '#cbd5e1', cursor: '#34d399',
        selectionBackground: 'rgba(52,211,153,0.25)',
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

    // ── Line engine: collapse spinners, classify, timestamp ───────────
    let lineBuf = '';
    let histMode = false;
    const pad = (n) => String(n).padStart(2, '0');
    function tsStr() {
      if (histMode) return '\x1b[90m--:--:--\x1b[0m';
      const d = new Date();
      return `\x1b[90m${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}\x1b[0m`;
    }
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
      // Split keeping control delimiters: CRLF / LF / CR / CSI-cursor-col / CSI-erase-line.
      const parts = data.split(/(\r\n|\n|\r|\x1B\[\d*[GK])/);
      for (const p of parts) {
        if (p === '') continue;
        if (p === '\n' || p === '\r\n') commit();
        else if (p === '\r' || /^\x1B\[\d*[GK]$/.test(p)) resetLine();   // carriage return / erase → spinner overwrite
        else { lineBuf += p; live(); }
      }
    }

    // ── Status banner + power ─────────────────────────────────────────
    const banner = document.getElementById('banner');
    const REASONS = {
      offline: 'Service is offline — logs paused', stopping: 'Stopping…', starting: 'Starting…', restarting: 'Restarting…',
      crashed: 'Crashed — check the logs above', 'container-not-found': 'Container not found', 'daemon-unavailable': 'Docker daemon unavailable',
      'stream-error': 'Log stream error', 'stream-ended': 'Stopped — stream ended', 'no-subscribers': 'Disconnected',
    };
    function setBanner(text, kind = 'warn') {
      if (!text) { banner.classList.add('hidden'); return; }
      const c = { warn: 'bg-amber-500/10 text-amber-300 border border-amber-500/30', error: 'bg-red-500/10 text-red-300 border border-red-500/30', info: 'bg-brand-500/10 text-brand-300 border border-brand-500/30' };
      banner.className = `mb-2 text-xs px-3 py-2 rounded-lg ${c[kind]}`;
      banner.textContent = text; banner.classList.remove('hidden');
    }
    const stateBadgeClass = (s) => ({ running: 'badge-success', starting: 'badge-warn', restarting: 'badge-warn', stopping: 'badge-warn', crashed: 'badge-danger', installing: 'badge-info' }[s] || 'badge-muted');
    let detail = server, online = false;
    function renderPower(s) {
      const running = s.state === 'running';
      const busy = ['starting', 'stopping', 'restarting', 'installing'].includes(s.state);
      document.getElementById('power').innerHTML = `
        ${!running && !busy ? `<button data-p="start" class="btn btn-sm btn-primary"><i data-lucide="play" class="w-4 h-4"></i> Start</button>` : ''}
        ${running ? `<button data-p="stop" class="btn btn-sm btn-ghost"><i data-lucide="square" class="w-4 h-4"></i> Stop</button>
          <button data-p="restart" class="btn btn-sm btn-ghost"><i data-lucide="rotate-cw" class="w-4 h-4"></i> Restart</button>
          <button data-p="kill" class="btn btn-sm btn-danger"><i data-lucide="zap" class="w-4 h-4"></i> Kill</button>` : ''}
        ${busy ? `<span class="badge ${stateBadgeClass(s.state)} self-center"><span class="dot dot-live"></span> ${s.state}…</span>` : ''}`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      document.querySelectorAll('#power [data-p]').forEach((b) => b.addEventListener('click', () => power(b.dataset.p)));
    }
    async function power(action) {
      try {
        if (action === 'kill' && !(await confirmDialog({ title: 'Kill container?', message: 'Force-kills the process (SIGKILL).', confirmText: 'Kill', danger: true }))) return;
        await api.post(`/servers/${id}/power`, { action }); toastSuccess(`${action} issued`);
      } catch (e) { toastError(e.message); }
    }
    async function refreshState() { try { detail = (await api.get(`/servers/${id}`)).server; renderPower(detail); } catch { /* ignore */ } }

    // ── Realtime (one subscription; cleaned up on leave) ──────────────
    const onData = (m) => { if (m.serverId === id) feed(m.data); };
    const onStatus = (s) => {
      if (s.serverId !== id) return; online = s.online;
      if (s.online) setBanner(''); else setBanner(REASONS[s.reason] || 'Stream offline', s.reason === 'crashed' || s.reason === 'stream-error' ? 'error' : 'warn');
    };
    const onServerStatus = (e) => { if (e.serverId === id) refreshState(); };
    const onSocket = (e) => {
      if (e.detail === 'connected') { realtime.emit('subscribe:console', id); realtime.emit('subscribe:server', id); setBanner('Reconnected', 'info'); setTimeout(() => online && setBanner(''), 1500); }
      else if (e.detail === 'disconnected') setBanner('Connection lost — reconnecting…', 'error');
    };
    realtime.on('console:data', onData);
    realtime.on('console:status', onStatus);
    realtime.on('server:status', onServerStatus);
    document.addEventListener('socket:status', onSocket);

    // Teardown: stop the stream, drop listeners, dispose the terminal.
    let torn = false;
    function teardown() {
      if (torn) return; torn = true;
      try { realtime.emit('unsubscribe:console', id); realtime.emit('unsubscribe:server', id); } catch { /* */ }
      realtime.off('console:data', onData); realtime.off('console:status', onStatus); realtime.off('server:status', onServerStatus);
      document.removeEventListener('socket:status', onSocket);
      window.removeEventListener('resize', onResize); ro?.disconnect();
      try { term.dispose(); } catch { /* */ }
    }
    window.addEventListener('pagehide', teardown, { once: true });
    window.addEventListener('beforeunload', teardown, { once: true });

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
    document.getElementById('clear').addEventListener('click', () => term.clear());
    document.getElementById('autoscroll').addEventListener('click', (e) => {
      autoscroll = !autoscroll;
      e.currentTarget.className = 'btn btn-sm ' + (autoscroll ? 'btn-primary' : 'btn-ghost');
      if (autoscroll) term.scrollToBottom();
    });

    // Command box + history
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

    // ── Boot: replay history (honest '--:--:--'), then go live ────────
    renderPower(detail);
    histMode = true;
    try { const { content: c } = await api.get(`/console/${id}/logs`); if (c) feed(c.endsWith('\n') ? c : c + '\n'); } catch { /* none */ }
    histMode = false;
    term.scrollToBottom();
    realtime.emit('subscribe:console', id);
    realtime.emit('subscribe:server', id);
  };
})();
