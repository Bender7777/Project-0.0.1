// Chart.js rendering + companion data tables. All charts are theme-aware and
// re-created on theme toggle / new data via `renderAllCharts`.

const chartRegistry = {};

function destroyChart(id) {
  if (chartRegistry[id]) {
    chartRegistry[id].destroy();
    delete chartRegistry[id];
  }
}

// A staggered, slightly overshooting entrance (each mark grows in a beat
// after the last) reads as more "alive" than everything popping in at
// once — but only on the initial draw, never on hover/active redraws.
function marksAnimation() {
  return {
    duration: 700,
    easing: 'easeOutBack',
    delay: (ctx) => (ctx.type === 'data' && ctx.mode === 'default' && !ctx.active ? ctx.dataIndex * 45 + (ctx.datasetIndex || 0) * 90 : 0),
  };
}

function baseChartOptions(p) {
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.color = p.textSecondary;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: marksAnimation(),
    transitions: { active: { animation: { duration: 200, easing: 'easeOutQuart' } } },
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: p.textPrimary,
        titleColor: p.surface,
        bodyColor: p.surface,
        padding: 10,
        cornerRadius: 8,
        displayColors: true,
        boxPadding: 4,
      },
    },
  };
}

function gridScale(p, extra) {
  return Object.assign(
    {
      grid: { color: p.grid, drawTicks: false },
      border: { color: p.baseline },
      ticks: { color: p.textSecondary, font: { size: 11 } },
    },
    extra || {}
  );
}

// Click-to-drill-down: resolve(element) returns {title, rows} for the
// clicked mark (or a falsy value to ignore the click), and the pointer
// turns into a hand while hovering any clickable mark.
function drilldownHandlers(resolve) {
  return {
    onHover: (evt, elements, chart) => {
      chart.canvas.style.cursor = elements.length ? 'pointer' : 'default';
    },
    onClick: (evt, elements) => {
      if (!elements.length) return;
      const result = resolve(elements[0]);
      if (result) openDrilldown(result.title, result.rows);
    },
  };
}

// --- Volume helpers: gradient fills + drop shadow so bars/donuts read as
// glossy 3D marks, matching the bento card chrome. Same base hue in/out —
// only lightness changes, so categorical identity and CVD separation hold.

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function mixHex(hex, target, amount) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  const mix = (x, y) => Math.round(x + (y - x) * amount);
  return `rgb(${mix(a.r, b.r)}, ${mix(a.g, b.g)}, ${mix(a.b, b.b)})`;
}

function lighten(hex, amount) {
  return mixHex(hex, '#ffffff', amount);
}

function darken(hex, amount) {
  return mixHex(hex, '#000000', amount);
}

function obliqueGradient(ctx, area, hex, opts) {
  if (!area) return hex;
  const { horizontal = false, lightAmt = 0.52, darkAmt = 0.42 } = opts || {};
  const grad = horizontal
    ? ctx.createLinearGradient(area.left, 0, area.right, 0)
    : ctx.createLinearGradient(0, area.top, 0, area.bottom);
  grad.addColorStop(0, lighten(hex, lightAmt));
  grad.addColorStop(0.5, hex);
  grad.addColorStop(1, darken(hex, darkAmt));
  return grad;
}

function glossyColor(hex, opts) {
  return (ctx) => {
    const { chart } = ctx;
    if (!chart.chartArea) return hex;
    return obliqueGradient(chart.ctx, chart.chartArea, hex, opts);
  };
}

function glossyColorByIndex(colors, opts) {
  return (ctx) => {
    const { chart, dataIndex } = ctx;
    const hex = colors[dataIndex];
    if (!chart.chartArea || hex == null) return hex;
    return obliqueGradient(chart.ctx, chart.chartArea, hex, opts);
  };
}

function shadowColorForMode() {
  return currentThemeMode() === 'dark' ? 'rgba(0,0,0,0.78)' : 'rgba(15,15,15,0.46)';
}

const volumeShadowPlugin = {
  id: 'volumeShadow',
  beforeDatasetsDraw(chart) {
    const ctx = chart.ctx;
    ctx.save();
    ctx.shadowColor = shadowColorForMode();
    ctx.shadowBlur = 26;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 13;
  },
  afterDatasetsDraw(chart) {
    chart.ctx.restore();
  },
};

