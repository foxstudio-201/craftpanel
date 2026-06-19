/* Players — real RCON moderation + whitelist/ban lists from server files. */
Layout.mount(async (content) => {
  const { escapeHtml, confirmDialog, toastSuccess, toastError } = ui;

  const { servers } = await api.get('/servers');
  if (!servers.length) { content.innerHTML = `<div class="glass glass-card p-10 text-center text-slate-500">No servers yet.</div>`; return; }
  let current = servers[0].id, tab = 'all', search = '', players = [];

  content.innerHTML = `
    <div class="glass glass-card p-4 mb-4 flex flex-wrap items-center gap-3">
      <select id="srv" class="select w-auto min-w-[12rem]">${servers.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join('')}</select>
      <div class="flex gap-1 glass rounded-xl p-1" id="tabs">${['all', 'online', 'banned', 'whitelist'].map((t) => `<button data-tab="${t}" class="btn btn-sm ${t === 'all' ? 'btn-primary' : 'btn-ghost'} capitalize">${t}</button>`).join('')}</div>
      <div class="ml-auto flex gap-2">
        <input id="pname" class="input py-2 w-40" placeholder="player name">
        <button id="ban-name" class="btn btn-sm btn-danger">Ban</button>
        <button id="wl-name" class="btn btn-sm btn-ghost">Whitelist</button>
      </div>
    </div>
    <div class="glass glass-card p-0 overflow-hidden">
      <div class="overflow-x-auto"><table class="table"><thead><tr><th>Player</th><th>Status</th><th>Roles</th><th class="text-right">Actions</th></tr></thead><tbody id="rows"></tbody></table></div>
    </div>
    <p class="text-xs text-slate-500 mt-3">Moderation runs as real RCON commands — the server must be running.</p>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  async function load() {
    try { const d = await api.get(`/players?serverId=${current}`); players = d.players; render(); }
    catch (e) { toastError(e.message); }
  }

  function render() {
    let list = players.slice();
    if (tab === 'online') list = list.filter((p) => p.online);
    if (tab === 'banned') list = list.filter((p) => p.banned);
    if (tab === 'whitelist') list = list.filter((p) => p.whitelisted);
    if (search) list = list.filter((p) => p.name.toLowerCase().includes(search));
    const rows = document.getElementById('rows');
    if (!list.length) { rows.innerHTML = `<tr><td colspan="4" class="text-center text-slate-500 py-8">No players.</td></tr>`; return; }
    rows.innerHTML = list.map((p) => `
      <tr data-name="${escapeHtml(p.name)}">
        <td><div class="flex items-center gap-2"><span class="w-8 h-8 rounded-lg grid place-items-center text-xs font-bold bg-gradient-to-br from-brand-500/40 to-accent-500/40">${escapeHtml(p.name.slice(0,2).toUpperCase())}</span>${escapeHtml(p.name)}</div></td>
        <td>${p.banned ? '<span class="badge badge-danger">Banned</span>' : p.online ? '<span class="badge badge-success"><span class="dot dot-live"></span> Online</span>' : '<span class="badge badge-muted">Offline</span>'}</td>
        <td>${p.op ? '<span class="badge badge-info">OP</span> ' : ''}${p.whitelisted ? '<span class="badge badge-muted">WL</span>' : ''}</td>
        <td class="text-right whitespace-nowrap">
          ${p.online ? `<button data-act="kick" class="btn btn-sm btn-ghost" title="Kick"><i data-lucide="log-out" class="w-4 h-4"></i></button>` : ''}
          ${p.banned ? `<button data-act="unban" class="btn btn-sm btn-ghost" title="Unban"><i data-lucide="shield-check" class="w-4 h-4"></i></button>` : `<button data-act="ban" class="btn btn-sm btn-ghost text-red-300" title="Ban"><i data-lucide="ban" class="w-4 h-4"></i></button>`}
          <button data-act="${p.whitelisted ? 'whitelist-remove' : 'whitelist-add'}" class="btn btn-sm btn-ghost" title="Whitelist"><i data-lucide="${p.whitelisted ? 'user-minus' : 'user-plus'}" class="w-4 h-4"></i></button>
          <button data-act="${p.op ? 'deop' : 'op'}" class="btn btn-sm btn-ghost" title="OP"><i data-lucide="crown" class="w-4 h-4"></i></button>
        </td></tr>`).join('');
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    rows.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => act(b.closest('[data-name]').dataset.name, b.dataset.act)));
  }

  async function act(name, action) {
    if (action === 'ban' && !(await confirmDialog({ title: 'Ban player?', message: `Ban ${name}?`, confirmText: 'Ban', danger: true }))) return;
    try { await api.post(`/players/${current}/${action}`, { name }); toastSuccess('Done'); load(); }
    catch (e) { toastError(e.message); }
  }

  document.getElementById('srv').addEventListener('change', (e) => { current = e.target.value; load(); });
  document.getElementById('ban-name').addEventListener('click', () => { const n = document.getElementById('pname').value.trim(); if (n) act(n, 'ban'); });
  document.getElementById('wl-name').addEventListener('click', () => { const n = document.getElementById('pname').value.trim(); if (n) act(n, 'whitelist-add'); });
  document.querySelectorAll('#tabs [data-tab]').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; document.querySelectorAll('#tabs [data-tab]').forEach((x) => x.className = 'btn btn-sm capitalize ' + (x === b ? 'btn-primary' : 'btn-ghost')); render(); }));
  realtime.on('players:update', load);
  load();
});
