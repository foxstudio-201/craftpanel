/* Settings page — general, security, appearance, notifications & API. */
Layout.mount(async (content) => {
  const { escapeHtml, toastSuccess, toastError } = ui;
  const canAdmin = auth.can('admin');

  const { settings } = await api.get('/settings');
  let tab = 'general';

  content.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <aside class="glass glass-card p-3 h-fit">
        <nav id="tabs" class="space-y-1">
          ${[['general','sliders-horizontal','General'],['security','shield','Security'],['appearance','palette','Appearance'],['notifications','bell','Notifications'],['api','key-round','API']]
            .map(([k,i,l]) => `<button data-tab="${k}" class="nav-link w-full ${k==='general'?'active':''}"><i data-lucide="${i}" class="w-5 h-5"></i> ${l}</button>`).join('')}
        </nav>
        ${canAdmin ? '' : '<p class="text-xs text-amber-300/80 mt-3 px-2">Read-only — admin role required to save.</p>'}
      </aside>
      <section id="panel" class="glass glass-card p-6 lg:col-span-3"></section>
    </div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  const panels = {
    general: () => form('general', [
      field('panelName', 'Panel name', 'text', settings.general.panelName),
      select('language', 'Language', settings.general.language, [['en','English'],['es','Spanish'],['fr','French'],['de','German']]),
      field('timezone', 'Timezone', 'text', settings.general.timezone),
      select('defaultServerType', 'Default server software', settings.general.defaultServerType, ['Paper','Spigot','Purpur','Vanilla','Fabric'].map((x) => [x,x])),
    ]),
    security: () => form('security', [
      toggle('twoFactorRequired', 'Require two-factor authentication', settings.security.twoFactorRequired),
      field('sessionTimeoutMins', 'Session timeout (minutes)', 'number', settings.security.sessionTimeoutMins),
      field('passwordMinLength', 'Minimum password length', 'number', settings.security.passwordMinLength),
      field('ipWhitelist', 'IP whitelist (comma separated)', 'text', settings.security.ipWhitelist),
    ]),
    appearance: () => form('appearance', [
      select('theme', 'Theme', settings.appearance.theme, [['dark','Dark'],['light','Light (coming soon)']]),
      select('accent', 'Accent colour', settings.appearance.accent, [['emerald','Emerald'],['violet','Violet'],['sky','Sky'],['amber','Amber']]),
      toggle('glass', 'Glassmorphism effects', settings.appearance.glass),
      toggle('animations', 'Animations', settings.appearance.animations),
    ]),
    notifications: () => form('notifications', [
      toggle('email', 'Email notifications', settings.notifications.email),
      toggle('browser', 'Browser notifications', settings.notifications.browser),
      toggle('serverDown', 'Alert when a server goes down', settings.notifications.serverDown),
      toggle('highCpu', 'Alert on high CPU usage', settings.notifications.highCpu),
      toggle('newLogin', 'Alert on new login', settings.notifications.newLogin),
    ]),
    api: () => `
      <h3 class="font-bold text-lg mb-1">API access</h3>
      <p class="text-sm text-slate-400 mb-5">Manage personal API keys, scopes and rate limits on the dedicated API page.</p>
      <div class="space-y-4">
        ${toggle('enabled', 'Enable API access', settings.api.enabled)}
        ${field('rateLimit', 'Default rate limit (requests / minute)', 'number', settings.api.rateLimit)}
        <a href="/api-keys" class="btn btn-accent"><i data-lucide="key-round" class="w-4 h-4"></i> Manage API keys &amp; docs</a>
        ${canAdmin ? saveBtn() : ''}
      </div>`,
  };

  function renderPanel() {
    const panel = document.getElementById('panel');
    panel.innerHTML = typeof panels[tab] === 'function' ? panels[tab]() : '';
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    if (!canAdmin) panel.querySelectorAll('input,select,button[data-save],#regen').forEach((el) => { if (el.id !== 'copy') el.setAttribute('disabled', ''); });
    wire();
  }

  function wire() {
    const panel = document.getElementById('panel');
    panel.querySelector('[data-save]')?.addEventListener('click', async () => {
      const body = {};
      panel.querySelectorAll('[data-key]').forEach((el) => {
        body[el.dataset.key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
      });
      try { await api.put(`/settings/${tab}`, body); Object.assign(settings[tab], body); toastSuccess('Settings saved'); }
      catch (e) { toastError(e.message); }
    });
    panel.querySelector('#copy')?.addEventListener('click', () => {
      navigator.clipboard.writeText(document.getElementById('apikey').value); toastSuccess('Copied to clipboard');
    });
    panel.querySelector('#regen')?.addEventListener('click', async () => {
      try { const { key } = await api.post('/settings/api/regenerate'); settings.api.key = key; document.getElementById('apikey').value = key; toastSuccess('API key regenerated'); }
      catch (e) { toastError(e.message); }
    });
  }

  // tab switching
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('#tabs [data-tab]').forEach((x) => x.classList.toggle('active', x === b));
    renderPanel();
  }));
  renderPanel();

  // ── tiny form builders ───────────────────────────────────────────
  function form(section, fields) {
    const title = { general:'General', security:'Security', appearance:'Appearance', notifications:'Notifications' }[section];
    return `<h3 class="font-bold text-lg mb-5">${title} settings</h3><div class="space-y-4">${fields.join('')}${canAdmin ? saveBtn() : ''}</div>`;
  }
  function field(key, label, type, value) {
    return `<div><label class="label">${label}</label><input data-key="${key}" type="${type}" class="input" value="${escapeHtml(value ?? '')}"></div>`;
  }
  function select(key, label, value, options) {
    return `<div><label class="label">${label}</label><select data-key="${key}" class="select">${options.map(([v,l]) => `<option value="${v}" ${v===value?'selected':''}>${l}</option>`).join('')}</select></div>`;
  }
  function toggle(key, label, checked) {
    return `<label class="flex items-center justify-between gap-3 glass rounded-xl p-3 cursor-pointer">
      <span class="text-sm">${label}</span>
      <input data-key="${key}" type="checkbox" class="w-5 h-5 accent-brand-500" ${checked ? 'checked' : ''}></label>`;
  }
  function saveBtn() { return `<div class="pt-2"><button data-save class="btn btn-primary"><i data-lucide="save" class="w-4 h-4"></i> Save changes</button></div>`; }
});
