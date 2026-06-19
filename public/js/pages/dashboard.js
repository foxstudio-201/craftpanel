/* Dashboard page — overview cards, live charts and recent servers. */
Layout.mount(async (content) => {
  const { fmt, escapeHtml } = ui;

  content.innerHTML = `
    <!-- Stat cards -->
    <section class="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger" id="stat-cards">
      ${statCard('players', 'users', 'Online Players', 'brand')}
      ${statCard('servers', 'server', 'Servers Running', 'accent')}
      ${statCard('tps', 'gauge', 'Average TPS', 'info')}
      ${statCard('network', 'wifi', 'Network', 'warn')}
    </section>

    <!-- Resource gauges -->
    <section class="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
      ${gaugeCard('cpu', 'CPU Usage', 'cpu')}
      ${gaugeCard('ram', 'Memory Usage', 'memory-stick')}
      ${gaugeCard('disk', 'Disk Usage', 'hard-drive')}
    </section>

    <!-- Charts -->
    <section class="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
      <div class="glass glass-card p-5 xl:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="font-bold">Performance</h3>
            <p class="text-xs text-slate-500">CPU & memory · live</p>
          </div>
          <span class="badge badge-success"><span class="dot dot-live"></span> Live</span>
        </div>
        <div class="h-64"><canvas id="perfChart"></canvas></div>
      </div>
      <div class="glass glass-card p-5">
        <h3 class="font-bold mb-1">Network Traffic</h3>
        <p class="text-xs text-slate-500 mb-4">Mbps · live</p>
        <div class="h-64"><canvas id="netChart"></canvas></div>
      </div>
    </section>

    <!-- Recent servers + uptime -->
    <section class="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
      <div class="glass glass-card p-5 xl:col-span-2">
        <div class="flex items-center justify-between mb-4">
          <h3 class="font-bold">Your Servers</h3>
          <a href="/servers" class="text-xs text-brand-400 hover:underline">Manage all →</a>
        </div>
        <div id="server-list" class="space-y-3"></div>
      </div>
      <div class="glass glass-card p-5">
        <h3 class="font-bold mb-4">System Health</h3>
        <div id="health" class="space-y-4"></div>
      </div>
    </section>`;

  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  // ── Charts ───────────────────────────────────────────────────────
  const labels = Array.from({ length: 30 }, (_, i) => `${i}`);
  const perfChart = charts.area(document.getElementById('perfChart'), {
    labels,
    datasets: [
      { label: 'CPU', data: Array(30).fill(0), color: charts.PALETTE.brand },
      { label: 'RAM', data: Array(30).fill(0), color: charts.PALETTE.accent },
    ],
  });
  const netChart = charts.area(document.getElementById('netChart'), {
    labels,
    datasets: [{ label: 'Network', data: Array(30).fill(0), color: charts.PALETTE.info }],
  });

  // ── Initial data ─────────────────────────────────────────────────
  const data = await api.get('/dashboard');
  renderServers(data.recentServers);
  applyOverview(data.overview);

  // ── Live updates ─────────────────────────────────────────────────
  realtime.on('metrics:overview', (m) => {
    applyOverview(m);
    const t = new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' });
    charts.push(perfChart, t, [m.cpu, m.ram]);
    charts.push(netChart, t, [m.network]);
  });
  realtime.on('server:status', () => api.get('/dashboard').then((d) => renderServers(d.recentServers)));

  // ── Helpers ──────────────────────────────────────────────────────
  function applyOverview(m) {
    setStat('players', `${m.players.online}`, `of ${m.players.max} slots`);
    setStat('servers', `${m.servers.running}/${m.servers.total}`, `${m.servers.stopped} stopped`);
    setStat('tps', m.tps.toFixed(1), m.tps >= 18 ? 'Healthy' : 'Degraded');
    setStat('network', `${m.network.toFixed(0)}`, 'Mbps total');
    setGauge('cpu', m.cpu);
    setGauge('ram', m.ram);
    setGauge('disk', m.disk);
    renderHealth(m);
  }

  function renderServers(servers) {
    const list = document.getElementById('server-list');
    if (!servers.length) { list.innerHTML = `<p class="text-sm text-slate-500 text-center py-6">No servers yet.</p>`; return; }
    list.innerHTML = servers.map((s) => `
      <div class="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-white/10 transition">
        <div class="w-10 h-10 rounded-lg grid place-items-center ${s.status === 'running' ? 'bg-brand-500/20 text-brand-300' : 'bg-slate-500/20 text-slate-400'}">
          <i data-lucide="box" class="w-5 h-5"></i>
        </div>
        <div class="min-w-0 flex-1">
          <p class="font-semibold truncate">${escapeHtml(s.name)}</p>
          <p class="text-xs text-slate-500">${escapeHtml(s.type)} ${escapeHtml(s.version)}</p>
        </div>
        <div class="text-right">
          <p class="text-sm font-semibold">${s.players}/${s.maxPlayers}</p>
          <span class="badge ${s.status === 'running' ? 'badge-success' : 'badge-muted'}">${s.status}</span>
        </div>
      </div>`).join('');
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
  }

  function renderHealth(m) {
    const rows = [
      { label: 'CPU Load', val: m.cpu },
      { label: 'Memory', val: m.ram },
      { label: 'Disk', val: m.disk },
    ];
    document.getElementById('health').innerHTML = rows.map((r) => `
      <div>
        <div class="flex justify-between text-sm mb-1"><span class="text-slate-400">${r.label}</span><span class="font-semibold">${r.val.toFixed(0)}%</span></div>
        <div class="meter ${ui.meterClass(r.val)}"><span style="width:${r.val}%"></span></div>
      </div>`).join('') + `
      <div class="pt-2 flex items-center gap-2 text-sm text-slate-400">
        <i data-lucide="shield-check" class="w-4 h-4 text-brand-400"></i> All systems operational
      </div>`;
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
  }

  function setStat(key, value, sub) {
    const c = document.querySelector(`[data-stat="${key}"]`);
    if (!c) return;
    c.querySelector('[data-value]').textContent = value;
    c.querySelector('[data-sub]').textContent = sub;
  }
  function setGauge(key, val) {
    const c = document.querySelector(`[data-gauge="${key}"]`);
    if (!c) return;
    c.querySelector('[data-value]').textContent = val.toFixed(0) + '%';
    const bar = c.querySelector('.meter');
    bar.className = 'meter ' + ui.meterClass(val);
    bar.querySelector('span').style.width = val + '%';
  }

  function statCard(key, icon, label, color) {
    return `
      <div class="glass glass-card p-5" data-stat="${key}">
        <div class="flex items-start justify-between">
          <div>
            <p class="text-xs text-slate-500 uppercase tracking-wide">${label}</p>
            <p class="text-3xl font-extrabold mt-1" data-value>—</p>
            <p class="text-xs text-slate-500 mt-1" data-sub>loading…</p>
          </div>
          <div class="w-11 h-11 rounded-xl grid place-items-center bg-${color}-500/15 text-${color}-300">
            <i data-lucide="${icon}" class="w-6 h-6"></i>
          </div>
        </div>
      </div>`;
  }
  function gaugeCard(key, label, icon) {
    return `
      <div class="glass glass-card p-5" data-gauge="${key}">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2"><i data-lucide="${icon}" class="w-5 h-5 text-slate-400"></i><h3 class="font-semibold text-sm">${label}</h3></div>
          <span class="text-xl font-bold" data-value>—</span>
        </div>
        <div class="meter"><span style="width:0%"></span></div>
      </div>`;
  }
});