// Soft specular highlight arced across the top of a doughnut ring, so it
// reads as a glossy dome rather than a flat painted disc.
const donutGlossPlugin = {
  id: 'donutGloss',
  afterDatasetsDraw(chart) {
    const meta = chart.getDatasetMeta(0);
    const arc = meta && meta.data && meta.data[0];
    if (!arc || arc.innerRadius == null) return;
    const { x: cx, y: cy, innerRadius, outerRadius } = arc;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2);
    ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    const hx = cx - outerRadius * 0.28;
    const hy = cy - outerRadius * 0.62;
    const grad = ctx.createRadialGradient(hx, hy, 1, hx, hy, outerRadius * 1.15);
    grad.addColorStop(0, 'rgba(255,255,255,0.78)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.22)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - outerRadius, cy - outerRadius, outerRadius * 2, outerRadius * 2);
    ctx.restore();
  },
};

const KPI_ICONS = [
  // users
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 4.3c1.6.4 2.8 1.8 2.8 3.5 0 1.7-1.2 3.1-2.8 3.5M18.5 14.2c2 .5 3.5 2.3 3.5 4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  // check circle
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 12.3l2.4 2.4 4.6-5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // calendar / leave
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="4" y="5.5" width="16" height="14" rx="2.5" stroke="currentColor" stroke-width="1.8"/><path d="M4 10h16M8 3.5v3M16 3.5v3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8.5 14.3l2 2 4-4.3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // pulse / turnout
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M3 13h3.2l2-4.5 3 9 2.4-6.5 1.6 2h5.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
];

function renderKPIs(stats) {
  const el = document.getElementById('kpi-grid');
  const cards = [
    {
      label: 'Всего сотрудников',
      value: stats.total.toLocaleString('ru-RU'),
      sub: `${stats.byDept.length} отдел(ов)`,
    },
    {
      label: 'Проголосовали',
      value: stats.turnout.count.toLocaleString('ru-RU'),
      sub: `<strong>${fmtPct(stats.turnout.pct)}</strong> от общего числа`,
    },
    {
      label: 'В декретном отпуске (ДО)',
      value: stats.dekret.count.toLocaleString('ru-RU'),
      sub: `<strong>${fmtPct(stats.dekret.pct)}</strong> от общего числа`,
    },
    {
      label: 'Явка среди ДО',
      value: stats.dekretTurnout.count.toLocaleString('ru-RU'),
      sub: `<strong>${fmtPct(stats.dekretTurnout.pct)}</strong> из ${stats.dekretTurnout.baseCount} чел. в ДО`,
    },
  ];
  el.innerHTML = cards
    .map(
      (c, i) => `
    <div class="kpi kpi--${i + 1}">
      <span class="kpi__icon">${KPI_ICONS[i]}</span>
      <p class="kpi__label">${c.label}</p>
      <p class="kpi__value">${c.value}</p>
      <p class="kpi__sub">${c.sub}</p>
    </div>`
    )
    .join('');
}

function renderTable(elId, headers, rows) {
  const el = document.getElementById(elId);
  const thead = `<thead><tr>${headers.map((h) => `<th class="${h.num ? 'num' : ''}">${h.label}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell, i) => `<td class="${headers[i].num ? 'num' : ''}">${cell}</td>`)
          .join('')}</tr>`
    )
    .join('')}</tbody>`;
  el.innerHTML = `<table class="stat-table">${thead}${tbody}</table>`;
}

function swatch(color) {
  return `<span class="swatch" style="background:${color}"></span>`;
}

// --- Individual charts -----------------------------------------------------

function renderDeptChart(stats) {
  const p = currentPalette();
  destroyChart('dept');
  const labels = stats.byDept.map((d) => d.name);
  const colors = stats.byDept.map((_, i) => categoricalColor(i));
  chartRegistry.dept = new Chart(document.getElementById('chart-dept'), {
    type: 'bar',
    plugins: [volumeShadowPlugin],
    data: {
      labels,
      datasets: [
        {
          label: 'Сотрудников',
          data: stats.byDept.map((d) => d.count),
          backgroundColor: glossyColorByIndex(colors, { horizontal: true }),
          hoverBackgroundColor: glossyColorByIndex(colors, { horizontal: true, lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: 8,
          maxBarThickness: 34,
        },
      ],
    },
    options: Object.assign(baseChartOptions(p), {
      indexAxis: 'y',
      scales: {
        x: gridScale(p, { beginAtZero: true, ticks: { precision: 0 } }),
        y: { grid: { display: false }, border: { color: p.baseline }, ticks: { color: p.textPrimary, font: { size: 11.5 } } },
      },
      plugins: Object.assign(baseChartOptions(p).plugins, {
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const d = stats.byDept[ctx.dataIndex];
              return ` ${d.count} чел. (${fmtPct(d.pct)})`;
            },
          },
        },
      }),
      ...drilldownHandlers((el) => {
        const d = stats.byDept[el.index];
        return { title: `Отдел: ${d.name}`, rows: d.rows };
      }),
    }),
  });

  renderTable(
    'table-dept',
    [{ label: '' }, { label: 'Отдел' }, { label: 'Кол-во', num: true }, { label: 'Доля', num: true }],
    stats.byDept.map((d, i) => [swatch(colors[i]), d.name, d.count, fmtPct(d.pct)])
  );
}

