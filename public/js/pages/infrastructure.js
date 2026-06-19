/* Infrastructure (admin) — live audit of the host: Cloudflare Tunnel, ports,
   Docker, and isolation from Pterodactyl. All data is real (no fabrication);
   cloudflared changes are proposed + validated, applied only in sudo mode. */
Layout.mount(async (content) => {
  const { escapeHtml, toastSuccess, toastError, confirmDialog, modal } = ui;

  content.innerHTML = `<div id="root"><div class="glass glass-card p-10 text-center text-slate-400">Auditing infrastructure…</div></div>`;
  await load();

  async function load() {
    let a;
    try { a = await api.get('/infra/audit'); }
    catch (e) { document.getElementById('root').innerHTML = `<div class="glass glass-card p-8 text-center text-red-300">${escapeHtml(e.message)}</div>`; return; }
    document.getElementById('root').innerHTML = `
      ${tunnelSection(a.tunnel)}
      ${routesSection(a.tunnel)}
      ${portsSection(a.ports)}
      ${dockerSection(a.docker)}
      ${reservedSection(a)}`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    wire(a);
  }

  const badge = (txt, cls) => `<span class="badge ${cls}">${txt}</span>`;
  const ownerBadge = (o) => o === 'project' ? badge('project', 'badge-success') : o === 'pterodactyl' || o === 'pterodactyl/existing' ? badge('pterodactyl', 'badge-warn') : badge('system', 'badge-muted');

  function tunnelSection(t) {
    const s = t.status || {};
    return `<section class="glass glass-card p-5 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h3 class="font-bold flex items-center gap-2"><i data-lucide="cloud" class="w-5 h-5 text-brand-300"></i> Cloudflare Tunnel</h3>
        <div class="flex gap-2 items-center">
          ${s.active ? badge('<span class="dot dot-live"></span> active', 'badge-success') : badge('inactive', 'badge-danger')}
          ${s.connected ? badge('connected', 'badge-info') : ''}
          ${t.pendingChanges ? badge('pending changes', 'badge-warn') : ''}
        </div>
      </div>
      <div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
        ${kv('Tunnel ID', `<span class="font-mono text-xs break-all">${escapeHtml(s.tunnelId || '—')}</span>`)}
        ${kv('Base domain', escapeHtml(t.baseDomain || '(unset)'))}
        ${kv('Apps wildcard', t.baseDomain ? `*.${escapeHtml(t.appsSubdomain)}.${escapeHtml(t.baseDomain)}` : '—')}
        ${kv('Apply mode', badge(t.applyMode, t.applyMode === 'sudo' ? 'badge-info' : 'badge-muted'))}
      </div>
      <div class="flex flex-wrap gap-2 mt-4">
        <button id="validate" class="btn btn-sm btn-ghost"><i data-lucide="check-circle" class="w-4 h-4"></i> Validate proposal</button>
        <button id="diff" class="btn btn-sm btn-ghost"><i data-lucide="file-diff" class="w-4 h-4"></i> View diff</button>
        <button id="apply" class="btn btn-sm btn-primary" ${t.pendingChanges ? '' : 'disabled'}><i data-lucide="upload-cloud" class="w-4 h-4"></i> ${t.applyMode === 'sudo' ? 'Apply to tunnel' : 'Prepare apply'}</button>
      </div>
      <p class="text-xs text-slate-500 mt-2">Existing Pterodactyl routes are always preserved. ${t.applyMode === 'sudo' ? 'Apply validates, backs up, then reloads cloudflared (~1-2s).' : 'Propose mode never edits /etc or restarts cloudflared — it shows the exact manual steps.'}</p>
    </section>`;
  }

  function routesSection(t) {
    const rows = (t.existingRoutes || []).map((r) => `<tr>
      <td class="font-medium">${escapeHtml(r.hostname)}</td>
      <td class="font-mono text-xs text-slate-400">${escapeHtml(r.service || '—')}</td>
      <td>${ownerBadge(r.owner)}</td>
      <td class="text-right whitespace-nowrap">
        ${r.hostname !== '(catch-all)' ? `<button data-test="${escapeHtml(r.hostname)}" class="btn btn-sm btn-ghost" title="Test connectivity"><i data-lucide="radio" class="w-4 h-4"></i></button>` : ''}
        ${r.owner === 'project' ? `<button data-rmroute="${escapeHtml(r.hostname)}" class="btn btn-sm btn-ghost text-red-300" title="Remove"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
      </td></tr>`).join('');
    return `<section class="glass glass-card p-5 mb-4">
      <div class="flex items-center justify-between flex-wrap gap-3 mb-3">
        <h3 class="font-bold flex items-center gap-2"><i data-lucide="route" class="w-5 h-5 text-accent-300"></i> Ingress routes</h3>
        <button id="addroute" class="btn btn-sm btn-primary"><i data-lucide="plus" class="w-4 h-4"></i> Add route</button>
      </div>
      <div class="overflow-x-auto"><table class="table"><thead><tr><th>Hostname</th><th>Service</th><th>Owner</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
  }

  function portsSection(p) {
    const occ = (arr) => arr.length ? arr.map((n) => `<span class="badge badge-muted text-[0.6rem]">${n}</span>`).join(' ') : '<span class="text-slate-600 text-xs">none</span>';
    const allocs = (p.projectAllocations || []).map((r) => `<tr><td class="font-mono">${r.port}</td><td>${escapeHtml(r.purpose)}</td><td class="text-slate-400 text-xs">${r.serverId || '—'}</td></tr>`).join('') || '<tr><td colspan="3" class="text-slate-500 text-center py-3">No allocations.</td></tr>';
    return `<section class="glass glass-card p-5 mb-4">
      <h3 class="font-bold flex items-center gap-2 mb-3"><i data-lucide="plug" class="w-5 h-5 text-info-300"></i> Ports</h3>
      <div class="grid lg:grid-cols-2 gap-4">
        <div class="space-y-3 text-sm">
          ${kv('Project pool', `${p.pool.min}–${p.pool.max}`)}
          <div><p class="text-slate-500 text-xs mb-1">Reserved (never allocated)</p><div class="flex flex-wrap gap-1">${occ(p.reserved)}</div></div>
          <div><p class="text-slate-500 text-xs mb-1">Docker-published (incl. Wings)</p><div class="flex flex-wrap gap-1">${occ(p.occupied.docker)}</div></div>
          ${p.conflicts.length ? `<p class="text-xs text-red-300">⚠ ${p.conflicts.length} port conflict(s): ${p.conflicts.map((c) => c.port).join(', ')}</p>` : '<p class="text-xs text-emerald-300">✓ No port conflicts.</p>'}
        </div>
        <div><p class="text-slate-500 text-xs mb-1">Project allocations</p>
          <div class="overflow-x-auto max-h-48 overflow-y-auto"><table class="table"><thead><tr><th>Port</th><th>Purpose</th><th>Service</th></tr></thead><tbody>${allocs}</tbody></table></div>
        </div>
      </div>
    </section>`;
  }

  function dockerSection(d) {
    if (!d.available) return `<section class="glass glass-card p-5 mb-4"><h3 class="font-bold mb-2">Docker</h3><p class="text-amber-300 text-sm">Docker daemon not reachable.</p></section>`;
    const nets = d.networks.map((n) => `<span class="badge ${n.owner === 'project' ? 'badge-success' : n.owner === 'pterodactyl' ? 'badge-warn' : 'badge-muted'}">${escapeHtml(n.name)}</span>`).join(' ');
    const proj = d.containers.project.map((c) => `<tr><td class="font-mono text-xs">${escapeHtml(c.name)}</td><td>${escapeHtml(c.image)}</td><td>${escapeHtml(c.state)}</td><td class="text-xs">${c.ports.join(', ') || '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="text-slate-500 text-center py-3">No project containers.</td></tr>';
    return `<section class="glass glass-card p-5 mb-4">
      <h3 class="font-bold flex items-center gap-2 mb-3"><i data-lucide="container" class="w-5 h-5 text-brand-300"></i> Docker</h3>
      <div class="space-y-3 text-sm">
        <div><p class="text-slate-500 text-xs mb-1">Networks</p><div class="flex flex-wrap gap-1">${nets}</div></div>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="glass rounded-lg p-2"><p class="text-lg font-bold">${d.containers.project.length}</p><p class="text-xs text-slate-500">project</p></div>
          <div class="glass rounded-lg p-2"><p class="text-lg font-bold text-amber-300">${d.containers.pterodactyl.length}</p><p class="text-xs text-slate-500">pterodactyl (reserved)</p></div>
          <div class="glass rounded-lg p-2"><p class="text-lg font-bold">${d.containers.other}</p><p class="text-xs text-slate-500">other</p></div>
        </div>
        <div><p class="text-slate-500 text-xs mb-1">Project containers</p>
          <div class="overflow-x-auto"><table class="table"><thead><tr><th>Name</th><th>Image</th><th>State</th><th>Ports</th></tr></thead><tbody>${proj}</tbody></table></div>
        </div>
      </div>
    </section>`;
  }

  function reservedSection(a) {
    return `<section class="glass glass-card p-5 mb-4 border border-amber-500/20">
      <h3 class="font-bold flex items-center gap-2 mb-2"><i data-lucide="shield-alert" class="w-5 h-5 text-amber-300"></i> Reserved (Pterodactyl — untouched)</h3>
      <div class="grid sm:grid-cols-2 gap-3 text-sm">
        ${kv('Reserved networks', a.reserved.networks.map((n) => escapeHtml(n)).join(', '))}
        ${kv('Workspace', `<span class="font-mono text-xs">${escapeHtml(a.workspace.volumes)}</span>`)}
      </div>
      <p class="text-xs text-slate-500 mt-2">${escapeHtml(a.reserved.note)}</p>
    </section>`;
  }

  function kv(k, v) { return `<div class="glass rounded-xl p-3"><p class="text-slate-500 text-xs">${k}</p><p class="font-semibold mt-0.5 break-all">${v}</p></div>`; }

  function wire(a) {
    document.getElementById('validate')?.addEventListener('click', async () => {
      try { const r = await api.post('/infra/routes/validate'); r.ok ? toastSuccess('Proposal is valid') : toastError('Invalid: ' + r.output); }
      catch (e) { toastError(e.message); }
    });
    document.getElementById('diff')?.addEventListener('click', async () => {
      const d = await api.get('/infra/tunnel/diff');
      modal({ title: 'Proposed cloudflared config', size: 'max-w-3xl',
        body: d.changed ? `<pre class="text-xs font-mono whitespace-pre-wrap glass rounded-lg p-3 max-h-[60vh] overflow-y-auto">${escapeHtml(d.proposed)}</pre>` : '<p class="text-slate-400 text-sm">No pending changes — the proposal matches the live config.</p>',
        footer: `<button data-close class="btn btn-primary">Close</button>` });
    });
    document.getElementById('apply')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Apply tunnel routes?', message: a.tunnel.applyMode === 'sudo' ? 'Validates, backs up and reloads cloudflared (~1-2s for all tunnels). Existing Pterodactyl routes are preserved.' : 'Generates the validated config + the manual apply commands.', confirmText: 'Proceed' }))) return;
      try {
        const r = await api.post('/infra/apply');
        if (r.applied) { toastSuccess('Applied to cloudflared'); load(); }
        else modal({ title: 'Manual apply required', size: 'max-w-2xl', body: `<p class="text-sm text-slate-400 mb-3">Propose mode — run these as an operator (the panel did not touch /etc):</p><pre class="text-xs font-mono glass rounded-lg p-3">${r.manual.map(escapeHtml).join('\n')}</pre>`, footer: `<button data-close class="btn btn-primary">Close</button>` });
      } catch (e) { toastError(e.message); }
    });
    document.getElementById('addroute')?.addEventListener('click', () => openAddRoute());
    document.querySelectorAll('[data-rmroute]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Remove route?', message: b.dataset.rmroute, confirmText: 'Remove', danger: true }))) return;
      try { await api.del(`/infra/routes/${encodeURIComponent(b.dataset.rmroute)}`); toastSuccess('Removed from proposal'); load(); } catch (e) { toastError(e.message); }
    }));
    document.querySelectorAll('[data-test]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { const r = await api.post(`/infra/routes/${encodeURIComponent(b.dataset.test)}/test`); r.reachable ? toastSuccess(`${b.dataset.test} reachable (HTTP ${r.httpStatus})`) : toastError(`${b.dataset.test}: ${r.error}`); }
      catch (e) { toastError(e.message); } b.disabled = false;
    }));
  }

  function openAddRoute() {
    const m = modal({ title: 'Add ingress route', body: `
      <form id="rf" class="space-y-3">
        <div><label class="label">Hostname</label><input name="hostname" class="input" placeholder="market.voxelx.io.vn" required></div>
        <div><label class="label">Service target</label><input name="service" class="input font-mono" placeholder="http://localhost:3000" required></div>
        <p class="text-xs text-slate-500">The route is added to the <b>proposal</b> and validated. It is not live until applied. Existing Pterodactyl hostnames are protected.</p>
      </form>`,
      footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="rs" class="btn btn-primary">Add & validate</button>` });
    m.$('#rs').addEventListener('click', async () => {
      const f = m.$('#rf');
      try { const r = await api.post('/infra/routes', { hostname: f.hostname.value.trim(), service: f.service.value.trim() }); m.close(); r.validation?.ok ? toastSuccess('Route proposed & valid') : toastError('Proposed but invalid: ' + (r.validation?.output || '')); load(); }
      catch (e) { toastError(e.message); }
    });
  }
});
