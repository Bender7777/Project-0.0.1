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

// Number-only hover tooltip: no title (category/day label), no dataset-name
// prefix, no color swatch — just the raw value in a small themed bubble.
// The companion `renderTable`/`card__table` next to every chart already
// carries the full label+percent breakdown, so the on-hover bubble doesn't
// need to repeat it, only confirm the exact number a mark represents.
function numberOnlyTooltip(p) {
  return {
    enabled: true,
    displayColors: false,
    backgroundColor: p.textPrimary,
    titleColor: p.surface,
    bodyColor: p.surface,
    borderWidth: 0,
    cornerRadius: 8,
    padding: 8,
    caretSize: 6,
    bodyFont: { size: 13, weight: '700' },
    callbacks: {
      title: () => '',
      label: (ctx) => ctx.formattedValue,
    },
  };
}

function baseChartOptions(p) {
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.color = p.textSecondary;
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: marksAnimation(),
    // `borderRadius` doubles as barHoverBouncePlugin's animation carrier
    // (see the plugin's comment for why) — registering it here is what
    // makes Chart.js actually interpolate it at all (Chart.js only auto-
    // animates its own built-in 'colors'/'numbers' property groups, and
    // 'borderRadius' isn't in either). The 200ms/easeOutQuart on
    // `transitions.active` covers the ordinary hover color swap as before;
    // the more specific `animations.borderRadius` override nested under it
    // gives *this* property its own slower, genuinely bouncy easing.
    animations: { borderRadius: { properties: ['borderRadius'], type: 'number' } },
    transitions: {
      active: {
        animation: { duration: 200, easing: 'easeOutQuart' },
        animations: { borderRadius: { duration: 600, easing: 'easeOutBounce' } },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: numberOnlyTooltip(p),
    },
  };
}

// Horizontal (and grouped-horizontal) bar charts need a per-category row
// height, not a fixed box — squeeze 15 departments into a 240px box and
// every bar becomes an unreadable sliver. Height grows with the category
// count up to `max`, then the body scrolls instead of growing forever.
function sizeCategoryChartBody(canvasId, count, opts) {
  const { perRow, groupSize = 1, gap = 10, padding = 60, min = 220, max = 520 } = opts;
  const body = document.getElementById(canvasId).parentElement;
  const raw = padding + count * (perRow * groupSize + gap);
  body.style.height = `${Math.max(min, Math.min(max, raw))}px`;
  body.classList.toggle('card__body--scroll', raw > max);
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

// Bars have no built-in equivalent to donuts' hoverOffset/animateScale, so
// this is the bar-chart counterpart — a genuine "bounce", not a resize.
// Chart.js only resolves a fixed whitelist of properties into a bar
// element's `.options` (borderRadius/borderWidth/backgroundColor/…, see
// BarElement's own defaults) — an arbitrary custom key like `hoverLift`
// never makes it there and silently animates nothing, so `borderRadius`
// itself is repurposed as the animation carrier: each dataset's
// `borderRadius` is scriptable (`BASE_RADIUS` normally, `HOVER_RADIUS`
// while `ctx.active`, see `hoverBorderRadius()` below), and with it
// registered in `baseChartOptions.animations` it eases between the two
// with real 'easeOutBounce' easing. This plugin reads the *live
// interpolated* value each frame, rescales it back to a 0..1 progress, and
// redraws that one bar translated straight up by up to BAR_LIFT_PX with a
// much bigger drop shadow and fully-rounded corners — so it reads as
// having physically hopped up off the row/baseline. Pure translation,
// never a change to the bar's own width/height, so its shape (and the
// value it represents) never visibly distorts — only its *position* and
// depth cues (shadow/gloss) animate. The lift direction is always "up" on
// screen regardless of chart orientation (not "further from the axis"
// along the value axis) specifically so a hovered segment in a *stacked*
// bar (renderInstructorChart) floats clear of its row without sliding
// into — and overlapping — the segment stacked next to it. Each dataset's
// own `backgroundColor` is left alone for the *normal* (non-hover) render;
// only `hoverFillFn` (a second, brighter glossy-gradient function stored
// directly on the dataset — not a real Chart.js option key, so it's simply
// read straight off `chart.data.datasets[i]` rather than routed through
// the animated-options system) feeds this plugin's replacement fill — and
// `hoverBackgroundColor: 'transparent'` on that same dataset hides Chart.js's
// own unlifted copy of the active bar so this one doesn't draw on top of a
// visible duplicate left behind at the original position.
const BAR_LIFT_PX = 16;
const BASE_RADIUS = 8;
const HOVER_RADIUS = 14;

function hoverBorderRadius() {
  return (ctx) => (ctx.active ? HOVER_RADIUS : BASE_RADIUS);
}

const barHoverBouncePlugin = {
  id: 'barHoverBounce',
  afterDatasetsDraw(chart) {
    const horizontal = chart.options.indexAxis === 'y';
    const ctx = chart.ctx;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta || meta.hidden || !meta.data) return;
      meta.data.forEach((bar, index) => {
        const raw = bar.options && bar.options.borderRadius;
        const lift = raw == null ? 0 : Math.max(0, Math.min(1, (raw - BASE_RADIUS) / (HOVER_RADIUS - BASE_RADIUS)));
        if (!lift) return;
        const offset = lift * BAR_LIFT_PX;
        let x, y, w, h;
        if (horizontal) {
          const left = Math.min(bar.x, bar.base);
          w = Math.max(bar.x, bar.base) - left;
          h = bar.height;
          x = left;
          y = bar.y - h / 2 - offset;
        } else {
          const top = Math.min(bar.y, bar.base);
          w = bar.width;
          h = Math.max(bar.y, bar.base) - top;
          x = bar.x - w / 2;
          y = top - offset;
        }
        ctx.save();
        ctx.shadowColor = shadowColorForMode();
        ctx.shadowBlur = 16 + lift * 26;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 8 + lift * 16;
        const fillFn = dataset.hoverFillFn;
        ctx.fillStyle = fillFn ? fillFn({ chart, dataIndex: index }) : bar.options.backgroundColor;
        ctx.beginPath();
        const r = Math.min(14, w / 2, h / 2);
        if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
        else ctx.rect(x, y, w, h);
        ctx.fill();
        ctx.restore();
      });
    });
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

