/* Chart.js helpers with the gaming/glass theme baked in. */
(function () {
  const PALETTE = {
    brand: '#10b981',
    brand2: '#34d399',
    accent: '#8b5cf6',
    info: '#38bdf8',
    warn: '#f59e0b',
    danger: '#ef4444',
  };

  function gradient(ctx, color) {
    const g = ctx.createLinearGradient(0, 0, 0, 220);
    g.addColorStop(0, color + '66');
    g.addColorStop(1, color + '00');
    return g;
  }

  const baseOptions = () => ({
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 600, easing: 'easeOutQuart' },
    interaction: { intersect: false, mode: 'index' },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: 'rgba(10,12,20,0.92)',
        borderColor: 'rgba(255,255,255,0.1)',
        borderWidth: 1,
        padding: 10,
        titleColor: '#e7ebf3',
        bodyColor: '#9aa4bd',
        cornerRadius: 10,
      },
    },
    scales: {
      x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5b6685', maxTicksLimit: 6 } },
      y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#5b6685' }, beginAtZero: true },
    },
  });

  /** Smooth area line chart. */
  function area(canvas, { labels = [], datasets = [] } = {}) {
    const ctx = canvas.getContext('2d');
    const ds = datasets.map((d) => ({
      label: d.label,
      data: d.data,
      borderColor: d.color,
      backgroundColor: d.fill === false ? 'transparent' : gradient(ctx, d.color),
      fill: d.fill !== false,
      tension: 0.4,
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 4,
      pointHoverBackgroundColor: d.color,
    }));
    return new Chart(ctx, { type: 'line', data: { labels, datasets: ds }, options: baseOptions() });
  }

  /** Doughnut gauge for a single percentage. */
  function gauge(canvas, value, color = PALETTE.brand) {
    return new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Used', 'Free'],
        datasets: [{
          data: [value, 100 - value],
          backgroundColor: [color, 'rgba(255,255,255,0.06)'],
          borderWidth: 0,
          circumference: 360,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '78%',
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
  }

  function bar(canvas, { labels = [], data = [], color = PALETTE.accent } = {}) {
    const ctx = canvas.getContext('2d');
    return new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: gradient(ctx, color), borderColor: color, borderWidth: 1.5, borderRadius: 8, maxBarThickness: 26 }] },
      options: baseOptions(),
    });
  }

  /** Push a point onto a live chart, capping length. */
  function push(chart, label, values, max = 30) {
    chart.data.labels.push(label);
    values.forEach((v, i) => chart.data.datasets[i].data.push(v));
    if (chart.data.labels.length > max) {
      chart.data.labels.shift();
      chart.data.datasets.forEach((d) => d.data.shift());
    }
    chart.update('none');
  }

  if (window.Chart) {
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.color = '#9aa4bd';
  }

  window.charts = { area, gauge, bar, push, PALETTE };
})();
