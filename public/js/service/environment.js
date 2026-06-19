/* Environment tab — real env-var CRUD (GET/PUT /servers/:id/env). Saving
   recreates the container so the new variables take effect. For Discord bots,
   first-class quick-add for the bot token, git repo and auto-update. */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  // Suggested first-class variables per service type.
  const SUGGEST = {
    discord: [
      { key: 'DISCORD_TOKEN', label: 'Bot token', secret: true, placeholder: 'paste your bot token' },
      { key: 'GIT_ADDRESS', label: 'Git repository', placeholder: 'https://github.com/user/repo.git' },
      { key: 'AUTO_UPDATE', label: 'Auto-update (1/0)', placeholder: '1' },
    ],
    node: [{ key: 'MAIN_FILE', label: 'Entry file' }, { key: 'NODE_PACKAGES', label: 'npm packages' }],
    python: [{ key: 'PY_FILE', label: 'Entry file' }, { key: 'PY_PACKAGES', label: 'pip packages' }, { key: 'REQUIREMENTS_FILE', label: 'requirements.txt' }],
    static: [{ key: 'BUILD_CMD', label: 'Build command' }, { key: 'SERVE_DIR', label: 'Serve directory' }],
  };

  window.ServiceTabs.environment = async function ({ content, server, type }) {
    const { escapeHtml, modal, confirmDialog, toastSuccess, toastError } = ui;
    const id = server.id;

    let env = {};
    try { env = (await api.get(`/servers/${id}/env`)).env || {}; }
    catch (e) { content.innerHTML = `<div class="glass glass-card p-8 text-center text-slate-400">${escapeHtml(e.message)}</div>`; return; }

    const suggestions = (SUGGEST[type] || []).filter((s) => !(s.key in env));

    content.innerHTML = `
      <div class="glass glass-card p-5">
        <div class="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div><h3 class="font-bold">Environment variables</h3><p class="text-xs text-slate-500">Applied to the container on save (recreates it; data preserved).</p></div>
          <div class="flex gap-2">
            <button id="add" class="btn btn-sm btn-ghost"><i data-lucide="plus" class="w-4 h-4"></i> Add variable</button>
            <button id="save" class="btn btn-sm btn-primary"><i data-lucide="save" class="w-4 h-4"></i> Save & apply</button>
          </div>
        </div>
        ${suggestions.length ? `<div class="flex flex-wrap gap-2 mb-4">${suggestions.map((s) => `<button data-suggest="${escapeHtml(s.key)}" class="badge badge-info hover:opacity-80"><i data-lucide="plus" class="w-3 h-3"></i> ${escapeHtml(s.label)}</button>`).join('')}</div>` : ''}
        <div id="rows" class="space-y-2"></div>
      </div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    const meta = Object.fromEntries((SUGGEST[type] || []).map((s) => [s.key, s]));

    function renderRows() {
      const keys = Object.keys(env);
      const rows = document.getElementById('rows');
      rows.innerHTML = keys.length ? keys.map((k) => {
        const secret = meta[k]?.secret;
        return `<div class="flex gap-2 items-center" data-k="${escapeHtml(k)}">
          <input class="input py-1.5 text-xs font-mono w-1/3" value="${escapeHtml(k)}" data-key>
          <input class="input py-1.5 text-xs flex-1" type="${secret ? 'password' : 'text'}" value="${escapeHtml(env[k] ?? '')}" data-val placeholder="${escapeHtml(meta[k]?.placeholder || '')}">
          <button data-rm class="btn btn-sm btn-ghost text-red-300"><i data-lucide="x" class="w-4 h-4"></i></button>
        </div>`;
      }).join('') : '<p class="text-xs text-slate-500">No variables yet — add one above.</p>';
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      rows.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { syncFromInputs(); delete env[b.closest('[data-k]').dataset.k]; renderRows(); }));
    }

    function syncFromInputs() {
      const next = {};
      document.querySelectorAll('#rows [data-k]').forEach((row) => { const k = row.querySelector('[data-key]').value.trim(); const v = row.querySelector('[data-val]').value; if (k) next[k] = v; });
      env = next;
    }

    document.getElementById('add').addEventListener('click', () => { syncFromInputs(); env['NEW_VAR'] = ''; renderRows(); });
    document.querySelectorAll('[data-suggest]').forEach((b) => b.addEventListener('click', () => { syncFromInputs(); env[b.dataset.suggest] = ''; renderRows(); b.remove(); }));
    document.getElementById('save').addEventListener('click', async () => {
      syncFromInputs();
      if (!(await confirmDialog({ title: 'Apply environment?', message: 'The container will be recreated to apply the new variables.', confirmText: 'Apply' }))) return;
      try { const r = await api.put(`/servers/${id}/env`, { env }); env = r.env || env; renderRows(); toastSuccess('Environment updated & container recreated'); }
      catch (e) { toastError(e.message); }
    });

    renderRows();
  };
})();
