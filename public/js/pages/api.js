/* API page — key generation, scopes, rate limits, usage monitoring & docs. */
Layout.mount(async (content) => {
  const { escapeHtml, fmt, modal, confirmDialog, toastSuccess, toastError } = ui;
  const { scopes } = await api.get('/apikeys/scopes');
  const docs = await api.get('/v1');

  content.innerHTML = `
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div class="xl:col-span-2 space-y-4">
        <div class="glass glass-card p-5">
          <div class="flex items-center justify-between mb-4"><h3 class="font-bold">Your API keys</h3><button id="new" class="btn btn-sm btn-primary"><i data-lucide="plus" class="w-4 h-4"></i> Create key</button></div>
          <div class="overflow-x-auto"><table class="table"><thead><tr><th>Name</th><th>Prefix</th><th>Scopes</th><th>Requests</th><th>Last used</th><th></th></tr></thead><tbody id="keys"></tbody></table></div>
        </div>
      </div>
      <div class="glass glass-card p-5 h-fit">
        <h3 class="font-bold mb-3 flex items-center gap-2"><i data-lucide="book-open" class="w-4 h-4"></i> API v1 documentation</h3>
        <p class="text-sm text-slate-400 mb-2">${escapeHtml(docs.auth)}</p>
        <p class="text-xs text-slate-500 mb-3">Base URL: <code>${location.origin}/api/v1</code></p>
        <div class="space-y-2 text-sm">
          ${docs.endpoints.map((e) => `<div class="glass rounded-lg p-2"><span class="badge ${e.method==='GET'?'badge-info':'badge-warn'}">${e.method}</span> <code class="text-xs">${e.path}</code><p class="text-xs text-slate-500 mt-1">${escapeHtml(e.desc)} · scope <code>${e.scope}</code></p></div>`).join('')}
        </div>
      </div>
    </div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  async function load() {
    const { keys } = await api.get('/apikeys');
    document.getElementById('keys').innerHTML = keys.length ? keys.map((k) => `
      <tr data-id="${k.id}">
        <td class="font-semibold">${escapeHtml(k.name)}</td>
        <td class="font-mono text-xs">${k.prefix}…</td>
        <td>${k.scopes.map((s) => `<span class="badge badge-muted">${s}</span>`).join(' ')}</td>
        <td>${fmt.num(k.requests)} <span class="text-xs text-slate-500">(${k.rateLimit}/min)</span></td>
        <td class="text-slate-400">${k.lastUsedAt ? fmt.relative(k.lastUsedAt) : 'never'}</td>
        <td class="text-right"><button data-revoke class="btn btn-sm btn-ghost text-red-300"><i data-lucide="trash-2" class="w-4 h-4"></i></button></td>
      </tr>`).join('') : `<tr><td colspan="6" class="text-center text-slate-500 py-8">No API keys yet.</td></tr>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    document.querySelectorAll('#keys [data-revoke]').forEach((b) => b.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: 'Revoke key?', message: 'Applications using it will stop working immediately.', confirmText: 'Revoke', danger: true }))) return;
      try { await api.del(`/apikeys/${b.closest('[data-id]').dataset.id}`); toastSuccess('Revoked'); load(); } catch (e) { toastError(e.message); }
    }));
  }

  document.getElementById('new').addEventListener('click', () => {
    const m = modal({ title: 'Create API key', body: `
      <form id="kf" class="space-y-3">
        <div><label class="label">Name</label><input name="name" class="input" placeholder="My integration" required></div>
        <div><label class="label">Rate limit (requests / minute)</label><input name="rateLimit" type="number" class="input" value="120"></div>
        <div><label class="label">Scopes</label><div class="space-y-2">${scopes.map((s) => `<label class="flex items-center gap-2 glass rounded-lg p-2 cursor-pointer"><input type="checkbox" value="${s}" class="accent-brand-500" ${s==='servers.read'?'checked':''}> <code class="text-xs">${s}</code></label>`).join('')}</div></div>
      </form>`,
      footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="create" class="btn btn-primary">Create</button>` });
    m.$('#create').addEventListener('click', async () => {
      const form = m.$('#kf');
      const scopesSel = [...form.querySelectorAll('input[type=checkbox]:checked')].map((c) => c.value);
      try {
        const r = await api.post('/apikeys', { name: form.name.value, rateLimit: Number(form.rateLimit.value), scopes: scopesSel });
        m.close();
        showSecret(r.secret);
        load();
      } catch (e) { toastError(e.message); }
    });
  });

  function showSecret(secret) {
    const m = modal({ title: 'API key created', body: `
      <p class="text-sm text-amber-300 mb-3"><i data-lucide="alert-triangle" class="w-4 h-4 inline"></i> Copy this secret now — it will not be shown again.</p>
      <div class="flex gap-2"><input class="input font-mono text-xs" value="${escapeHtml(secret)}" readonly id="sec"><button id="copy" class="btn btn-ghost"><i data-lucide="copy" class="w-4 h-4"></i></button></div>`,
      footer: `<button data-close class="btn btn-primary">Done</button>` });
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
    m.$('#copy').addEventListener('click', () => { navigator.clipboard.writeText(secret); toastSuccess('Copied'); });
  }

  load();
});