// Draws each horizontal bar's own label (e.g. "Отдел — N") inside the bar
// itself, so a category axis with long text doesn't need its own column —
// the chart reads correctly even with its y-axis ticks turned off. Falls
// back to placing the label just past the bar's end, in the normal text
// color, when the bar is too short to hold the text in white.
const barInlineLabelsPlugin = {
  id: 'barInlineLabels',
  afterDatasetsDraw(chart, args, pluginOpts) {
    const { labels, textColor } = pluginOpts || {};
    if (!labels) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;
    const ctx = chart.ctx;
    ctx.save();
    ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    const pad = 10;
    meta.data.forEach((bar, i) => {
      const text = labels[i];
      if (text == null) return;
      const start = Math.min(bar.x, bar.base);
      const end = Math.max(bar.x, bar.base);
      const fitsInside = end - start - pad * 2 >= ctx.measureText(text).width;
      ctx.textAlign = 'left';
      ctx.fillStyle = fitsInside ? 'rgba(255,255,255,0.95)' : textColor || '#0b0b0b';
      // Follow barHoverBouncePlugin's own upward offset (same borderRadius-
      // as-carrier trick, see that plugin's comment) so the label stays
      // centered on the bar it names instead of getting left behind.
      const raw = bar.options && bar.options.borderRadius;
      const lift = raw == null ? 0 : Math.max(0, Math.min(1, (raw - BASE_RADIUS) / (HOVER_RADIUS - BASE_RADIUS)));
      ctx.fillText(text, (fitsInside ? start : end) + pad, bar.y - lift * BAR_LIFT_PX);
    });
    ctx.restore();
  },
};

