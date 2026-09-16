# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no build step, package manager, or test suite — this is a static, dependency-free
PWA. `vendor/` holds pre-downloaded copies of the only two runtime libraries (SheetJS `xlsx`
and `Chart.js`), so nothing is fetched from a CDN at runtime.

Serve the app locally with any static file server, then open the served URL:

```bash
python3 -m http.server 8080
```

The service worker (`sw.js`) only activates over `localhost` or HTTPS, so a plain
`file://` open will skip PWA install/offline behavior but the dashboard itself still works.

There is no lint or test command configured.

## Architecture

The app is the voting-roster dashboard under the repo root (`index.html`, `src/`, `sw.js`,
`manifest.webmanifest`, `vendor/`, `icons/`). `Interview.js` and `Project.js` at the repo
root are unrelated scratch/practice snippets, not part of the app.

**Script load order matters.** `index.html` loads plain `<script>` tags (no bundler, no ES
modules) in this order, and each file depends on globals defined by the previous one:

```
vendor/xlsx.full.min.js   → global XLSX
vendor/chart.umd.min.js   → global Chart
src/palette.js            → PALETTE, currentPalette(), categoricalColor()
src/parser.js             → parseWorkbook()
src/stats.js              → computeStats(), fmtPct(), pct()
src/charts.js             → renderAllCharts() and the chartRegistry
src/app.js                → wires everything to the DOM; entry point
```

**Data flow:** `app.js` reads a File → `parser.js` (`parseWorkbook`) turns the workbook into
an array of typed row objects, matching columns by *header text* (see `COLUMN_ALIASES` in
`parser.js`), not by position — column order in the uploaded Excel file is irrelevant and
extra columns are ignored → `stats.js` (`computeStats`) reduces the rows into every dashboard
figure (per-department counts, decree/ДО turnout, per-day turnout, ДЭГ/очно breakdowns,
instructor load, etc.) in one pass → `charts.js` (`renderAllCharts`) renders each Chart.js
chart plus its companion `<table>` from that stats object. Adding a new statistic means
extending `computeStats` and adding a matching render function in `charts.js`, not touching
the parser.

**Theming:** colors are never hardcoded per chart. `palette.js` defines a light/dark
`PALETTE` object (validated categorical/status colors); `currentPalette()` / `categoricalColor()`
read the live theme, and `src/style.css` mirrors the same hex values as CSS custom properties
(`:root`, the `prefers-color-scheme: dark` block, and `[data-theme="dark"]`). Toggling the
theme (`app.js` → `applyTheme`) sets `data-theme` on `<html>` and re-runs `renderAllCharts`,
since Chart.js bakes colors into canvas at render time rather than reading CSS. If you change
a color, update it in both `palette.js` and `style.css`.

**Persistence:** there is no backend. The parsed Excel file never leaves the browser.
`app.js` caches the last-parsed dataset in `localStorage` (`STORAGE_KEY`) so the dashboard
reappears on reload/offline; `clearData()` removes it. The theme choice is a separate
`localStorage` key (`THEME_KEY`).

