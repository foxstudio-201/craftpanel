/* Users — admin user management (create, role, ban, delete, search). */
Layout.mount(async (content, me) => {
  const { escapeHtml, fmt, modal, confirmDialog, toastSuccess, toastError } = ui;
  let users = [];

  content.innerHTML = `
    <div class="glass glass-card p-4 mb-4 flex flex-wrap items-center gap-3">
      <div class="relative flex-1 min-w-[12rem]"><i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"></i><input id="q" class="input pl-9 py-2" placeholder="Search users…"></div>
      <button id="new" class="btn btn-primary"><i data-lucide="user-plus" class="w-4 h-4"></i> Create User</button>
    </div>
    <div class="glass glass-card p-0 overflow-hidden"><div class="overflow-x-auto"><table class="table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Servers</th><th>Status</th><th class="text-right">Actions</th></tr></thead><tbody id="rows"></tbody></table></div></div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  function render() {
    const q = document.getElementById('q').value.toLowerCase();
    const list = users.filter((u) => !q || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q));
    document.getElementById('rows').innerHTML = list.map((u) => `<tr data-id="${u.id}">
      <td class="font-semibold">${escapeHtml(u.username)}</td><td class="text-slate-400">${escapeHtml(u.email)}</td>
      <td><select data-role class="select w-auto py-1 text-xs ${u.id === me.id ? 'opacity-60 pointer-events-none' : ''}">${['user','moderator','admin'].map((r) => `<option ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}</select></td>
      <td>${u.serverCount}</td>
      <td>${u.banned ? '<span class="badge badge-danger">Banned</span>' : '<span class="badge badge-success">Active</span>'}</td>
      <td class="text-right whitespace-nowrap">${u.id === me.id ? '<span class="text-xs text-slate-500">you</span>' : `
        <button data-ban class="btn btn-sm btn-ghost ${u.banned ? 'text-brand-300' : 'text-amber-300'}" title="${u.banned ? 'Unban' : 'Ban'}"><i data-lucide="${u.banned ? 'shield-check' : 'ban'}" class="w-4 h-4"></i></button>
        <button data-del class="btn btn-sm btn-ghost text-red-300" title="Delete"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`}</td></tr>`).join('');
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    bind();
  }

  function bind() {
    document.querySelectorAll('[data-role]').forEach((s) => s.addEventListener('change', async () => { try { await api.put(`/admin/users/${s.closest('[data-id]').dataset.id}/role`, { role: s.value }); toastSuccess('Role updated'); } catch (e) { toastError(e.message); } }));
    document.querySelectorAll('[data-ban]').forEach((b) => b.addEventListener('click', async () => { const tr = b.closest('[data-id]'); const u = users.find((x) => x.id === tr.dataset.id); try { await api.post(`/admin/users/${u.id}/ban`, { banned: !u.banned }); toastSuccess('Updated'); load(); } catch (e) { toastError(e.message); } }));
    document.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => { if (!(await confirmDialog({ title: 'Delete user?', message: 'Their servers must be removed first.', confirmText: 'Delete', danger: true }))) return; try { await api.del(`/admin/users/${b.closest('[data-id]').dataset.id}`); toastSuccess('Deleted'); load(); } catch (e) { toastError(e.message); } }));
  }

  async function load() { users = (await api.get('/admin/users')).users; render(); }

  document.getElementById('q').addEventListener('input', render);
  document.getElementById('new').addEventListener('click', () => {
    const m = modal({ title: 'Create user', body: `
      <form id="f" class="space-y-3">
        <div><label class="label">Username</label><input name="username" class="input" required></div>
        <div><label class="label">Email</label><input name="email" type="email" class="input" required></div>
        <div><label class="label">Password</label><input name="password" type="password" class="input" minlength="8" required></div>
        <div><label class="label">Role</label><select name="role" class="select"><option>user</option><option>moderator</option><option>admin</option></select></div>
      </form>`,
      footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="s" class="btn btn-primary">Create</button>` });
    m.$('#s').addEventListener('click', async () => { try { await api.post('/admin/users', Object.fromEntries(new FormData(m.$('#f')))); m.close(); toastSuccess('User created'); load(); } catch (e) { toastError(e.message); } });
  });
  load();
});
