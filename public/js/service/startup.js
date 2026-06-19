/* Startup tab — runtime configuration. Minecraft exposes itzg TYPE/VERSION +
   server.properties; app services expose the editable STARTUP command, a runtime
   version selector and resource limits. Saving recreates the container. */
(function () {
  window.ServiceTabs = window.ServiceTabs || {};

  window.ServiceTabs.startup = async function ({ content, server, type }) {
    const { escapeHtml, confirmDialog, toastSuccess, toastError } = ui;
    const id = server.id;
    const row = (k, v) => `<div class="flex justify-between gap-2"><span class="text-slate-500">${k}</span><span class="text-right break-all">${v}</span></div>`;

    const c = await api.get(`/servers/${id}/startup`);

    if (c.serviceType === 'minecraft') {
      content.innerHTML = `
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
              ${limitsBlock(c)}
              <button class="btn btn-primary"><i data-lucide="save" class="w-4 h-4"></i> Save & recreate container</button>
            </form>
          </div>
          <div class="glass glass-card p-5">
            <h3 class="font-bold mb-3">Image & runtime</h3>
            <div class="text-sm space-y-2">
              ${row('Software', escapeHtml(c.softwareLabel || ''))}
              ${row('Docker image', `<span class="font-mono text-xs">${escapeHtml(c.dockerImage)}</span>`)}
              ${row('Java', escapeHtml(c.java))}
              ${row('Startup', `<span class="text-xs text-slate-400">${escapeHtml(c.startupCommand)}</span>`)}
            </div>
          </div>
        </div>`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!(await confirmDialog({ title: 'Apply startup changes?', message: 'The container will be recreated (data preserved).', confirmText: 'Apply' }))) return;
        const fd = Object.fromEntries(new FormData(e.target));
        const body = {
          version: fd.version, maxPlayers: Number(fd.maxPlayers), motd: fd.motd, difficulty: fd.difficulty,
          gamemode: fd.gamemode, onlineMode: fd.onlineMode === 'true',
          limits: { cpu: Number(fd.cpu), ramMb: Number(fd.ramMb), diskMb: Number(fd.diskMb) },
        };
        try { await api.put(`/servers/${id}/startup`, body); toastSuccess('Startup updated & container recreated'); }
        catch (err) { toastError(err.message); }
      });
      return;
    }

    // ── App services (Discord/Node/Python/Static) ──
    const versions = c.versions || [];
    content.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div class="glass glass-card p-5 lg:col-span-2">
          <h3 class="font-bold mb-4">Startup command</h3>
          <form id="f" class="space-y-4">
            <div><label class="label">Command (run by the container entrypoint)</label><textarea name="startup" class="textarea font-mono text-xs" rows="4">${escapeHtml(c.startupCommand || '')}</textarea></div>
            ${versions.length ? `<div><label class="label">Runtime version</label><select name="version" class="select">${versions.map((v) => `<option value="${v.key}" ${v.key === c.version ? 'selected' : ''}>${escapeHtml(v.label)}</option>`).join('')}</select></div>` : ''}
            ${limitsBlock(c)}
            <button class="btn btn-primary"><i data-lucide="save" class="w-4 h-4"></i> Save & recreate container</button>
          </form>
        </div>
        <div class="glass glass-card p-5">
          <h3 class="font-bold mb-3">Runtime</h3>
          <div class="text-sm space-y-2">
            ${row('Template', escapeHtml(c.template || '—'))}
            ${row('Docker image', `<span class="font-mono text-xs break-all">${escapeHtml(c.dockerImage)}</span>`)}
            ${c.packages ? row('Packages', `<span class="badge badge-muted">${escapeHtml(c.packages)}</span>`) : ''}
          </div>
          <p class="text-xs text-slate-500 mt-3">Manage variables on the <a href="/service/${id}/environment" class="text-brand-400 hover:underline">Environment</a> page.</p>
        </div>
      </div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    document.getElementById('f').addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!(await confirmDialog({ title: 'Apply startup changes?', message: 'The container will be recreated (data preserved).', confirmText: 'Apply' }))) return;
      const fd = Object.fromEntries(new FormData(e.target));
      const body = { startup: fd.startup, limits: { cpu: Number(fd.cpu), ramMb: Number(fd.ramMb), diskMb: Number(fd.diskMb) } };
      if (fd.version) body.version = fd.version;
      try { await api.put(`/servers/${id}/startup`, body); toastSuccess('Startup updated & container recreated'); }
      catch (err) { toastError(err.message); }
    });

    function limitsBlock() {
      return `<div class="grid sm:grid-cols-3 gap-4">
        <div><label class="label">CPU cores</label><input name="cpu" type="number" step="0.5" class="input" value="${c.limits.cpu}"></div>
        <div><label class="label">RAM (MB)</label><input name="ramMb" type="number" class="input" value="${c.limits.ramMb}"></div>
        <div><label class="label">Disk (MB)</label><input name="diskMb" type="number" class="input" value="${c.limits.diskMb}"></div>
      </div>`;
    }
  };
})();
