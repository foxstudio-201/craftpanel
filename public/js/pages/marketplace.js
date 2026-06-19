/* Marketplace — the user home. Real deployment for every service.
 *   Minecraft  → /servers (full installer)         | admin only
 *   Database   → /databases (engine provisioning)   | admin only
 *   Discord / Node / Python / Static → inline deploy modal → POST /servers
 * Deploy is admin-only (RBAC); users see their services but cannot provision. */
Layout.mount(async (content, user) => {
  const { escapeHtml, modal, toastInfo, toastSuccess, toastError } = ui;
  const canAdmin = auth.can('admin');

  // Live generic service catalog (discord/node/python/static) from the backend.
  const { services } = await api.get('/servers/meta/services');
  const byKey = Object.fromEntries(services.map((s) => [s.key, s]));

  const CARDS = [
    { key: 'minecraft', name: 'Minecraft Server Hosting', icon: 'box', color: 'brand', kind: 'route', target: '/servers',
      desc: 'Vanilla, Paper, Purpur, Spigot, Fabric, Forge, NeoForge, Velocity & Waterfall.', res: '2 vCPU · 2–8 GB RAM', templates: ['Paper', 'Purpur', 'Fabric', 'Forge'] },
    { key: 'discord', name: 'Discord Bot Hosting', icon: 'bot', color: 'info', kind: 'service',
      desc: byKey.discord?.description, res: '1 vCPU · 512 MB–1 GB RAM', templates: ['Node.js', 'Python'] },
    { key: 'node', name: 'Node.js Hosting', icon: 'hexagon', color: 'brand', kind: 'service',
      desc: byKey.node?.description, res: '1 vCPU · 1 GB RAM', templates: ['Express', 'Fastify', 'NestJS'] },
    { key: 'python', name: 'Python Hosting', icon: 'code', color: 'warn', kind: 'service',
      desc: byKey.python?.description, res: '1 vCPU · 1 GB RAM', templates: ['Flask', 'FastAPI', 'Django'] },
    { key: 'static', name: 'Static Website Hosting', icon: 'globe', color: 'info', kind: 'service',
      desc: byKey.static?.description, res: '0.5 vCPU · 256 MB RAM', templates: ['HTML', 'React', 'Vue'] },
    { key: 'database', name: 'Database Hosting', icon: 'database', color: 'accent', kind: 'route', target: '/databases',
      desc: 'Managed MySQL, MariaDB and PostgreSQL instances.', res: '1 vCPU · 1 GB RAM', templates: ['PostgreSQL', 'MySQL', 'MariaDB'] },
  ];

  content.innerHTML = `
    <div class="glass glass-card p-6 mb-5 flex items-center gap-4 flex-wrap">
      <div class="w-12 h-12 rounded-xl grid place-items-center bg-gradient-to-br from-brand-500 to-accent-500 shadow-glow"><i data-lucide="rocket" class="w-6 h-6 text-white"></i></div>
      <div class="flex-1 min-w-[12rem]"><h2 class="font-bold text-lg">Welcome back, ${escapeHtml(user.username)}</h2><p class="text-sm text-slate-400">${canAdmin ? 'Choose a service to deploy.' : 'Browse services — ask an administrator to provision one for you.'}</p></div>
      <span class="badge ${canAdmin ? 'badge-info' : 'badge-muted'}">${canAdmin ? 'Administrator' : 'User'}</span>
    </div>
    <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger">${CARDS.map(card).join('')}</div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  content.querySelectorAll('[data-deploy]').forEach((b) => b.addEventListener('click', () => {
    const c = CARDS.find((x) => x.key === b.dataset.deploy);
    if (!canAdmin) return toastInfo('Only administrators can provision services. Contact your admin.');
    if (c.kind === 'route') location.href = c.target;
    else openServiceDeploy(c);
  }));

  function card(c) {
    return `<div class="glass glass-card p-5 flex flex-col">
      <div class="flex items-center gap-3">
        <div class="w-12 h-12 rounded-xl grid place-items-center bg-${c.color}-500/15 text-${c.color}-300"><i data-lucide="${c.icon}" class="w-6 h-6"></i></div>
        <div><p class="font-bold leading-tight">${escapeHtml(c.name)}</p><span class="badge badge-success text-[0.6rem]">Available</span></div>
      </div>
      <p class="text-sm text-slate-400 mt-3 flex-1">${escapeHtml(c.desc || '')}</p>
      <div class="text-xs text-slate-500 mt-3 flex items-center gap-2"><i data-lucide="cpu" class="w-3.5 h-3.5"></i> ${escapeHtml(c.res)}</div>
      <div class="flex flex-wrap gap-1 mt-2">${c.templates.map((t) => `<span class="badge badge-muted text-[0.6rem]">${escapeHtml(t)}</span>`).join('')}</div>
      <button data-deploy="${c.key}" class="btn ${canAdmin ? 'btn-primary' : 'btn-ghost'} w-full mt-4"><i data-lucide="rocket" class="w-4 h-4"></i> Deploy</button>
    </div>`;
  }

  // ── Generic service deploy modal (real container) ─────────────────
  async function openServiceDeploy(card) {
    const svc = byKey[card.key];
    const users = await api.get('/admin/users').then((d) => d.users).catch(() => []);
    const tplLabel = card.key === 'discord' ? 'Language' : 'Template';

    const m = modal({
      title: `Deploy ${card.name}`, size: 'max-w-2xl',
      body: `
        <form id="sf" class="space-y-3">
          <div class="grid sm:grid-cols-2 gap-3">
            <div><label class="label">Name</label><input name="name" class="input" placeholder="my-${card.key}" required></div>
            <div><label class="label">Owner</label><select name="ownerId" class="select">${users.map((u) => `<option value="${u.id}" ${u.id === user.id ? 'selected' : ''}>${escapeHtml(u.username)}</option>`).join('')}</select></div>
          </div>
          <div><label class="label">Description</label><input name="description" class="input" placeholder="Optional description"></div>
          <div class="grid sm:grid-cols-2 gap-3">
            <div><label class="label">${tplLabel}</label><select name="template" id="tpl" class="select">${svc.templates.map((t) => `<option value="${t.key}">${t.label}</option>`).join('')}</select></div>
            <div><label class="label">Docker image</label><input id="img" class="input text-xs" readonly></div>
          </div>
          <div class="grid grid-cols-3 gap-3">
            <div><label class="label">CPU cores</label><input name="cpu" type="number" step="0.5" class="input" value="1"></div>
            <div><label class="label">RAM (MB)</label><input name="ramMb" type="number" class="input" value="1024"></div>
            <div><label class="label">Disk (MB)</label><input name="diskMb" type="number" class="input" value="5120"></div>
          </div>
          <div><label class="label">Environment variables</label><div id="envs" class="grid sm:grid-cols-2 gap-2"></div></div>
          <div><label class="label">Startup command (template default — applied verbatim)</label><textarea id="startup" class="textarea font-mono text-[0.7rem]" rows="3" readonly></textarea></div>
        </form>`,
      footer: `<button data-close class="btn btn-ghost">Cancel</button><button id="go" class="btn btn-primary"><i data-lucide="rocket" class="w-4 h-4"></i> Deploy container</button>`,
    });
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });

    const tplSel = m.$('#tpl');
    const renderTpl = () => {
      const t = svc.templates.find((x) => x.key === tplSel.value) || svc.templates[0];
      m.$('#img').value = t.image;
      m.$('#startup').value = t.startup;
      m.$('#envs').innerHTML = (t.envSchema || []).map((k) => `<div><label class="text-xs text-slate-500">${escapeHtml(k)}</label><input data-env="${escapeHtml(k)}" class="input py-1.5 text-xs" value="${escapeHtml(t.env?.[k] ?? '')}"></div>`).join('') || '<p class="text-xs text-slate-500">No variables.</p>';
    };
    tplSel.addEventListener('change', renderTpl); renderTpl();

    m.$('#go').addEventListener('click', async () => {
      const f = m.$('#sf');
      const env = {};
      m.root.querySelectorAll('[data-env]').forEach((i) => { env[i.dataset.env] = i.value; });
      const body = {
        serviceType: card.key, template: tplSel.value,
        name: f.name.value, description: f.description.value, ownerId: f.ownerId.value,
        cpu: Number(f.cpu.value), ramMb: Number(f.ramMb.value), diskMb: Number(f.diskMb.value),
        env,
      };
      if (!body.name) return toastError('Name is required');
      const btn = m.$('#go'); btn.disabled = true; btn.innerHTML = 'Deploying…';
      try {
        await api.post('/servers', body);
        m.close();
        toastSuccess(`${card.name} deployed — assigned to ${users.find((u) => u.id === body.ownerId)?.username}`);
      } catch (e) { toastError(e.message); btn.disabled = false; btn.innerHTML = 'Deploy container'; }
    });
  }
});