const KPI_ICONS = [
  // users (card 1 — Всего сотрудников)
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="8" r="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 4.3c1.6.4 2.8 1.8 2.8 3.5 0 1.7-1.2 3.1-2.8 3.5M18.5 14.2c2 .5 3.5 2.3 3.5 4.3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  // funnel (card 2 — Категория filter control)
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M4 5h16l-6.2 7.4V19l-3.6 2v-8.6L4 5Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  // check circle (card 3 — Проголосовали)
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 12.3l2.4 2.4 4.6-5.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  // x circle (card 4 — Не проголосовали)
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.8"/><path d="M9.3 9.3l5.4 5.4M14.7 9.3l-5.4 5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
];

// Card 2 ("Категория") is a pure Все/ЧКЭ/ДО filter control, not a metric —
// it carries no value/sub of its own and isn't a drilldown button. Its
// buttons call the global `setScope()` from app.js, same cross-file
// pattern as `openDrilldown`/`filterByDepartment`.
function renderKPIs(stats) {
  const el = document.getElementById('kpi-grid');
  const statCards = [
    {
      index: 0,
      label: 'Всего сотрудников',
      value: stats.total.toLocaleString('ru-RU'),
      sub: `${stats.byDept.length} отдел(ов)`,
      title: 'Все сотрудники',
      rows: stats.allRows,
    },
    {
      index: 2,
      label: 'Проголосовали',
      value: stats.turnout.count.toLocaleString('ru-RU'),
      sub: `<strong>${fmtPct(stats.turnout.pct)}</strong> от общего числа`,
      title: 'Проголосовали',
      rows: stats.turnout.rows,
    },
    {
      index: 3,
      label: 'Не проголосовали',
      value: stats.notVoted.count.toLocaleString('ru-RU'),
      sub: `<strong>${fmtPct(stats.notVoted.pct)}</strong> от общего числа`,
      title: 'Не проголосовали',
      rows: stats.notVoted.rows,
    },
  ];

  const statCardHtml = (c) => `
    <button type="button" class="kpi kpi--${c.index + 1}" data-kpi-index="${c.index}">
      <span class="kpi__icon">${KPI_ICONS[c.index]}</span>
      <p class="kpi__label">${c.label}</p>
      <p class="kpi__value">${c.value}</p>
      <p class="kpi__sub">${c.sub}</p>
    </button>`;

  const scopeCardHtml = `
    <div class="kpi kpi--2 kpi--scope">
      <span class="kpi__icon">${KPI_ICONS[1]}</span>
      <p class="kpi__label">Категория</p>
      <div class="kpi__segmented segmented" id="scope-segmented" role="tablist" aria-label="Категория сотрудников">
        <button type="button" class="segmented__btn" data-scope="all" role="tab">Все</button>
        <button type="button" class="segmented__btn" data-scope="chke" role="tab">ЧКЭ</button>
        <button type="button" class="segmented__btn" data-scope="do" role="tab">ДО</button>
      </div>
    </div>`;

  el.innerHTML = [statCardHtml(statCards[0]), scopeCardHtml, statCardHtml(statCards[1]), statCardHtml(statCards[2])].join('');

  el.querySelectorAll('.kpi[data-kpi-index]').forEach((node) => {
    const c = statCards.find((sc) => sc.index === Number(node.dataset.kpiIndex));
    node.addEventListener('click', () => openDrilldown(c.title, c.rows));
  });

  el.querySelectorAll('#scope-segmented .segmented__btn').forEach((btn) => {
    const active = btn.dataset.scope === scopeFilter;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.addEventListener('click', () => setScope(btn.dataset.scope));
  });
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

// Full-width highlight band behind the bar of every currently-included
// department, drawn before the bars so the bar sits on top of it — the
// visual cue for "selected" that survives the chart always showing every
// department (see renderDeptChart).
const deptRowHighlightPlugin = {
  id: 'deptRowHighlight',
  beforeDatasetsDraw(chart) {
    if (!excludedDepts.size) return;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data.length) return;
    const ctx = chart.ctx;
    const area = chart.chartArea;
    ctx.save();
    ctx.fillStyle = currentThemeMode() === 'dark' ? 'rgba(57,135,229,0.22)' : 'rgba(0,57,166,0.10)';
    meta.data.forEach((bar, i) => {
      if (excludedDepts.has(chart.data.labels[i])) return;
      const h = bar.height || 30;
      ctx.fillRect(area.left, bar.y - h / 2, area.width, h);
    });
    ctx.restore();
  },
};

