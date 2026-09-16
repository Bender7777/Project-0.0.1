// Chart.js rendering + companion data tables. All charts are theme-aware and
// re-created on theme toggle / new data via `renderAllCharts`.

const chartRegistry = {};

function destroyChart(id) {
  if (chartRegistry[id]) {
    chartRegistry[id].destroy();
    delete chartRegistry[id];
  }
}

function baseChartOptions(p) {
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.color = p.textSecondary;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
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

function renderKPIs(stats) {
  const el = document.getElementById('kpi-grid');
  const p = currentPalette();
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
      (c) => `
    <div class="kpi">
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
    data: {
      labels,
      datasets: [
        {
          label: 'Сотрудников',
          data: stats.byDept.map((d) => d.count),
          backgroundColor: colors,
          borderRadius: 4,
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
    }),
  });

  renderTable(
    'table-dept',
    [{ label: '' }, { label: 'Отдел' }, { label: 'Кол-во', num: true }, { label: 'Доля', num: true }],
    stats.byDept.map((d, i) => [swatch(colors[i]), d.name, d.count, fmtPct(d.pct)])
  );
}

function donutChart(canvasId, p, labels, data, colors, centerLabel) {
  return new Chart(document.getElementById(canvasId), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: p.surface, hoverOffset: 4 }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      animation: { duration: 250 },
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
    },
  });
}

function renderDekretChart(stats) {
  const p = currentPalette();
  destroyChart('dekret');
  const labels = ['В декрете (ДО)', 'Без ДО'];
  const data = [stats.dekret.count, stats.dekret.withoutCount];
  const colors = [categoricalColor(0), categoricalColor(1)];
  chartRegistry.dekret = donutChart('chart-dekret', p, labels, data, colors);
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
    data: {
      labels,
      datasets: [
        {
          label: 'Проголосовало',
          data: stats.byDay.map((d) => d.voted),
          backgroundColor: colors,
          borderRadius: 6,
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
    colors
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
  chartRegistry.dekretTurnout = donutChart('chart-dekret-turnout', p, labels, data, colors);
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
    colors
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
    data: {
      labels,
      datasets: [
        { label: 'ДЭГ', data: stats.dayFormat.map((d) => d.deg), backgroundColor: c1, borderRadius: 4, maxBarThickness: 40 },
        { label: 'ОЧНО', data: stats.dayFormat.map((d) => d.ochno), backgroundColor: c2, borderRadius: 4, maxBarThickness: 40 },
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
    }),
  });
}

function renderDeptTurnoutChart(stats) {
  const p = currentPalette();
  destroyChart('deptTurnout');
  const labels = stats.deptTurnout.map((d) => d.name);
  chartRegistry.deptTurnout = new Chart(document.getElementById('chart-dept-turnout'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Явка, %',
          data: stats.deptTurnout.map((d) => Number(d.pct.toFixed(1))),
          backgroundColor: p.good,
          borderRadius: 4,
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
    }),
  });
}

function renderInstructorChart(stats) {
  const p = currentPalette();
  destroyChart('instructor');
  const labels = stats.byInstructor.map((d) => d.name);
  chartRegistry.instructor = new Chart(document.getElementById('chart-instructor'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Всего закреплено', data: stats.byInstructor.map((d) => d.count), backgroundColor: p.muted, borderRadius: 4, maxBarThickness: 34 },
        { label: 'Проголосовало', data: stats.byInstructor.map((d) => d.voted), backgroundColor: categoricalColor(0), borderRadius: 4, maxBarThickness: 34 },
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
