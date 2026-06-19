/* Admin Dashboard — users, all servers, infrastructure, logs, announcements. */
Layout.mount(async (content, user) => {
  const { escapeHtml, fmt, confirmDialog, modal, toastSuccess, toastError } = ui;

  if (!auth.can('admin')) {
    content.innerHTML = `<div class="glass glass-card p-10 text-center"><i data-lucide="lock" class="w-10 h-10 mx-auto text-red-300 mb-3"></i><p class="font-bold text-lg">Admin access required</p><p class="text-slate-400">You do not have permission to view this page.</p></div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    return;
  }

  content.innerHTML = `
    <div class="flex gap-1 glass rounded-xl p-1 mb-4 overflow-x-auto" id="tabs">
      ${[['overview','gauge','Overview'],['users','users','Users'],['servers','server','Servers'],['infra','network','Infrastructure'],['queue','list-checks','Queue'],['activity','scroll-text','Activity'],['system','terminal','System logs'],['announce','megaphone','Announcements']]
        .map(([k,i,l],idx) => `<button data-tab="${k}" class="btn btn-sm ${idx===0?'btn-primary':'btn-ghost'} whitespace-nowrap"><i data-lucide="${i}" class="w-4 h-4"></i> ${l}</button>`).join('')}
    </div>
    <div id="panel"></div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  let tab = 'overview';
  const panel = document.getElementById('panel');
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('#tabs [data-tab]').forEach((x) => x.className = 'btn btn-sm whitespace-nowrap ' + (x === b ? 'btn-primary' : 'btn-ghost') );
    render();
  }));
  render();

  async function render() {
    panel.innerHTML = `<div class="glass glass-card p-10 text-center text-slate-500">Loading…</div>`;
    try { await PANELS[tab](); } catch (e) { panel.innerHTML = `<div class="glass glass-card p-6 text-red-300">${escapeHtml(e.message)}</div>`; }
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
  }

  const stat = (label, val, icon, color) => `<div class="glass glass-card p-5"><div class="flex items-start justify-between"><div><p class="text-xs text-slate-500 uppercase">${label}</p><p class="text-2xl font-extrabold mt-1">${val}</p></div><div class="w-10 h-10 rounded-xl grid place-items-center bg-${color}-500/15 text-${color}-300"><i data-lucide="${icon}" class="w-5 h-5"></i></div></div></div>`;
  const meter = (label, pct) => `<div><div class="flex justify-between text-sm mb-1"><span class="text-slate-400">${label}</span><span class="font-semibold">${pct}%</span></div><div class="meter ${ui.meterClass(pct)}"><span style="width:${pct}%"></span></div></div>`;

  const PANELS = {
    async overview() {
      const d = await api.get('/admin/overview');
      panel.innerHTML = `
        <section class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4 stagger">
          ${stat('Users', d.counts.users, 'users', 'brand')}
          ${stat('Servers', d.counts.servers, 'server', 'accent')}
          ${stat('Running', d.counts.running, 'play', 'info')}
          ${stat('Suspended', d.counts.suspended, 'pause', 'warn')}
        </section>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div class="glass glass-card p-5"><h3 class="font-bold mb-4">Node: ${escapeHtml(d.node.name)}</h3>
            <div class="space-y-3">${meter('CPU load', d.node.cpu.loadPercent)}${meter('Memory', d.node.memory.percent)}${meter('Disk', d.node.disk.percent)}</div>
            <p class="text-xs text-slate-500 mt-4">${escapeHtml(d.node.platform)} · ${d.node.cpu.cores} cores · ${escapeHtml(d.node.cpu.model)}</p>
            <p class="text-xs text-slate-500 mt-1">Allocated: ${d.node.allocated.cpu} cores · ${(d.node.allocated.ramMb/1024).toFixed(1)}GB RAM · ${d.node.allocated.servers} servers</p>
          </div>
          <div class="glass glass-card p-5"><h3 class="font-bold mb-4">Recent activity</h3>
            <div class="space-y-2 text-sm">${d.recentActivity.map((a) => `<div class="flex justify-between gap-2"><span><span class="badge badge-muted">${a.action}</span> ${escapeHtml(a.actor)}</span><span class="text-slate-500">${fmt.relative(a.createdAt)}</span></div>`).join('') || '<p class="text-slate-500">No activity yet.</p>'}</div>
          </div>
        </div>`;
    },

    async users() {
      const { users } = await api.get('/admin/users');
      panel.innerHTML = `<div class="glass glass-card p-0 overflow-hidden"><div class="overflow-x-auto"><table class="table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Servers</th><th>Status</th><th class="text-right">Actions</th></tr></thead><tbody>
        ${users.map((u) => `<tr data-id="${u.id}">
          <td class="font-semibold">${escapeHtml(u.username)}</td><td class="text-slate-400">${escapeHtml(u.email)}</td>
          <td><select data-role class="select w-auto py-1 text-xs ${u.id===user.id?'opacity-60 pointer-events-none':''}">${['user','moderator','admin'].map((r)=>`<option ${r===u.role?'selected':''}>${r}</option>`).join('')}</select></td>
          <td>${u.serverCount}</td>
          <td>${u.banned?'<span class="badge badge-danger">Banned</span>':'<span class="badge badge-success">Active</span>'}</td>
          <td class="text-right whitespace-nowrap">${u.id===user.id?'<span class="text-xs text-slate-500">you</span>':`
            <button data-ban class="btn btn-sm btn-ghost ${u.banned?'text-brand-300':'text-amber-300'}"><i data-lucide="${u.banned?'shield-check':'ban'}" class="w-4 h-4"></i></button>
            <button data-del class="btn btn-sm btn-ghost text-red-300"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`}</td></tr>`).join('')}
      </tbody></table></div></div>`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      panel.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', async () => { try { await api.put(`/admin/users/${s.closest('[data-id]').dataset.id}/role`, { role: s.value }); toastSuccess('Role updated'); } catch (e) { toastError(e.message); } }));
      panel.querySelectorAll('[data-ban]').forEach((b) => b.addEventListener('click', async () => { const tr = b.closest('[data-id]'); const banned = !b.querySelector('i').getAttribute('data-lucide').includes('check'); try { await api.post(`/admin/users/${tr.dataset.id}/ban`, { banned }); toastSuccess('Updated'); render(); } catch (e) { toastError(e.message); } }));
      panel.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmDialog({ title: 'Delete user?', message: 'Their servers must be removed first.', confirmText: 'Delete', danger: true }))) return; try { await api.del(`/admin/users/${b.closest('[data-id]').dataset.id}`); toastSuccess('Deleted'); render(); } catch (e) { toastError(e.message); } }));
    },

    async servers() {
      const [{ servers }, { users }] = await Promise.all([api.get('/admin/servers'), api.get('/admin/users')]);
      panel.innerHTML = `<div class="glass glass-card p-0 overflow-hidden"><div class="overflow-x-auto"><table class="table"><thead><tr><th>Server</th><th>Owner</th><th>Software</th><th>State</th><th>Port</th><th class="text-right">Actions</th></tr></thead><tbody>
        ${servers.map((s) => `<tr data-id="${s.id}">
          <td class="font-semibold">${escapeHtml(s.name)}</td><td class="text-slate-400">${escapeHtml(s.owner)}</td>
          <td>${escapeHtml(s.softwareLabel)} ${escapeHtml(s.version)}</td>
          <td>${s.suspended?'<span class="badge badge-danger">suspended</span>':s.state==='running'?'<span class="badge badge-success">running</span>':'<span class="badge badge-muted">stopped</span>'}</td>
          <td>${s.allocation.port}</td>
          <td class="text-right whitespace-nowrap">
            <button data-suspend class="btn btn-sm btn-ghost text-amber-300" title="Suspend/Unsuspend"><i data-lucide="pause-circle" class="w-4 h-4"></i></button>
            <button data-transfer class="btn btn-sm btn-ghost" title="Transfer"><i data-lucide="arrow-right-left" class="w-4 h-4"></i></button>
            <button data-del class="btn btn-sm btn-ghost text-red-300" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button></td></tr>`).join('') || '<tr><td colspan="6" class="text-center text-slate-500 py-8">No servers.</td></tr>'}
      </tbody></table></div></div>`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      panel.querySelectorAll('[data-suspend]').forEach((b) => b.addEventListener('click', async () => { const id = b.closest('[data-id]').dataset.id; const s = servers.find((x) => x.id === id); try { await api.post(`/servers/${id}/suspend`, { suspended: !s.suspended }); toastSuccess('Updated'); render(); } catch (e) { toastError(e.message); } }));
      panel.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmDialog({ title: 'Delete server?', message: 'Removes container + volume.', confirmText: 'Delete', danger: true }))) return; try { await api.del(`/servers/${b.closest('[data-id]').dataset.id}`); toastSuccess('Deleted'); render(); } catch (e) { toastError(e.message); } }));
      panel.querySelectorAll('[data-transfer]').forEach((b) => b.addEventListener('click', () => {
        const id = b.closest('[data-id]').dataset.id;
        const m = modal({ title: 'Transfer ownership', body: `<label class="label">New owner</label><select id="own" class="select">${users.map((u) => `<option value="${u.id}">${escapeHtml(u.username)}</option>`).join('')}</select>`, footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="t" class="btn btn-primary">Transfer</button>` });
        m.$('#t').addEventListener('click', async () => { try { await api.post(`/admin/servers/${id}/transfer`, { ownerId: m.$('#own').value }); m.close(); toastSuccess('Transferred'); render(); } catch (e) { toastError(e.message); } });
      }));
    },

    async infra() {
      const d = await api.get('/admin/infra');
      const dk = d.docker;
      panel.innerHTML = `
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div class="glass glass-card p-5"><h3 class="font-bold mb-3 flex items-center gap-2"><i data-lucide="server" class="w-4 h-4"></i> Node</h3>
            <div class="space-y-3">${meter('CPU', d.node.cpu.loadPercent)}${meter('Memory', d.node.memory.percent)}${meter('Disk', d.node.disk.percent)}</div>
            <p class="text-xs text-slate-500 mt-3">${escapeHtml(d.node.platform)} · uptime ${fmt.duration(d.node.uptimeSec*1000)}</p></div>
          <div class="glass glass-card p-5"><h3 class="font-bold mb-3 flex items-center gap-2"><i data-lucide="container" class="w-4 h-4"></i> Docker</h3>
            ${dk.available!==false?`<p class="text-sm"><span class="badge badge-success">online</span> v${dk.serverVersion}</p>
            <div class="text-sm text-slate-400 mt-3 space-y-1"><div>Containers: ${dk.containers} (${dk.containersRunning} running)</div><div>Managed: ${dk.managed?.length||0}</div><div>Images: ${dk.images}</div><div>Driver: ${dk.driver}</div></div>`
            :`<p class="text-sm text-red-300">${escapeHtml(dk.message||'unavailable')}</p>`}</div>
          <div class="glass glass-card p-5"><h3 class="font-bold mb-3 flex items-center gap-2"><i data-lucide="network" class="w-4 h-4"></i> Network & SFTP</h3>
            <div class="text-sm space-y-1">
              <div class="flex justify-between"><span class="text-slate-500">Public IP</span><span>${d.network.publicIp||'—'}</span></div>
              <div class="flex justify-between"><span class="text-slate-500">Internal IP</span><span>${d.network.internalIp}</span></div>
              <div class="flex justify-between"><span class="text-slate-500">Domain</span><span>${d.network.domain||'—'}</span></div>
              <div class="flex justify-between"><span class="text-slate-500">SFTP</span><span class="badge ${d.sftp.status==='online'?'badge-success':'badge-muted'}">${d.sftp.host}:${d.sftp.port}</span></div>
              <div class="flex justify-between"><span class="text-slate-500">Port pool</span><span>${d.ports.range}</span></div>
            </div></div>
        </div>
        <div class="glass glass-card p-5 mt-4"><h3 class="font-bold mb-3">Allocated ports</h3>
          <div class="overflow-x-auto"><table class="table"><thead><tr><th>Server</th><th>IP</th><th>Port</th><th>Software</th></tr></thead><tbody>
          ${d.ports.allocated.map((a) => `<tr><td>${escapeHtml(a.server)}</td><td>${a.ip}</td><td>${a.port}</td><td>${a.software}</td></tr>`).join('') || '<tr><td colspan="4" class="text-center text-slate-500 py-6">No allocations.</td></tr>'}
          </tbody></table></div></div>`;
    },

    async queue() {
      const { stats, jobs } = await api.get('/admin/queue');
      panel.innerHTML = `
        <section class="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4 stagger">
          ${stat('Driver', stats.driver, 'cpu', 'brand')}
          ${stat('Queued', stats.queued, 'clock', 'info')}
          ${stat('Running', stats.running, 'loader', 'warn')}
          ${stat('Completed', stats.completed, 'check', 'brand')}
          ${stat('Failed', stats.failed, 'x', 'accent')}
        </section>
        <div class="glass glass-card p-0 overflow-hidden"><div class="overflow-x-auto"><table class="table"><thead><tr><th>Type</th><th>Status</th><th>Actor</th><th>Created</th><th>Error</th></tr></thead><tbody>
          ${jobs.map((j) => `<tr><td><span class="badge badge-muted">${j.type}</span></td>
            <td><span class="badge ${j.status === 'completed' ? 'badge-success' : j.status === 'failed' ? 'badge-danger' : j.status === 'running' ? 'badge-warn' : 'badge-info'}">${j.status}</span></td>
            <td>${escapeHtml(j.actor)}</td><td class="text-slate-500">${fmt.relative(j.createdAt)}</td><td class="text-red-300 text-xs">${escapeHtml(j.error || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-500 py-8">No jobs yet.</td></tr>'}
        </tbody></table></div></div>`;
    },

    async activity() {
      const { logs } = await api.get('/admin/activity?limit=200');
      panel.innerHTML = `<div class="glass glass-card p-0 overflow-hidden"><div class="overflow-x-auto"><table class="table"><thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>IP</th><th>When</th></tr></thead><tbody>
        ${logs.map((a) => `<tr><td><span class="badge badge-muted">${a.action}</span></td><td>${escapeHtml(a.actor)}</td><td class="text-slate-400">${escapeHtml(a.target||'—')}</td><td class="text-slate-500">${a.ip||'—'}</td><td class="text-slate-500">${fmt.relative(a.createdAt)}</td></tr>`).join('') || '<tr><td colspan="5" class="text-center text-slate-500 py-8">No activity.</td></tr>'}
      </tbody></table></div></div>`;
    },

    async system() {
      const { logs } = await api.get('/admin/system-logs?limit=300');
      panel.innerHTML = `<div class="glass glass-card p-4"><div class="console" style="height:65vh">${logs.map((l) => `<div class="log-${l.level==='OK'?'INFO':l.level}"><span class="log-time">${fmt.time(l.ts)}</span><span class="opacity-60">[${l.level}]</span> ${escapeHtml(l.message)}</div>`).join('')}</div></div>`;
    },

    async announce() {
      const { announcements } = await api.get('/admin/announcements');
      panel.innerHTML = `
        <div class="glass glass-card p-5 mb-4"><h3 class="font-bold mb-3">Broadcast announcement</h3>
          <form id="af" class="grid sm:grid-cols-4 gap-3 items-end">
            <div class="sm:col-span-1"><label class="label">Type</label><select name="type" class="select"><option>info</option><option>success</option><option>warning</option><option>error</option></select></div>
            <div class="sm:col-span-1"><label class="label">Title</label><input name="title" class="input" required></div>
            <div class="sm:col-span-2"><label class="label">Message</label><input name="message" class="input" required></div>
            <div class="sm:col-span-4"><button class="btn btn-primary"><i data-lucide="megaphone" class="w-4 h-4"></i> Broadcast to all users</button></div>
          </form></div>
        <div class="space-y-2">${announcements.map((a) => `<div class="glass glass-card p-4 flex items-start justify-between gap-3"><div><p class="font-semibold">${escapeHtml(a.title)} <span class="badge badge-${a.type==='error'?'danger':a.type==='warning'?'warn':a.type==='success'?'success':'info'}">${a.type}</span></p><p class="text-sm text-slate-400">${escapeHtml(a.message)}</p><p class="text-xs text-slate-600 mt-1">by ${escapeHtml(a.author)} · ${fmt.relative(a.createdAt)}</p></div><button data-del="${a.id}" class="btn btn-sm btn-ghost text-red-300"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>`).join('') || '<p class="text-slate-500 text-sm">No announcements.</p>'}</div>`;
      window.lucide?.createIcons({ nameAttr: 'data-lucide' });
      panel.querySelector('#af').addEventListener('submit', async (e) => { e.preventDefault(); const body = Object.fromEntries(new FormData(e.target)); try { await api.post('/admin/announcements', body); toastSuccess('Broadcast sent'); render(); } catch (err) { toastError(err.message); } });
      panel.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { try { await api.del(`/admin/announcements/${b.dataset.del}`); render(); } catch (e) { toastError(e.message); } }));
    },
  };
});
