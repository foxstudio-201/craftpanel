/* Startup — runtime configuration; saving recreates the container. */
Layout.mount(async (content) => {
  const { escapeHtml, modal, confirmDialog, toastSuccess, toastError } = ui;
  const { servers } = await api.get('/servers');
  if (!servers.length) { content.innerHTML = `<div class="glass glass-card p-10 text-center text-slate-500">No servers yet.</div>`; return; }
  let current = servers[0].id;

  content.innerHTML = `
    <div class="glass glass-card p-4 mb-4 flex items-center gap-3">
      <select id="srv" class="select w-auto min-w-[12rem]">${servers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select>
    </div>
    <div id="root"></div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  async function load() {
    const c = await api.get(`/servers/${current}/startup`);
    document.getElementById('root').innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="glass glass-card p-5 lg:col-span-2">
          <h3 class="font-bold mb-4">Runtime configuration</h3>
          <form id="f" class="space-y-4">
            <div class="grid sm:grid-cols-2 gap-4">
              <div><label class="label">Version</label><input name="version" class="input" value="${escapeHtml(c.version)}"></div>
              <div><label class="label">Max players</label><input name="maxPlayers" type="number" class="input" value="${c.maxPlayers}"></div>
            </div>
            <div><label class="label">MOTD</label><input name="motd" class="input" value="${escapeHtml(c.motd || '')}"></div>
            <div class="grid sm:grid-cols-3 gap-4">
              <div><label class="label">Difficulty</label><select name="difficulty" class="select">${['peaceful','easy','normal','hard'].map((d) => `<option ${d === c.difficulty ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
              <div><label class="label">Gamemode</label><select name="gamemode" class="select">${['survival','creative','adventure','spectator'].map((d) => `<option ${d === c.gamemode ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
              <div><label class="label">Online mode</label><select name="onlineMode" class="select"><option value="true" ${c.onlineMode ? 'selected' : ''}>true</option><option value="false" ${!c.onlineMode ? 'selected' : ''}>false</option></select></div>
            </div>
            <div class="grid sm:grid-cols-3 gap-4">
              <div><label class="label">CPU cores</label><input name="cpu" type="number" step="0.5" class="input" value="${c.limits.cpu}"></div>
              <div><label class="label">RAM (MB)</label><input name="ramMb" type="number" class="input" value="${c.limits.ramMb}"></div>
              <div><label class="label">Disk (MB)</label><input name="diskMb" type="number" class="input" value="${c.limits.diskMb}"></div>
            </div>
            <button class="btn btn-primary"><i data-lucide="save" class="w-4 h-4"></i> Save & recreate container</button>
          </form>
        </div>
        <div class="glass glass-card p-5">
          <h3 class="font-bold mb-3">Image & runtime</h3>
          <div class="text-sm space-y-2">
            ${row('Software', `${escapeHtml(c.softwareLabel)} `)}
            ${row('Docker image', `<span class="font-mono text-xs">${escapeHtml(c.dockerImage)}</span>`)}
            ${row('Java', escapeHtml(c.java))}
            ${row('Startup', `<span class="text-xs text-slate-400">${escapeHtml(c.startupCommand)}</span>`)}
          </div>
          <h3 class="font-bold mt-5 mb-3">Environment variables</h3>
          <div id="envlist" class="space-y-2"></div>
          <button id="add-env" class="btn btn-sm btn-ghost mt-3"><i data-lucide="plus" class="w-4 h-4"></i> Add variable</button>
        </div>
      </div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    let env = { ...(c.env || {}) };
    const renderEnv = () => {
      const wrap = document.getElementById('envlist');
      const keys = Object.keys(env);
      wrap.innerHTML = keys.length ? keys.map((k) => `<div class="flex gap-2 items-center" data-k="${escapeHtml(k)}"><input class="input py-1 text-xs font-mono" value="${escapeHtml(k)}" data-key><input class="input py-1 text-xs" value="${escapeHtml(env[k])}" data-val><button data-rm class="btn btn-sm btn-ghost text-red-300"><i data-lucide="x" class="w-4 h-4"></i></button></div>`).join('') : '<p class="text-xs text-slate-500">No custom variables.</p>';
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      wrap.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => { delete env[b.closest('[data-k]').dataset.k]; renderEnv(); }));
    };
    renderEnv();
    document.getElementById('add-env').addEventListener('click', () => { env['NEW_VAR_' + Object.keys(env).length] = ''; renderEnv(); });

    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!(await confirmDialog({ title: 'Apply startup changes?', message: 'The container will be recreated (world/data preserved).', confirmText: 'Apply' }))) return;
      const fd = Object.fromEntries(new FormData(e.target));
      // collect env from inputs
      const newEnv = {};
      document.querySelectorAll('#envlist [data-k]').forEach((row) => { const k = row.querySelector('[data-key]').value.trim(); const v = row.querySelector('[data-val]').value; if (k) newEnv[k] = v; });
      const body = {
        version: fd.version, maxPlayers: Number(fd.maxPlayers), motd: fd.motd, difficulty: fd.difficulty,
        gamemode: fd.gamemode, onlineMode: fd.onlineMode === 'true',
        limits: { cpu: Number(fd.cpu), ramMb: Number(fd.ramMb), diskMb: Number(fd.diskMb) }, env: newEnv,
      };
      try { await api.put(`/servers/${current}/startup`, body); toastSuccess('Startup updated & container recreated'); }
      catch (err) { toastError(err.message); }
    });
  }

  const row = (k, v) => `<div class="flex justify-between gap-2"><span class="text-slate-500">${k}</span><span class="text-right break-all">${v}</span></div>`;
  document.getElementById('srv').addEventListener('change', (e) => { current = e.target.value; load(); });
  load();
});
