/* Builds the authenticated app shell: injects the sidebar + navbar partials,
   wires navigation, the user menu, notifications and mobile behaviour.

   A page opts in by including:
     <div class="app-shell" data-page="dashboard" data-title="Dashboard" data-subtitle="…"></div>
   and calling Layout.mount(renderFn). */
(function () {
  const { $, $$, el, fmt, escapeHtml } = window.ui;

  async function fetchPartial(path) {
    const res = await fetch(path);
    return res.text();
  }

  async function mount(render) {
    const user = await window.auth.requireAuth();
    if (!user) return;

    const shell = $('.app-shell');
    const page = shell.dataset.page;

    // Admin-only pages: bounce non-admins back to the Marketplace home.
    if (shell.dataset.admin === 'true' && !window.auth.can('admin')) {
      location.href = '/marketplace';
      return;
    }

    const [sidebarHtml, navbarHtml] = await Promise.all([
      fetchPartial('/components/sidebar.html'),
      fetchPartial('/components/navbar.html'),
    ]);

    const sidebar = el(sidebarHtml);
    const navbar = el(navbarHtml);
    const backdrop = el('<div class="sidebar-backdrop"></div>');

    const mainCol = el('<div class="main-col"></div>');
    const content = el('<main class="content fade-in"></main>');
    mainCol.appendChild(navbar);
    mainCol.appendChild(content);

    shell.appendChild(sidebar);
    shell.appendChild(backdrop);
    shell.appendChild(mainCol);

    // Active nav link
    const active = $(`[data-nav="${page}"]`, sidebar);
    if (active) active.classList.add('active');

    // Page heading
    $('[data-page-title]', navbar).textContent = shell.dataset.title || 'Dashboard';
    if (shell.dataset.subtitle) $('[data-page-subtitle]', navbar).textContent = shell.dataset.subtitle;

    // User info
    const initials = (user.username || '?').slice(0, 2).toUpperCase();
    $('[data-user-avatar]', navbar).textContent = initials;
    $('[data-user-name]', navbar).textContent = user.username;
    $('[data-user-role]', navbar).textContent = user.role;

    // Reveal admin-only navigation for admins.
    if (window.auth.can('admin')) {
      $$('[data-admin-only]', sidebar).forEach((el) => el.classList.remove('hidden'));
    }

    wireMenus(navbar);
    wireMobile(sidebar, backdrop);
    wireLogout();
    wireNotifications(navbar);
    wireSocketStatus(sidebar);

    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    // Render the page body
    try {
      await render(content, user);
    } catch (err) {
      content.innerHTML = `<div class="glass-card glass p-8 text-center text-red-300">Failed to load page: ${escapeHtml(err.message)}</div>`;
    }
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
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

  window.Layout = { mount };
})();
