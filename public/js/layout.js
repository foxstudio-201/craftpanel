/* Builds the authenticated app shell: injects the sidebar + navbar partials,
   wires navigation, the user menu, notifications and mobile behaviour.

   Two entry points share the same chrome (navbar + notifications + mobile):
     • Layout.mount(render)        — global pages, static sidebar partial.
     • Layout.mountService(opts,r) — per-service shell at /service/:id/<tab>,
                                     with a sidebar generated from the service
                                     type registry (see service-sidebar.js).

   A global page opts in by including:
     <div class="app-shell" data-page="dashboard" data-title="Dashboard" data-subtitle="…"></div>
   and calling Layout.mount(renderFn). */
(function () {
  const { $, $$, el, fmt, escapeHtml } = window.ui;

  const CHART_CDN = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';

  /**
   * Global route table — drives the in-page SPA for the persistent app shell.
   * Each entry: title/subtitle for the navbar, optional admin guard, the page
   * module to lazy-load, and any extra deps to ensure first. The page key equals
   * the sidebar data-nav / data-page value. Service routes (/service/:id/<tab>)
   * are handled by their own shell (service.html) and are intentionally NOT here.
   */
  const ROUTES = {
    marketplace:    { title: 'Marketplace', subtitle: 'Deploy a new service', module: '/js/pages/marketplace.js' },
    services:       { title: 'My Services', subtitle: 'All your service instances', module: '/js/pages/services.js', deps: ['/js/service-registry.js'] },
    dashboard:      { title: 'Overview', subtitle: 'Live server overview', admin: true, module: '/js/pages/dashboard.js', deps: [CHART_CDN] },
    monitoring:     { title: 'Monitoring', subtitle: 'CPU, RAM, storage & network history', admin: true, module: '/js/pages/monitoring.js', deps: [CHART_CDN] },
    'api-keys':     { title: 'API', subtitle: 'Keys, scopes, rate limits & documentation', module: '/js/pages/api.js' },
    activity:       { title: 'Activity', subtitle: 'Your activity log', module: '/js/pages/activity.js' },
    profile:        { title: 'Profile', subtitle: 'Your account & security', module: '/js/pages/profile.js' },
    settings:       { title: 'Settings', subtitle: 'Configure your panel', module: '/js/pages/settings.js' },
    admin:          { title: 'Admin Dashboard', subtitle: 'Infrastructure & user administration', admin: true, module: '/js/pages/admin.js' },
    infrastructure: { title: 'Infrastructure', subtitle: 'Tunnel, ports, Docker & isolation from Pterodactyl', admin: true, module: '/js/pages/infrastructure.js' },
    users:          { title: 'Users', subtitle: 'User management', admin: true, module: '/js/pages/users.js' },
    databases:      { title: 'Databases', subtitle: 'MySQL, MariaDB & PostgreSQL hosting', module: '/js/pages/databases.js' },
    domains:        { title: 'Domains', subtitle: 'Domain & reverse-proxy manager', admin: true, module: '/js/pages/domains.js' },
    network:        { title: 'Network', subtitle: 'IP & port allocations', module: '/js/pages/network.js' },
  };

  const pathOf = (key) => '/' + key;
  function routeOf(pathname) {
    const seg = (pathname || '').replace(/^\/+|\/+$/g, '');
    if (!seg || seg.startsWith('service/')) return null; // service shell handles its own routes
    const key = seg.split('/')[0];
    return ROUTES[key] ? key : null;
  }

  // ── SPA shell state (built once, reused across navigations) ───────────
  let appState = null;        // { sidebar, navbar, content, user }
  let currentKey = null;      // active global route key
  let currentCleanup = null;  // teardown fn returned by the active page (if any)
  let loadingKey = null;      // route whose module is currently being injected
  const routeRenderers = {};  // key -> render fn (captured from Layout.mount)
  const loadedScripts = new Set();
  const moduleWaiters = {};   // key -> resolve fn for the inject-and-capture promise

  async function fetchPartial(path) {
    const res = await fetch(path);
    return res.text();
  }

  /** Inject a <script> once (cached by src); resolves when it has executed. */
  function loadScript(src) {
    if (loadedScripts.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = false;
      s.onload = () => { loadedScripts.add(src); resolve(); };
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  /** Ensure a route's render fn is available (lazy-load deps + module once). */
  async function ensureRenderer(key) {
    if (routeRenderers[key]) return routeRenderers[key];
    const meta = ROUTES[key];
    for (const dep of meta.deps || []) await loadScript(dep);
    loadingKey = key;
    const captured = new Promise((resolve) => { moduleWaiters[key] = resolve; });
    await loadScript(meta.module);
    await captured; // the module's Layout.mount(fn) resolves this
    loadingKey = null;
    return routeRenderers[key];
  }

  /** Destroy any Chart.js instances inside a node before it's discarded. */
  function destroyCharts(node) {
    if (!window.Chart?.getChart) return;
    node.querySelectorAll('canvas').forEach((c) => { try { window.Chart.getChart(c)?.destroy(); } catch { /* */ } });
  }

  function setActive(key) {
    $$('[data-nav]', appState.sidebar).forEach((a) => a.classList.toggle('active', a.dataset.nav === key));
  }
  function setHeading(title, subtitle) {
    const t = $('[data-page-title]', appState.navbar); if (t && title) t.textContent = title;
    const s = $('[data-page-subtitle]', appState.navbar); if (s && subtitle != null) s.textContent = subtitle;
    if (title) document.title = `${title} · CraftPanel`;
  }

  /**
   * Render a global route into the persistent content host — the heart of the
   * SPA. Tears down the previous page (cleanup fn + scoped listeners + charts),
   * lazy-loads the target module, then runs it inside a listener scope so it
   * leaves nothing behind. The shell (sidebar/navbar/socket/notifications) and
   * the single WebSocket are never rebuilt; only <main> changes.
   */
  async function runPage(key, { push = true } = {}) {
    const meta = ROUTES[key];
    if (meta?.admin && !window.auth.can('admin')) { return runPage('marketplace', { push }); }

    const path = pathOf(key);
    if (push) { if (location.pathname !== path) history.pushState({ key }, '', path); }

    // Teardown the outgoing page (no leaked listeners / charts / streams).
    if (currentCleanup) { try { currentCleanup(); } catch { /* ignore */ } currentCleanup = null; }
    if (currentKey) window.realtime?.clearScope('page:' + currentKey);
    if (appState.content) destroyCharts(appState.content);

    currentKey = key;
    setActive(key);
    if (meta) setHeading(meta.title, meta.subtitle);

    const content = appState.content;
    content.innerHTML = '<div class="p-10 text-center text-slate-500"><i data-lucide="loader" class="w-5 h-5 inline animate-spin"></i></div>';
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    let render;
    try { render = await ensureRenderer(key); }
    catch (err) { content.innerHTML = `<div class="glass-card glass p-8 text-center text-red-300">Failed to load page: ${escapeHtml(err.message)}</div>`; return; }

    content.innerHTML = '';
    window.realtime?.beginScope('page:' + key);
    try {
      const cleanup = await render(content, appState.user);
      currentCleanup = typeof cleanup === 'function' ? cleanup : null;
    } catch (err) {
      content.innerHTML = `<div class="glass-card glass p-8 text-center text-red-300">Failed to load page: ${escapeHtml(err.message)}</div>`;
    } finally {
      window.realtime?.endScope();
    }
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
  }

  const navigate = (key) => runPage(key, { push: true });

  /** Install global click + popstate interception for in-app navigation. */
  function installRouter() {
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey || e.shiftKey || a.hasAttribute('download')) return;
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('/')) return;            // external / hash → leave alone
      const key = routeOf(href);
      if (!key) return;                              // service routes / unknown → normal navigation
      e.preventDefault();
      if (key !== currentKey) navigate(key);
    });
    window.addEventListener('popstate', () => {
      const key = routeOf(location.pathname);
      if (key && key !== currentKey) runPage(key, { push: false });
    });
  }

  /** Assemble the shared chrome around a sidebar node and return the content host. */
  function buildChrome(shell, sidebar, navbar, { title, subtitle }, user) {
    const backdrop = el('<div class="sidebar-backdrop"></div>');
    const mainCol = el('<div class="main-col"></div>');
    const content = el('<main class="content fade-in"></main>');
    mainCol.appendChild(navbar);
    mainCol.appendChild(content);

    shell.appendChild(sidebar);
    shell.appendChild(backdrop);
    shell.appendChild(mainCol);

    // Page heading
    $('[data-page-title]', navbar).textContent = title || 'Dashboard';
    if (subtitle) $('[data-page-subtitle]', navbar).textContent = subtitle;

    // User info
    const initials = (user.username || '?').slice(0, 2).toUpperCase();
    $('[data-user-avatar]', navbar).textContent = initials;
    $('[data-user-name]', navbar).textContent = user.username;
    $('[data-user-role]', navbar).textContent = user.role;

    wireMenus(navbar);
    wireMobile(sidebar, backdrop);
    wireLogout();
    wireNotifications(navbar);
    wireSocketStatus(sidebar);

    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    return content;
  }

  /**
   * Entry point used by every global page module: `Layout.mount(renderFn)`.
   *
   * First call (the page the browser loaded directly) builds the persistent
   * chrome ONCE and boots the SPA router. Later calls happen when the router
   * lazy-injects another page's module — those just register the render fn so
   * the router can swap <main> without rebuilding the shell or the WebSocket.
   */
  async function mount(render) {
    // Router-driven injection: a page module loaded on demand — capture only.
    if (appState) {
      const key = loadingKey || $('.app-shell')?.dataset.page;
      if (key) {
        routeRenderers[key] = render;
        moduleWaiters[key]?.(render);
        delete moduleWaiters[key];
      }
      return;
    }

    const user = await window.auth.requireAuth();
    if (!user) return;

    const shell = $('.app-shell');
    const page = shell.dataset.page;

    // Admin-only pages: bounce non-admins back to the Marketplace home.
    if ((shell.dataset.admin === 'true' || ROUTES[page]?.admin) && !window.auth.can('admin')) {
      location.href = '/marketplace';
      return;
    }

    const [sidebarHtml, navbarHtml] = await Promise.all([
      fetchPartial('/components/sidebar.html'),
      fetchPartial('/components/navbar.html'),
    ]);

    const sidebar = el(sidebarHtml);
    const navbar = el(navbarHtml);

    // Reveal admin-only navigation for admins.
    if (window.auth.can('admin')) {
      $$('[data-admin-only]', sidebar).forEach((node) => node.classList.remove('hidden'));
    }

    const content = buildChrome(shell, sidebar, navbar, { title: shell.dataset.title, subtitle: shell.dataset.subtitle }, user);
    appState = { sidebar, navbar, content, user };
    routeRenderers[page] = render;
    installRouter();

    // Render the initial page. Known routes go through the router (so title +
    // active nav + listener scoping are consistent); an unlisted/legacy page
    // renders directly with its own dataset chrome.
    if (ROUTES[page]) {
      await runPage(page, { push: false });
    } else {
      currentKey = page;
      const active = $(`[data-nav="${page}"]`, sidebar);
      if (active) active.classList.add('active');
      window.realtime?.beginScope('page:' + page);
      try {
        const cleanup = await render(content, user);
        currentCleanup = typeof cleanup === 'function' ? cleanup : null;
      } catch (err) {
        content.innerHTML = `<div class="glass-card glass p-8 text-center text-red-300">Failed to load page: ${escapeHtml(err.message)}</div>`;
      } finally {
        window.realtime?.endScope();
      }
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    }
  }

  /**
   * Per-service shell. Resolves the service from the URL id, builds the dynamic
   * sidebar for its type, validates the requested tab against the type's page
   * manifest (redirecting to overview when the tab is not applicable), then runs
   * the tab renderer with (content, user, server, type).
   */
  async function mountService({ id, tab }) {
    const user = await window.auth.requireAuth();
    if (!user) return;

    const shell = $('.app-shell');
    const navbar = el(await fetchPartial('/components/navbar.html'));

    // Load the service-type registry + the service record.
    await window.ServiceRegistry.load();
    let server;
    try {
      server = (await api.get(`/servers/${id}`)).server;
    } catch (err) {
      const c = buildChrome(shell, window.ServiceSidebar.empty(), navbar, { title: 'Service', subtitle: '' }, user);
      c.innerHTML = `<div class="glass-card glass p-8 text-center text-red-300">${escapeHtml(err.message || 'Service not found')}</div>`;
      return;
    }

    const type = window.ServiceRegistry.typeOf(server);
    const pages = window.ServiceRegistry.pagesFor(type).map((p) => p.key);
    const labelFor = window.ServiceRegistry.labelFor(type);

    // Build the shell ONCE (sidebar + navbar + socket). Tab changes only swap
    // <main> — no document reload, no socket reconnect (SPA within the shell).
    const sidebar = window.ServiceSidebar.build({ server, type, tab });
    const content = buildChrome(shell, sidebar, navbar, { title: server.name, subtitle: labelFor }, user);
    const subtitleEl = $('[data-page-subtitle]', navbar);

    let currentCleanup = null;   // teardown of the active tab (listeners/subscriptions/xterm)

    async function renderTab(target, { push = true } = {}) {
      let next = pages.includes(target) ? target : 'overview';
      const url = `/service/${id}/${next}`;
      if (push) {
        if (location.pathname !== url) history.pushState({ tab: next }, '', url);
      } else if (next !== target) {
        history.replaceState({ tab: next }, '', url); // coerced an invalid tab → fix the URL
      }

      // Tear down the previous tab BEFORE rendering the next (one set of
      // listeners + one channel subscription at a time — no leaks/duplicates).
      if (currentCleanup) { try { currentCleanup(); } catch { /* ignore */ } currentCleanup = null; }

      $$('[data-nav]', sidebar).forEach((a) => a.classList.toggle('active', a.dataset.nav === next));
      const meta = window.ServiceRegistry.pageMeta(next);
      if (subtitleEl) subtitleEl.textContent = `${labelFor} · ${meta?.label || next}`;

      content.innerHTML = '';
      const fn = window.ServiceTabs && window.ServiceTabs[next];
      if (typeof fn !== 'function') {
        content.innerHTML = `<div class="glass glass-card p-10 text-center text-slate-400">This page isn't available for this service.</div>`;
        return;
      }
      try {
        const cleanup = await fn({ content, user, server, type });
        currentCleanup = typeof cleanup === 'function' ? cleanup : null;
      } catch (err) {
        content.innerHTML = `<div class="glass-card glass p-8 text-center text-red-300">Failed to load page: ${escapeHtml(err.message)}</div>`;
      }
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    }

    // Intercept clicks on THIS service's tab links → SPA navigate (sidebar +
    // any in-content links). Links elsewhere (/services, /marketplace, admin)
    // are left alone → normal load.
    const tabLink = new RegExp(`^/service/${id}/([^/?#]+)/?$`);
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (!a || a.target === '_blank' || e.metaKey || e.ctrlKey) return;
      const m = (a.getAttribute('href') || '').match(tabLink);
      if (m && pages.includes(m[1])) { e.preventDefault(); renderTab(m[1]); }
    });
    window.addEventListener('popstate', () => {
      const m = location.pathname.match(/^\/service\/[^/]+\/([^/?#]+)/);
      renderTab(m ? m[1] : 'overview', { push: false });
    });

    await renderTab(tab, { push: false });
  }

  function toggle(panel) {
    $$('[data-notif-panel],[data-user-panel]').forEach((p) => { if (p !== panel) p.classList.add('hidden'); });
    panel.classList.toggle('hidden');
  }

  function wireMenus(navbar) {
    const notifBtn = $('[data-notif-toggle]', navbar);
    const userBtn = $('[data-user-toggle]', navbar);
    const notifPanel = $('[data-notif-panel]', navbar);
    const userPanel = $('[data-user-panel]', navbar);

    notifBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(notifPanel); });
    userBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(userPanel); });
    document.addEventListener('click', () => { notifPanel.classList.add('hidden'); userPanel.classList.add('hidden'); });
  }

  function wireMobile(sidebar, backdrop) {
    const open = () => { sidebar.classList.add('open'); backdrop.classList.add('show'); };
    const close = () => { sidebar.classList.remove('open'); backdrop.classList.remove('show'); };
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-sidebar-toggle]')) { e.stopPropagation(); open(); }
    });
    backdrop.addEventListener('click', close);
    $$('.nav-link', sidebar).forEach((l) => l.addEventListener('click', close));
  }

  function wireLogout() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-logout]')) { e.preventDefault(); window.auth.logout(); }
    });
  }

  function wireSocketStatus(sidebar) {
    const label = $('#sb-status', sidebar);
    window.realtime?.connect();
    document.addEventListener('socket:status', (e) => {
      if (!label) return;
      label.textContent = e.detail === 'connected' ? 'Live' : 'Reconnecting…';
    });
  }

  async function wireNotifications(navbar) {
    const badge = $('[data-notif-badge]', navbar);
    const list = $('[data-notif-list]', navbar);

    const iconFor = { success: 'check-circle', error: 'x-circle', warning: 'alert-triangle', info: 'info' };

    function render(items) {
      const unread = items.filter((n) => !n.read).length;
      if (unread > 0) { badge.textContent = unread; badge.classList.remove('hidden'); }
      else badge.classList.add('hidden');

      list.innerHTML = items.length
        ? items.map((n) => `
          <div class="flex items-start gap-2 p-2 rounded-xl hover:bg-white/5 ${n.read ? 'opacity-60' : ''}">
            <i data-lucide="${iconFor[n.type] || 'info'}" class="w-4 h-4 mt-0.5 text-brand-400"></i>
            <div class="min-w-0">
              <p class="text-sm font-medium truncate">${escapeHtml(n.title)}</p>
              <p class="text-xs text-slate-400 break-words">${escapeHtml(n.message)}</p>
              <p class="text-[0.65rem] text-slate-600 mt-0.5">${fmt.relative(n.createdAt)}</p>
            </div>
          </div>`).join('')
        : '<p class="text-sm text-slate-500 text-center py-6">No notifications</p>';
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    }

    async function load() {
      try { render(await api.get('/dashboard/notifications').then((d) => d.notifications)); } catch { /* ignore */ }
    }

    $('[data-notif-readall]', navbar).addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.put('/dashboard/notifications/read-all');
      load();
    });

    document.addEventListener('notification', load);
    load();
  }

  window.Layout = { mount, mountService };
})();