function donutChart(canvasId, p, labels, data, colors, opts) {
  const { rowsByIndex, titlePrefix } = opts || {};
  return new Chart(document.getElementById(canvasId), {
    type: 'doughnut',
    plugins: [volumeShadowPlugin, donutGlossPlugin],
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: glossyColorByIndex(colors, { lightAmt: 0.58, darkAmt: 0.38 }),
          hoverBackgroundColor: glossyColorByIndex(colors, { lightAmt: 0.7, darkAmt: 0.26 }),
          borderWidth: 0,
          hoverOffset: 14,
          hoverBorderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      animation: Object.assign(marksAnimation(), { animateScale: true, animateRotate: true }),
      transitions: { active: { animation: { duration: 300, easing: 'easeOutQuart' } } },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: p.textSecondary, boxWidth: 10, boxHeight: 10, padding: 12, font: { size: 11.5 } },
        },
        tooltip: {
          backgroundColor: p.textPrimary,
          titleColor: p.surface,
          bodyColor: p.surface,
          padding: 10,
          cornerRadius: 8,
          callbacks: {
            label: (ctx) => {
              const total = data.reduce((a, b) => a + b, 0);
              return ` ${ctx.label}: ${ctx.raw} (${fmtPct(pct(ctx.raw, total))})`;
            },
          },
        },
      },
      ...(rowsByIndex
        ? drilldownHandlers((el) => ({
            title: titlePrefix ? `${titlePrefix} — ${labels[el.index]}` : labels[el.index],
            rows: rowsByIndex[el.index],
          }))
        : {}),
    },
  });
}

function renderDekretChart(stats) {
  const p = currentPalette();
  destroyChart('dekret');
  const labels = ['В декрете (ДО)', 'Без ДО'];
  const data = [stats.dekret.count, stats.dekret.withoutCount];
  const colors = [categoricalColor(0), categoricalColor(1)];
  chartRegistry.dekret = donutChart('chart-dekret', p, labels, data, colors, {
    rowsByIndex: [stats.dekret.rows, stats.dekret.withoutRows],
    titlePrefix: 'Декретный отпуск',
  });
  renderTable(
    'table-dekret',
    [{ label: '' }, { label: 'Категория' }, { label: 'Кол-во', num: true }, { label: 'Доля', num: true }],
    [
      [swatch(colors[0]), labels[0], data[0], fmtPct(stats.dekret.pct)],
      [swatch(colors[1]), labels[1], data[1], fmtPct(stats.dekret.withoutPct)],
    ]
  );
}

function renderDaysChart(stats) {
  const p = currentPalette();
  destroyChart('days');
  const labels = stats.byDay.map((d) => d.label);
  const colors = labels.map((_, i) => categoricalColor(i));
  chartRegistry.days = new Chart(document.getElementById('chart-days'), {
    type: 'bar',
    plugins: [volumeShadowPlugin],
    data: {
      labels,
      datasets: [
        {
          label: 'Проголосовало',
          data: stats.byDay.map((d) => d.voted),
          backgroundColor: glossyColorByIndex(colors),
          hoverBackgroundColor: glossyColorByIndex(colors, { lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: 8,
          maxBarThickness: 56,
        },
      ],
    },
    options: Object.assign(baseChartOptions(p), {
      scales: {
        x: { grid: { display: false }, border: { color: p.baseline }, ticks: { color: p.textPrimary } },
        y: gridScale(p, { beginAtZero: true, ticks: { precision: 0 } }),
      },
      plugins: Object.assign(baseChartOptions(p).plugins, {
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const d = stats.byDay[ctx.dataIndex];
              return ` ${d.voted} чел. (${fmtPct(d.votedPctOfAll)} от всех, ${fmtPct(d.votedPctOfDay)} от назначенных на день)`;
            },
          },
        },
      }),
      ...drilldownHandlers((el) => {
        const d = stats.byDay[el.index];
        return { title: `Проголосовали ${d.label}`, rows: d.votedRows };
      }),
    }),
  });

  renderTable(
    'table-days',
    [{ label: '' }, { label: 'День' }, { label: 'Проголосовало', num: true }, { label: '% от всех', num: true }],
    stats.byDay.map((d, i) => [swatch(colors[i]), d.label, d.voted, fmtPct(d.votedPctOfAll)])
  );
}

