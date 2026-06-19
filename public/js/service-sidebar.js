/* Dynamic per-service sidebar. Built from the service-type page manifest
   (ServiceRegistry.pagesFor) so each service only shows the pages that apply to
   its type — no conditional hiding of a shared global sidebar. Replaces the
   static sidebar partial for the /service/:id/<tab> shell. */
(function () {
  const { el, escapeHtml } = window.ui;

  const stateDot = (state) => ({
    running: 'dot-live', starting: 'dot-warn', restarting: 'dot-warn', stopping: 'dot-warn',
    installing: 'dot-warn', crashed: 'dot-danger', install_failed: 'dot-danger',
  }[state] || 'dot-idle');

  /** A bare sidebar shell (used for error states before a service resolves). */
  function empty() {
    return el(`<aside class="sidebar glass-strong" id="sidebar">
      <a href="/services" class="nav-link"><i data-lucide="arrow-left" class="w-5 h-5"></i> All services</a>
    </aside>`);
  }

  /** Build the sidebar node for a given service + active tab. */
  function build({ server, type, tab }) {
    const reg = window.ServiceRegistry;
    const pages = reg.pagesFor(type);
    const icon = reg.iconFor(type);
    const typeLabel = reg.labelFor(type);

    const links = pages.map((p) => `
      <a href="/service/${server.id}/${p.key}" data-nav="${p.key}" class="nav-link ${p.key === tab ? 'active' : ''}">
        <i data-lucide="${p.icon || 'circle'}" class="w-5 h-5"></i> ${escapeHtml(p.label || p.key)}
      </a>`).join('');

    const aside = el(`<aside class="sidebar glass-strong" id="sidebar">
      <a href="/services" class="nav-link text-slate-400 hover:text-slate-200 mb-1"><i data-lucide="arrow-left" class="w-4 h-4"></i> All services</a>

      <div class="flex items-center gap-3 px-2 py-2 mb-2 glass rounded-2xl">
        <div class="w-10 h-10 rounded-xl grid place-items-center bg-gradient-to-br from-brand-500 to-accent-500 shadow-glow shrink-0">
          <i data-lucide="${icon}" class="w-5 h-5 text-white"></i>
        </div>
        <div class="min-w-0">
          <p class="font-display font-bold leading-none truncate" title="${escapeHtml(server.name)}">${escapeHtml(server.name)}</p>
          <p class="text-[0.65rem] text-slate-500 mt-1 flex items-center gap-1.5">
            <span class="dot ${stateDot(server.state)}" data-sb-dot></span>
            <span class="uppercase tracking-wide">${escapeHtml(typeLabel)}</span>
          </p>
        </div>
      </div>

      <nav class="flex-1 overflow-y-auto -mx-1 px-1">${links}</nav>

      <div class="glass rounded-2xl p-3 mt-2">
        <div class="flex items-center gap-2 text-xs text-slate-400 mb-2">
          <span class="dot dot-live"></span> <span id="sb-status">Live</span>
        </div>
        <button data-logout class="btn btn-ghost w-full btn-sm"><i data-lucide="log-out" class="w-4 h-4"></i> Sign out</button>
      </div>
    </aside>`);

    // Keep the service status dot live as power state changes.
    window.realtime?.on('server:status', (e) => {
      if (e?.serverId !== server.id) return;
      const dot = aside.querySelector('[data-sb-dot]');
      if (dot) dot.className = `dot ${stateDot(e.state)}`;
    });

    return aside;
  }

  window.ServiceSidebar = { build, empty };
})();