**Department filter:** `app.js` keeps the full parsed rows in `currentRows` and an
`excludedDepts` Set; `getFilteredRows()` applies it and `refreshDashboard()` re-runs
`computeStats` + `renderAllCharts` + `renderDeptFilter` against the filtered subset. The
filter UI is a multi-select dropdown (`#dept-dropdown`): a trigger button showing a summary
label ("Все отделы (N)" / one dept's name / "K из N отделов") and a checkbox-list panel,
rebuilt from `currentRows` (unfiltered) on every render so option counts stay stable while
each row's checked state reflects `excludedDepts`. At least one department is always kept
selected. Panel open/close state lives in `dropdown.is-open` + the panel's `hidden` attribute,
toggled by the trigger, an outside-click listener, and Escape. `computeStats`/`charts.js` are
filter-agnostic — they just operate on whatever row array they're given.

The panel itself is Excel-style: opening it snapshots `excludedDepts` into a separate
`pendingExcludedDepts`, and every control inside (checkbox rows, "Выбрать все", "Сбросить")
only mutates that pending copy via `syncDeptOptionVisuals()`/direct classList toggles — nothing
touches `excludedDepts` or calls `refreshDashboard()` until "Ок" (`applyDeptDropdown()`)
commits it and closes the panel. Closing any other way (outside click, Escape, re-clicking the
trigger) just discards the pending edits, same as Excel's own filter dropdown. **Don't rebuild
`els.deptList`'s DOM (innerHTML) in a checkbox's own click handler** — that was the bug that
used to close the panel on every check: the click bubbles to the document-level outside-click
listener afterward, and if the clicked `<button>` has already been replaced by then, the old
detached node fails the `deptDropdown.contains(e.target)` check and reads as an outside click.
Checkbox clicks must only toggle that button's own class/dataset, never touch `innerHTML`. The
Ok button is disabled (`updateDeptOkState()`) whenever the pending set would exclude every
department — a filter with nothing selected isn't a valid state to commit.

**Visual theme:** chrome (header, primary/danger buttons, the dropdown trigger/checkboxes, the
top `flag-ribbon` bar) uses Russian-flag colors (`--flag-white`/`--flag-blue`/`--flag-red` in
`style.css`, white `#fff`, blue `#0039a6`/`#3987e5` dark, red `#d52b1e`/`#e66767` dark) via
`--series-1`/`--series-2`. This is independent of the validated categorical/status colors in
`palette.js` used for chart data series — don't conflate the two when changing colors.
Depth/"volume" (glossy gradients, layered shadows, hover lift) is centralized in a handful of
tokens — `--shadow`/`--shadow-lg` (ambient + contact shadow, plus an inset top highlight),
`--gradient-blue`/`--gradient-red`, `--shadow-blue`/`--shadow-red`, and the page's
`--page-bg` radial-gradient glow — reused by `.card`, `.kpi`, `.btn--primary`, `.btn--danger`,
and the dropdown; adjust those tokens rather than styling each component's shadow/gradient
individually.

**KPI hero tiles:** the 4 KPI cards use a fixed, non-themed palette (`--kpi-1-bg`…`--kpi-4-bg`
+ matching `-text`/`-sub`/`-icon`/`-shadow` tokens in `:root`) — cream, orange, gold, green —
independent of light/dark mode, each with a glass icon badge (`renderKPIs`'s `KPI_ICONS` in
`charts.js` picks the SVG per card by index). The grid is an explicit asymmetric layout
(`.kpi-grid` in `style.css`: card 1 spans both rows on the left, cards 2–4 fill the right)
that collapses to a single column under 720px — `renderKPIs` always emits exactly 4 cards in
this order, so adding/removing a KPI tile means updating both the JS array and the CSS
grid-area rules together.

**Volume on the marks themselves:** bars and donut arcs in `charts.js` aren't flat fills —
`glossyColor`/`glossyColorByIndex` (built on `obliqueGradient`, `lighten`/`darken`) turn each
base hex into a light-to-dark canvas gradient along the bar/arc direction, and every chart
registers the `volumeShadowPlugin` (`beforeDatasetsDraw`/`afterDatasetsDraw`) to drop a
theme-aware shadow under just the data marks (not the grid/legend). The gradient is 100%
Chart.js's scriptable-option pattern — the callback returns `hex` until `chart.chartArea`
exists, then swaps in the gradient once layout is known — so **when adding a new chart, set
`backgroundColor` via one of these helpers (and add `plugins: [volumeShadowPlugin]` to the
chart config) instead of a flat color/array**, or it'll look flat next to the others. Only the
lightness changes, never the hue, so this doesn't affect categorical identity or CVD
separation — swap `categoricalColor()`/`p.*` inputs, not the gradient math, if a color needs
to change. Bars have no `borderColor`/outline (tried once, reverted — the user didn't want an
edge stroke, and `borderSkipped: false` also rounds the base of the bar, which reads wrong for
a bar chart sitting on its axis) — `borderRadius` alone gives the rounded top. Donuts likewise
have no border (`borderWidth: 0`) since a white ring reads as a seam once the fill itself is
shaded; `donutGlossPlugin` adds a soft specular highlight near the top of the ring instead,
clipped to the annulus via `arc.innerRadius`/`outerRadius`/`x`/`y` off the first `ArcElement`.
Entrance animation is staggered rather than everything popping in at once: `marksAnimation()`
(shared by `baseChartOptions` and `donutChart`) sets `easing: 'easeOutBack'` (a slight
overshoot) with a scriptable `delay` of `dataIndex * 45 + datasetIndex * 90` ms — but only when
`ctx.type === 'data' && ctx.mode === 'default' && !ctx.active`, so hover/click re-draws stay
instant rather than re-running the stagger. Donuts additionally set `animateScale: true` so
they grow from the center instead of only sweeping around. Both bar and donut options set
`transitions.active` to a short `easeOutQuart` (200–300ms) explicitly, overriding the base
animation for just the hover/active state — without it, hover color transitions would inherit
the 700ms bounce and feel sluggish.

**No hover tooltips.** `baseChartOptions` and `donutChart` both set `plugins.tooltip = { enabled: false }`
— removed on request. Don't re-add a per-chart `tooltip.callbacks` override; if a chart needs
its values visible without hovering, that's what the companion `renderTable`/`card__table` is
for (every chart already has one).

**Category count drives chart height, not a fixed box.** `sizeCategoryChartBody(canvasId,
count, opts)` sets the `.card__body`'s height in JS (before the `new Chart(...)` call, since
Chart.js reads the container size at construction) as `padding + count * (perRow * groupSize +
gap)`, clamped to `[min, max]` — beyond `max` the body switches to `card__body--scroll`
(`overflow-y: auto`) instead of growing forever. `renderDeptChart` and `renderInstructorChart`
(the two horizontal bar charts whose category count is data-dependent — instructor doubles
`groupSize` to 2 since each instructor draws two side-by-side bars) call this on every render,
so the chart stays readable whether the department filter leaves 2 departments or 20. The other
charts have a fixed, known category count (days, format, dekret) and don't need it.