function renderFormatChart(stats) {
  const p = currentPalette();
  destroyChart('format');
  const labels = stats.format.map((f) => f.name);
  const colors = labels.map((_, i) => categoricalColor(i));
  chartRegistry.format = donutChart(
    'chart-format',
    p,
    labels,
    stats.format.map((f) => f.count),
    colors,
    { rowsByIndex: stats.format.map((f) => f.rows), titlePrefix: 'Способ голосования' }
  );
  renderTable(
    'table-format',
    [{ label: '' }, { label: 'Способ' }, { label: 'Кол-во', num: true }, { label: 'Доля', num: true }],
    stats.format.map((f, i) => [swatch(colors[i]), f.name, f.count, fmtPct(f.pct)])
  );
}

function renderDekretTurnoutChart(stats) {
  const p = currentPalette();
  destroyChart('dekretTurnout');
  const notVoted = stats.dekretTurnout.baseCount - stats.dekretTurnout.count;
  const labels = ['Проголосовали', 'Не проголосовали'];
  const data = [stats.dekretTurnout.count, notVoted];
  const colors = [p.good, p.muted];
  chartRegistry.dekretTurnout = donutChart('chart-dekret-turnout', p, labels, data, colors, {
    rowsByIndex: [stats.dekretTurnout.rows, stats.dekretTurnout.notVotedRows],
    titlePrefix: 'Явка сотрудников в ДО',
  });
  renderTable(
    'table-dekret-turnout',
    [{ label: '' }, { label: '' }, { label: 'Кол-во', num: true }, { label: 'Доля', num: true }],
    [
      [swatch(colors[0]), labels[0], data[0], fmtPct(stats.dekretTurnout.pct)],
      [swatch(colors[1]), labels[1], data[1], fmtPct(pct(notVoted, stats.dekretTurnout.baseCount))],
    ]
  );
}

function renderDekretFormatChart(stats) {
  const p = currentPalette();
  destroyChart('dekretFormat');
  const labels = stats.dekretFormat.map((f) => f.name);
  const colors = labels.map((_, i) => categoricalColor(i));
  chartRegistry.dekretFormat = donutChart(
    'chart-dekret-format',
    p,
    labels,
    stats.dekretFormat.map((f) => f.count),
    colors,
    { rowsByIndex: stats.dekretFormat.map((f) => f.rows), titlePrefix: 'ДО: способ голосования' }
  );
  renderTable(
    'table-dekret-format',
    [{ label: '' }, { label: 'Способ' }, { label: 'Кол-во', num: true }, { label: 'Доля', num: true }],
    stats.dekretFormat.map((f, i) => [swatch(colors[i]), f.name, f.count, fmtPct(f.pct)])
  );
}

