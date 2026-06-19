/* Profile page — account details, password, 2FA and (admin) user management. */
Layout.mount(async (content, user) => {
  const { escapeHtml, fmt, confirmDialog, toastSuccess, toastError } = ui;
  const canAdmin = auth.can('admin');

  content.innerHTML = `
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- Identity card -->
      <div class="glass glass-card p-6 text-center">
        <div class="w-24 h-24 rounded-2xl mx-auto grid place-items-center text-3xl font-extrabold bg-gradient-to-br from-brand-500 to-accent-500 shadow-glow text-black">${escapeHtml(user.username.slice(0,2).toUpperCase())}</div>
        <h2 class="text-xl font-bold mt-4">${escapeHtml(user.username)}</h2>
        <p class="text-slate-400 text-sm">${escapeHtml(user.email)}</p>
        <span class="badge ${user.role==='admin'?'badge-info':user.role==='moderator'?'badge-warn':'badge-muted'} mt-3 capitalize">${user.role}</span>
        <div class="grid grid-cols-2 gap-3 mt-6 text-left">
          <div class="glass rounded-xl p-3"><p class="text-xs text-slate-500">Joined</p><p class="font-semibold text-sm">${fmt.relative(user.createdAt)}</p></div>
          <div class="glass rounded-xl p-3"><p class="text-xs text-slate-500">Last login</p><p class="font-semibold text-sm">${fmt.relative(user.lastLogin)}</p></div>
        </div>
      </div>

      <!-- Edit forms -->
      <div class="lg:col-span-2 space-y-4">
        <div class="glass glass-card p-6">
          <h3 class="font-bold mb-4">Edit profile</h3>
          <form id="pf" class="space-y-4">
            <div class="grid sm:grid-cols-2 gap-4">
              <div><label class="label">Username</label><input name="username" class="input" value="${escapeHtml(user.username)}"></div>
              <div><label class="label">Email</label><input name="email" type="email" class="input" value="${escapeHtml(user.email)}"></div>
            </div>
            <div><label class="label">Bio</label><textarea name="bio" class="textarea" rows="3">${escapeHtml(user.bio || '')}</textarea></div>
            <label class="flex items-center justify-between gap-3 glass rounded-xl p-3 cursor-pointer">
              <span class="text-sm">Two-factor authentication</span>
              <input name="twoFactor" type="checkbox" class="w-5 h-5 accent-brand-500" ${user.twoFactor ? 'checked' : ''}></label>
            <button class="btn btn-primary"><i data-lucide="save" class="w-4 h-4"></i> Save profile</button>
          </form>
        </div>

        <div class="glass glass-card p-6">
          <h3 class="font-bold mb-4">Change password</h3>
          <form id="pw" class="space-y-4">
            <div><label class="label">Current password</label><input name="currentPassword" type="password" class="input" required></div>
            <div class="grid sm:grid-cols-2 gap-4">
              <div><label class="label">New password</label><input name="newPassword" type="password" class="input" minlength="8" required></div>
              <div><label class="label">Confirm</label><input name="confirm" type="password" class="input" minlength="8" required></div>
            </div>
            <button class="btn btn-accent"><i data-lucide="key-round" class="w-4 h-4"></i> Update password</button>
          </form>
        </div>
      </div>
    </div>
    ${canAdmin ? `<div class="glass glass-card p-6 mt-4">
      <h3 class="font-bold mb-4">User management</h3>
      <div class="overflow-x-auto"><table class="table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Joined</th><th class="text-right">Actions</th></tr></thead><tbody id="users"></tbody></table></div>
    </div>` : ''}`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  document.getElementById('pf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    data.twoFactor = e.target.twoFactor.checked;
    try { await api.put('/users/profile', data); toastSuccess('Profile updated'); }
    catch (err) { toastError(err.message); }
  });

  document.getElementById('pw').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    if (data.newPassword !== data.confirm) return toastError('Passwords do not match');
    try { await api.put('/users/password', { currentPassword: data.currentPassword, newPassword: data.newPassword }); toastSuccess('Password updated'); e.target.reset(); }
    catch (err) { toastError(err.message); }
  });

  if (canAdmin) loadUsers();

  async function loadUsers() {
    const { users } = await api.get('/users');
    document.getElementById('users').innerHTML = users.map((u) => `
      <tr data-id="${u.id}">
        <td class="font-semibold">${escapeHtml(u.username)}</td>
        <td class="text-slate-400">${escapeHtml(u.email)}</td>
        <td>
          <select data-role class="select w-auto py-1 text-xs ${u.id===user.id?'opacity-60 pointer-events-none':''}">
            ${['user','moderator','admin'].map((r) => `<option ${r===u.role?'selected':''}>${r}</option>`).join('')}
          </select>
        </td>
        <td class="text-slate-400">${fmt.relative(u.createdAt)}</td>
        <td class="text-right">${u.id===user.id?'<span class="text-xs text-slate-500">you</span>':`<button data-del class="btn btn-sm btn-ghost text-red-300"><i data-lucide="trash-2" class="w-4 h-4"></i></button>`}</td>
      </tr>`).join('');
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    document.querySelectorAll('#users [data-role]').forEach((sel) => sel.addEventListener('change', async () => {
      const id = sel.closest('[data-id]').dataset.id;
      try { await api.put(`/users/${id}/role`, { role: sel.value }); toastSuccess('Role updated'); }
      catch (e) { toastError(e.message); }
    }));
    document.querySelectorAll('#users [data-del]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.closest('[data-id]').dataset.id;
      if (!(await confirmDialog({ title: 'Delete user?', message: 'This permanently removes the account.', confirmText: 'Delete', danger: true }))) return;
      try { await api.del(`/users/${id}`); toastSuccess('User deleted'); loadUsers(); }
      catch (e) { toastError(e.message); }
    }));
  }
});