function renderDeptChart(stats) {
  const p = currentPalette();
  destroyChart('dept');
  const labels = stats.byDept.map((d) => d.name);
  const filterActive = excludedDepts.size > 0;
  const colors = stats.byDept.map((d, i) => (filterActive && excludedDepts.has(d.name) ? p.muted : categoricalColor(i)));
  const inlineLabels = stats.byDept.map((d) => `${d.name} — ${d.count}`);
  sizeCategoryChartBody('chart-dept', stats.byDept.length, { perRow: 32, gap: 10, padding: 24, min: 180, max: 460 });
  chartRegistry.dept = new Chart(document.getElementById('chart-dept'), {
    type: 'bar',
    plugins: [volumeShadowPlugin, deptRowHighlightPlugin, barHoverBouncePlugin, barInlineLabelsPlugin],
    data: {
      labels,
      datasets: [
        {
          label: 'Сотрудников',
          data: stats.byDept.map((d) => d.count),
          backgroundColor: glossyColorByIndex(colors, { horizontal: true }),
          hoverBackgroundColor: 'transparent',
          hoverFillFn: glossyColorByIndex(colors, { horizontal: true, lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: hoverBorderRadius(),
          maxBarThickness: 34,
        },
      ],
    },
    options: Object.assign(baseChartOptions(p), {
      indexAxis: 'y',
      // 'y'/intersect:false makes the whole row clickable/hoverable, not
      // just the rendered bar length — needed since short bars (low
      // headcount departments) would otherwise be almost unclickable.
      interaction: { mode: 'y', intersect: false },
      scales: {
        x: gridScale(p, { beginAtZero: true, ticks: { precision: 0 } }),
        y: { grid: { display: false }, border: { display: false }, ticks: { display: false } },
      },
      plugins: Object.assign(baseChartOptions(p).plugins, {
        barInlineLabels: { labels: inlineLabels, textColor: p.textPrimary },
      }),
      // Unlike every other chart, a click here drives the department filter
      // (same excludedDepts state as the dropdown above the dashboard)
      // instead of opening the drill-down modal — and this chart always
      // keeps every department visible (it's rendered from scope-only
      // stats, not the department-filtered ones), highlighting the
      // included row(s) instead of shrinking down to just the selection.
      onHover: (evt, elements, chart) => {
        chart.canvas.style.cursor = elements.length ? 'pointer' : 'default';
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const d = stats.byDept[elements[0].index];
        // Deferred: filterByDepartment() destroys and recreates this very
        // chart via refreshDashboard(), which must not happen synchronously
        // inside Chart.js's own click dispatch for this canvas.
        setTimeout(() => filterByDepartment(d.name), 0);
      },
    }),
  });
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
        tooltip: numberOnlyTooltip(p),
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

function renderDaysChart(stats) {
  const p = currentPalette();
  destroyChart('days');
  const labels = stats.byDay.map((d) => d.label);
  const colors = labels.map((_, i) => categoricalColor(i));
  chartRegistry.days = new Chart(document.getElementById('chart-days'), {
    type: 'bar',
    plugins: [volumeShadowPlugin, barHoverBouncePlugin],
    data: {
      labels,
      datasets: [
        {
          label: 'Проголосовало',
          data: stats.byDay.map((d) => d.voted),
          backgroundColor: glossyColorByIndex(colors),
          hoverBackgroundColor: 'transparent',
          hoverFillFn: glossyColorByIndex(colors, { lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: hoverBorderRadius(),
          maxBarThickness: 56,
        },
      ],
    },
    options: Object.assign(baseChartOptions(p), {
      scales: {
        x: { grid: { display: false }, border: { color: p.baseline }, ticks: { color: p.textPrimary } },
        y: gridScale(p, { beginAtZero: true, ticks: { precision: 0 } }),
      },
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

function renderDayFormatChart(stats) {
  const p = currentPalette();
  destroyChart('dayFormat');
  const labels = stats.dayFormat.map((d) => d.label);
  const c1 = categoricalColor(0);
  const c2 = categoricalColor(1);
  chartRegistry.dayFormat = new Chart(document.getElementById('chart-day-format'), {
    type: 'bar',
    plugins: [volumeShadowPlugin, barHoverBouncePlugin],
    data: {
      labels,
      datasets: [
        {
          label: 'ДЭГ',
          data: stats.dayFormat.map((d) => d.deg),
          backgroundColor: glossyColor(c1),
          hoverBackgroundColor: 'transparent',
          hoverFillFn: glossyColor(c1, { lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: hoverBorderRadius(),
          maxBarThickness: 40,
        },
        {
          label: 'ОЧНО',
          data: stats.dayFormat.map((d) => d.ochno),
          backgroundColor: glossyColor(c2),
          hoverBackgroundColor: 'transparent',
          hoverFillFn: glossyColor(c2, { lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: hoverBorderRadius(),
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
    plugins: [volumeShadowPlugin, barHoverBouncePlugin],
    data: {
      labels,
      datasets: [
        {
          label: 'Явка, %',
          data: stats.deptTurnout.map((d) => Number(d.pct.toFixed(1))),
          backgroundColor: glossyColor(p.good),
          hoverBackgroundColor: 'transparent',
          hoverFillFn: glossyColor(p.good, { lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: hoverBorderRadius(),
          maxBarThickness: 40,
        },
      ],
    },
    options: Object.assign(baseChartOptions(p), {
      scales: {
        x: { grid: { display: false }, border: { color: p.baseline }, ticks: { color: p.textPrimary } },
        y: gridScale(p, { beginAtZero: true, suggestedMax: 100, ticks: { callback: (v) => v + '%' } }),
      },
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
  // One stacked bar per instructor (voted + not voted = total assigned)
  // instead of two side-by-side bars — half the vertical space for the
  // same information, and the proportion reads at a glance.
  sizeCategoryChartBody('chart-instructor', stats.byInstructor.length, { perRow: 34, gap: 16, padding: 60, min: 240, max: 540 });
  chartRegistry.instructor = new Chart(document.getElementById('chart-instructor'), {
    type: 'bar',
    plugins: [volumeShadowPlugin, barHoverBouncePlugin],
    data: {
      labels,
      datasets: [
        {
          label: 'Проголосовало',
          data: stats.byInstructor.map((d) => d.voted),
          backgroundColor: glossyColor(categoricalColor(0), { horizontal: true }),
          hoverBackgroundColor: 'transparent',
          hoverFillFn: glossyColor(categoricalColor(0), { horizontal: true, lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: hoverBorderRadius(),
          maxBarThickness: 30,
        },
        {
          label: 'Не проголосовало',
          data: stats.byInstructor.map((d) => d.count - d.voted),
          backgroundColor: glossyColor(p.muted, { horizontal: true }),
          hoverBackgroundColor: 'transparent',
          hoverFillFn: glossyColor(p.muted, { horizontal: true, lightAmt: 0.62, darkAmt: 0.2 }),
          borderRadius: hoverBorderRadius(),
          maxBarThickness: 30,
        },
      ],
    },
    options: Object.assign(baseChartOptions(p), {
      indexAxis: 'y',
      scales: {
        x: gridScale(p, { beginAtZero: true, stacked: true, ticks: { precision: 0 } }),
        y: { grid: { display: false }, border: { color: p.baseline }, ticks: { color: p.textPrimary, font: { size: 11.5 } }, stacked: true },
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
        const isVoted = el.datasetIndex === 0;
        return { title: `${d.name} — ${isVoted ? 'проголосовало' : 'не проголосовало'}`, rows: isVoted ? d.votedRows : d.notVotedRows };
      }),
    }),
  });
}

// `deptStats` is optional and, when given, is scope-only (no department
// filter applied) so "По отделам" can always show every department — see
// renderDeptChart. Falls back to `stats` for direct/manual calls.
function renderAllCharts(stats, deptStats) {
  renderKPIs(stats);
  renderDeptChart(deptStats || stats);
  renderDaysChart(stats);
  renderFormatChart(stats);
  renderDayFormatChart(stats);
  renderDeptTurnoutChart(stats);
  renderInstructorChart(stats);
}
