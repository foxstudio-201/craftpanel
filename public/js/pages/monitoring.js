/* Monitoring page — CPU, RAM, storage and network history charts. */
Layout.mount(async (content) => {
  content.innerHTML = `
    <section class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4 stagger" id="live"></section>
    <section class="grid grid-cols-1 xl:grid-cols-2 gap-4">
      ${chartCard('cpuChart', 'CPU Usage', '%')}
      ${chartCard('ramChart', 'Memory Usage', '%')}
      ${chartCard('diskChart', 'Storage Usage', '%')}
      ${chartCard('netChart', 'Network Traffic', 'Mbps')}
    </section>
    <div class="glass glass-card p-5 mt-4">
      <h3 class="font-bold mb-4">Per-server snapshot</h3>
      <div class="overflow-x-auto"><table class="table"><thead><tr><th>Server</th><th>Status</th><th>CPU</th><th>RAM</th><th>Disk</th><th>TPS</th><th>Players</th><th>Uptime</th></tr></thead><tbody id="srv-rows"></tbody></table></div>
    </div>`;
  window.lucide?.createIcons({ nameAttr: 'data-lucide' });

  const { history } = await api.get('/monitoring/history');
  const labels = history.map((h) => h.t);

  const cpuChart = charts.area(document.getElementById('cpuChart'), { labels, datasets: [{ label: 'CPU', data: history.map((h) => h.cpu), color: charts.PALETTE.brand }] });
  const ramChart = charts.area(document.getElementById('ramChart'), { labels, datasets: [{ label: 'RAM', data: history.map((h) => h.ram), color: charts.PALETTE.accent }] });
  const diskChart = charts.area(document.getElementById('diskChart'), { labels, datasets: [{ label: 'Disk', data: history.map((h) => h.disk), color: charts.PALETTE.info }] });
  const netChart = charts.area(document.getElementById('netChart'), { labels, datasets: [{ label: 'Net', data: history.map((h) => h.net), color: charts.PALETTE.warn }] });

  function renderLive(m) {
    document.getElementById('live').innerHTML = [
      ['CPU', m.cpu + '%', 'cpu', 'brand'],
      ['Memory', m.ram + '%', 'memory-stick', 'accent'],
      ['Disk', m.disk + '%', 'hard-drive', 'info'],
      ['Network', m.network.toFixed(0) + ' Mbps', 'wifi', 'warn'],
    ].map(([label, val, icon, color]) => `
      <div class="glass glass-card p-5">
        <div class="flex items-center justify-between">
          <div><p class="text-xs text-slate-500 uppercase">${label}</p><p class="text-2xl font-extrabold mt-1">${val}</p></div>
          <div class="w-10 h-10 rounded-xl grid place-items-center bg-${color}-500/15 text-${color}-300"><i data-lucide="${icon}" class="w-5 h-5"></i></div>
        </div></div>`).join('');

    document.getElementById('srv-rows').innerHTML = m.perServer.map((s) => {
      const srv = s;
      return `<tr>
        <td class="font-semibold">${nameFor(srv.serverId)}</td>
        <td>${srv.status === 'running' ? '<span class="badge badge-success">running</span>' : '<span class="badge badge-muted">stopped</span>'}</td>
        <td>${srv.cpu}%</td><td>${srv.ramPercent}%</td><td>${srv.diskPercent}%</td>
        <td class="${srv.tps >= 18 ? 'text-brand-300' : 'text-amber-300'}">${srv.tps}</td>
        <td>${srv.onlinePlayers}/${srv.maxPlayers}</td>
        <td class="text-slate-400">${ui.fmt.duration(srv.uptimeMs)}</td>
      </tr>`;
    }).join('');
    window.lucide?.createIcons({ nameAttr: 'data-lucide' });
  }

  let serverMap = {};
  const { servers } = await api.get('/servers');
  servers.forEach((s) => (serverMap[s.id] = s.name));
  const nameFor = (id) => serverMap[id] || id;

  realtime.on('metrics:overview', (m) => {
    renderLive(m);
    const t = new Date().toLocaleTimeString([], { minute: '2-digit', second: '2-digit' });
    charts.push(cpuChart, t, [m.cpu], 60);
    charts.push(ramChart, t, [m.ram], 60);
    charts.push(diskChart, t, [m.disk], 60);
    charts.push(netChart, t, [m.network], 60);
  });

  renderLive(await api.get('/monitoring/overview'));

  function chartCard(id, title, unit) {
    return `<div class="glass glass-card p-5">
      <div class="flex items-center justify-between mb-3"><h3 class="font-bold">${title}</h3><span class="badge badge-success"><span class="dot dot-live"></span> ${unit}</span></div>
      <div class="h-56"><canvas id="${id}"></canvas></div></div>`;
  }
});