function renderDayFormatChart(stats) {
  const p = currentPalette();
  destroyChart('dayFormat');
  const labels = stats.dayFormat.map((d) => d.label);
  const c1 = categoricalColor(0);
  const c2 = categoricalColor(1);
  chartRegistry.dayFormat = new Chart(document.getElementById('chart-day-format'), {
    type: 'bar',
    plugins: [volumeShadowPlugin],
    data: {
      labels,
      datasets: [
        {
          label: 'ДЭГ',
          data: stats.dayFormat.map((d) => d.deg),
          backgroundColor: glossyColor(c1),
          hoverBackgroundColor: glossyColor(c1, { lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: 8,
          maxBarThickness: 40,
        },
        {
          label: 'ОЧНО',
          data: stats.dayFormat.map((d) => d.ochno),
          backgroundColor: glossyColor(c2),
          hoverBackgroundColor: glossyColor(c2, { lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: 8,
          maxBarThickness: 40,
        },
      ],
    },
    options: Object.assign(baseChartOptions(p), {
      scales: {
        x: { grid: { display: false }, border: { color: p.baseline }, ticks: { color: p.textPrimary }, stacked: false },
        y: gridScale(p, { beginAtZero: true, ticks: { precision: 0 } }),
      },
      plugins: Object.assign(baseChartOptions(p).plugins, {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: p.textSecondary, boxWidth: 10, boxHeight: 10, font: { size: 11.5 } },
        },
      }),
      ...drilldownHandlers((el) => {
        const d = stats.dayFormat[el.index];
        const isDeg = el.datasetIndex === 0;
        return { title: `${d.label} — ${isDeg ? 'ДЭГ' : 'ОЧНО'}`, rows: isDeg ? d.degRows : d.ochnoRows };
      }),
    }),
  });
}

function renderDeptTurnoutChart(stats) {
  const p = currentPalette();
  destroyChart('deptTurnout');
  const labels = stats.deptTurnout.map((d) => d.name);
  chartRegistry.deptTurnout = new Chart(document.getElementById('chart-dept-turnout'), {
    type: 'bar',
    plugins: [volumeShadowPlugin],
    data: {
      labels,
      datasets: [
        {
          label: 'Явка, %',
          data: stats.deptTurnout.map((d) => Number(d.pct.toFixed(1))),
          backgroundColor: glossyColor(p.good),
          hoverBackgroundColor: glossyColor(p.good, { lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: 8,
          maxBarThickness: 40,
        },
      ],
    },
    options: Object.assign(baseChartOptions(p), {
      scales: {
        x: { grid: { display: false }, border: { color: p.baseline }, ticks: { color: p.textPrimary } },
        y: gridScale(p, { beginAtZero: true, suggestedMax: 100, ticks: { callback: (v) => v + '%' } }),
      },
      plugins: Object.assign(baseChartOptions(p).plugins, {
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const d = stats.deptTurnout[ctx.dataIndex];
              return ` ${d.voted} из ${d.total} (${fmtPct(d.pct)})`;
            },
          },
        },
      }),
      ...drilldownHandlers((el) => {
        const d = stats.deptTurnout[el.index];
        return { title: `Явка — ${d.name}`, rows: d.votedRows };
      }),
    }),
  });
}

function renderInstructorChart(stats) {
  const p = currentPalette();
  destroyChart('instructor');
  const labels = stats.byInstructor.map((d) => d.name);
  chartRegistry.instructor = new Chart(document.getElementById('chart-instructor'), {
    type: 'bar',
    plugins: [volumeShadowPlugin],
    data: {
      labels,
      datasets: [
        {
          label: 'Всего закреплено',
          data: stats.byInstructor.map((d) => d.count),
          backgroundColor: glossyColor(p.muted, { horizontal: true }),
          hoverBackgroundColor: glossyColor(p.muted, { horizontal: true, lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: 8,
          maxBarThickness: 34,
        },
        {
          label: 'Проголосовало',
          data: stats.byInstructor.map((d) => d.voted),
          backgroundColor: glossyColor(categoricalColor(0), { horizontal: true }),
          hoverBackgroundColor: glossyColor(categoricalColor(0), { horizontal: true, lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: 8,
          maxBarThickness: 34,
        },
      ],
    },
    options: Object.assign(baseChartOptions(p), {
      indexAxis: 'y',
      scales: {
        x: gridScale(p, { beginAtZero: true, ticks: { precision: 0 } }),
        y: { grid: { display: false }, border: { color: p.baseline }, ticks: { color: p.textPrimary, font: { size: 11.5 } } },
      },
      plugins: Object.assign(baseChartOptions(p).plugins, {
        legend: {
          display: true,
          position: 'bottom',
          labels: { color: p.textSecondary, boxWidth: 10, boxHeight: 10, font: { size: 11.5 } },
        },
      }),
      ...drilldownHandlers((el) => {
        const d = stats.byInstructor[el.index];
        const isAll = el.datasetIndex === 0;
        return { title: `${d.name} — ${isAll ? 'всего закреплено' : 'проголосовало'}`, rows: isAll ? d.rows : d.votedRows };
      }),
    }),
  });
}

function renderAllCharts(stats) {
  renderKPIs(stats);
  renderDeptChart(stats);
  renderDekretChart(stats);
  renderDaysChart(stats);
  renderFormatChart(stats);
  renderDekretTurnoutChart(stats);
  renderDekretFormatChart(stats);
  renderDayFormatChart(stats);
  renderDeptTurnoutChart(stats);
  renderInstructorChart(stats);
}