**Not-voted breakdown:** `computeStats` also returns `notVoted` — `{ count, pct, rows, dekret:
{ count, pct, rows }, other: { count, pct, rows } }`, splitting everyone who didn't vote into
the decree (ДО) group vs everyone else. `renderNotVotedChart`/`#card-not-voted` renders it the
same way as the other small donut cards.

**Bento grid balance:** the `.card--1`…`.card--4` hero-palette classes cycle in DOM order
across *all* 10 chart cards (6 small + 4 wide), not per-section — so adding or removing a card
shifts every color after it; re-derive the sequence rather than picking a color ad hoc. The
card count is deliberately 6 small (two full 3-column rows) + 4 wide: an odd small-card count
leaves a lone card alone in its row with dead space beside it (that happened when `#card-not-
voted` was first added as a 7th small card) — if a new stat card unbalances the count again,
either add a second one to get back to a multiple of 3, or promote one to `.card--wide` with a
`.card__panel--split` layout (see next) rather than leaving a gap.

**`.card__panel--split`:** a wide card built around a single donut (`#card-dekret-format` is
the current example) doesn't need the chart to stack above a mostly-empty-width table — this
modifier lays the panel out as a row (fixed-width chart, table filling the rest, vertically
centered), falling back to the normal stacked column under 640px. Only donuts in wide cards
should use it; bar charts already fill wide cards' width on their own.

**Chart cards are bento tiles too:** every `.card` in `index.html` carries a `.card--1`…
`.card--4` class that cycles through the same 4 hero-palette tokens as the KPI cards (same
gradient/shadow/icon-badge treatment), plus a static inline `.card__icon` SVG per card
(hand-written in the HTML, unlike the KPI icons which are JS-generated). Chart.js canvases and
`renderTable`'s HTML tables always render inside a nested `.card__panel` — a neutral
`var(--surface-1)`/`var(--text-primary)` surface — never directly on the colored `.card`
background: this is required, not cosmetic, because Chart.js reads colors from
`currentPalette()` (theme-aware light/dark, not card-aware) and `.stat-table` cells have no
explicit color of their own, so without the panel's color reset both would inherit the card's
light/dark KPI text color and could go invisible (e.g. white-on-white) depending on which
`.card--N` variant a chart lands on. Keep new chart cards inside `.card__panel` for this
reason.

**Row-level drill-down:** `computeStats` (in `stats.js`) doesn't just count rows into each
group — every group entry also carries the matching row objects (`rows`, or a more specific
name like `votedRows`/`degRows`/`ochnoRows` where a chart needs a particular subset, e.g.
`byDay[i].votedRows` for the days-chart bars vs. `byDay[i].rows` for everyone assigned that
day). Every chart in `charts.js` wires `drilldownHandlers()` into its `options` (bar charts
directly; `donutChart()` takes a `{ rowsByIndex, titlePrefix }` opts object) so clicking a
bar/arc calls the global `openDrilldown(title, rows)` from `app.js`, which renders those rows
(via `textContent`, never `innerHTML`, since they're untrusted upload data) into the
`#drilldown-overlay` modal and lets the user export just that slice with `exportDrilldown()`
(builds a workbook with `XLSX.utils.json_to_sheet` matching the original import column names,
then `XLSX.writeFile`). **When adding a new stat/chart, thread the row list through
`computeStats` and pass it to `drilldownHandlers`/`donutChart`'s `rowsByIndex`** — don't
recompute a filter from `currentRows` in the click handler, that duplicates the grouping
logic and can drift from what the chart actually displays. Bars/arcs also get a
`hoverBackgroundColor` (the same `glossyColor`/`glossyColorByIndex` gradient with a higher
`lightAmt`) purely so hovering a clickable mark visibly lights up — keep that alongside the
plain `backgroundColor` on any new dataset.

**Service worker cache list:** `sw.js` precaches an explicit `APP_SHELL` file list. Any new
file added under `src/`, `vendor/`, or `icons/` that the app needs offline must be added to
that list, and `CACHE_NAME` bumped so returning clients pick up the change.

**Expected Excel columns** (header text, any order): `Отдел`, `Фамилия, Имя, Отчество`,
`Таб.№`, `SAP таб`, `Декрет`, `Инструктор`, `Факт выполнения`, `ДАТА`, `ДЭГ/ОЧНО`. `Декрет`
is treated as boolean (`ДО` vs blank), `Факт выполнения` as boolean (`Да` vs blank), and
`ДЭГ/ОЧНО` as the voting method of whoever has `Факт выполнения = Да`.
