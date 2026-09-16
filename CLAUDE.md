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

**Category scope filter (Все/ЧКЭ/ДО):** three buttons live inside the "Категория" KPI tile
(`renderKPIs` in `charts.js` — card 2, `.kpi--scope`, not a stat card, see KPI hero tiles below)
rather than in the filter bar; each calls the global `setScope()` in `app.js`. `.segmented`'s
own styling is a glass chip (`rgba(255,255,255,0.4)` + `backdrop-filter: blur` + the same soft
inset highlight as `.kpi__icon`'s badge) rather than a flat `--surface-1` box — it only ever
sits on top of a colored KPI card now, so it needs to read as floating chrome on that gradient,
not a plain white strip. If `.segmented` ever gets reused somewhere with a neutral background,
revisit this — the glass look assumes a colorful backdrop. `getScopedRows()`
narrows `currentRows` by `r.dekret` *before* the department filter applies, and
`getFilteredRows()` layers `excludedDepts` on top of it — the two filters combine, same as the
subtitle's filter note (`(ДО, отфильтровано из N)`). `scopeFilter` ('all'|'chke'|'do') is
separate app state alongside `excludedDepts`, reset to `'all'` in
`handleFile`/`restoreFromStorage`/`clearData` exactly where `excludedDepts` is reset. Since the
buttons live inside `#kpi-grid`, which `renderKPIs` rebuilds (`innerHTML`) on every render,
there's no persistent DOM to keep in sync — `setScope()` just flips `scopeFilter`, clears
`excludedDepts`, and calls `refreshDashboard()`; the next `renderKPIs` reads `scopeFilter`
fresh and sets `is-active` on the matching button itself. Don't reintroduce a
`syncScopeVisuals()`-style helper for this — it would go stale the instant `renderKPIs`
rebuilds the grid. Clearing `excludedDepts` on every scope change (even re-clicking the
already-active button) is deliberate: a department selected under one category may have a
different (or zero) headcount under another, so switching category always starts the
department filter over rather than risk a confusing "0 сотрудников" state.

**"По отделам" always shows every department, even while filtered.** `refreshDashboard`
computes two stats objects — one from `getFilteredRows()` (scope + department, drives every
other chart/KPI) and one from `getScopedRows()` (scope only) — and `renderAllCharts(stats,
deptStats)` passes the latter to `renderDeptChart` alone, so this one chart never shrinks down
to a single bar when a department gets selected elsewhere; it stays the full scoped list.
Selection shows up two other ways instead: `deptRowHighlightPlugin` (`beforeDatasetsDraw`,
skipped entirely when `excludedDepts` is empty) draws a full-width tinted band behind the bar
of every currently-included department, and `renderDeptChart`'s own `colors` array swaps an
excluded department's categorical color for `p.muted`. Both read the global `excludedDepts`
directly — safe despite `charts.js` loading before `app.js` in `index.html`, since the
functions that read it only run later, well after `app.js`'s top-level code has defined it
(same pattern already used by `filterByDepartment`/`currentThemeMode()` calls from this file).

**Department-bar click filters the dashboard, it doesn't drill down.** Unlike every other
chart mark, clicking or hovering anywhere along a bar's row in "По отделам" doesn't open the
row modal. `renderDeptChart` sets `options.interaction = { mode: 'y', intersect: false }` so
the hit target is the whole row across the chart's full width, not just the rendered bar
length — a low-headcount department's bar can be only a few pixels long, which would otherwise
be nearly unclickable. Its own `onHover`/`onClick` (not `drilldownHandlers()`) call
`filterByDepartment(name)` in `app.js`, which drives the *same* `excludedDepts` state as the
dropdown above it: clicking a department selects only that one, and clicking the
currently-sole-selected department again toggles back to "all departments"
(`excludedDepts.size === allDeptNames.length - 1 && !excludedDepts.has(name)`). The click
handler defers the actual filter/refresh with `setTimeout(fn, 0)` — calling
`refreshDashboard()` (which destroys and recreates this exact chart via `destroyChart('dept')`
→ `new Chart(...)`) synchronously from inside Chart.js's own click dispatch for that same
canvas throws `Cannot read properties of undefined (reading 'handleEvent')` once Chart.js's
internal event handling continues after the callback returns; deferring one tick lets Chart.js
finish before the canvas it's still processing gets torn down.

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
this order, so adding/removing a KPI tile means updating both the JS and the CSS grid-area
rules together. Card 2 ("Категория") is the odd one out: it's a `<div class="kpi--scope">`,
not a `<button>` — it carries no value/sub of its own and isn't a drilldown target, only the
Все/ЧКЭ/ДО segmented control (see above). Cards 1/3/4 ("Всего сотрудников"/"Проголосовали"/"Не
проголосовали") are real `<button>`s with a `rows`/`title` drill-down wired the same way as
chart marks — `renderKPIs` attaches a click listener per stat card straight to the global
`openDrilldown` after building the grid, rather than going through `drilldownHandlers()` (that
helper is Chart.js-element-shaped; KPI tiles are plain DOM). The "Всего сотрудников" tile's
rows come from `stats.allRows` — `computeStats` returns the untouched input row array under
that key specifically so this tile has something to show (`turnout`/`notVoted` already had
rows-bearing stat objects to point at for the other two). Card 3 "Проголосовали" and card 4
"Не проголосовали" both react to the active department + scope filter same as everything else,
since `renderKPIs` is handed the same filtered `stats` object as every other render function.

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

**Bars get a real hover bounce, not just a color swap — `barHoverBouncePlugin`.** Donuts
already animate on hover for free via their own native `hoverOffset`/`animateScale` options;
bars have no built-in equivalent. A first attempt animated `borderRadius` growing 8→14 on
hover — rejected on sight ("они форму меняют", they're changing shape) even though it was a
smooth, deliberate animation, because rounding corners reads as the mark *warping*, not lifting.
The working version is a real translation instead: the active bar's own Chart.js-drawn fill is
hidden (`hoverBackgroundColor: 'transparent'`) and `barHoverBouncePlugin` (`afterDatasetsDraw`,
registered on every bar chart) redraws it translated straight **up** by up to `BAR_LIFT_PX`
(16px), fully rounded, with a much bigger drop shadow — width/height never change, so the bar's
shape (and the value it represents) never visibly distorts, only its position and depth cues do.
The lift is always "up" on screen regardless of chart orientation (not "further along the value
axis", which for a horizontal bar would be sideways) specifically so a hovered segment in the
*stacked* instructor chart floats clear of its row without sliding sideways into the segment
stacked next to it. `renderDeptChart`'s `barInlineLabelsPlugin` reads the same lift so its
in-bar label stays centered on the bar it names instead of getting left behind.

Getting this smoothly *animated* — not a hover snap — needed a workaround: Chart.js only
resolves a fixed whitelist of properties into a bar element's `.options` (see `BarElement`'s
own defaults — `borderRadius`, `borderWidth`, `backgroundColor`, …); an arbitrary custom key
like a hypothetical `hoverLift` is silently dropped and never animates at all (tried this
first — `bar.options.hoverLift` came back `undefined` every time). So `borderRadius` itself is
repurposed as the animation *carrier*: `hoverBorderRadius()` returns `BASE_RADIUS` (8) normally
and `HOVER_RADIUS` (14) while `ctx.active`; `baseChartOptions` registers it as animatable
(`animations: { borderRadius: { properties: ['borderRadius'], type: 'number' } }` — Chart.js
doesn't auto-animate it otherwise) with its own bouncier, slower transition nested under the
mode-specific override (`transitions.active.animations.borderRadius = { duration: 600, easing:
'easeOutBounce' }`, layered *more specifically* than the flat `transitions.active.animation`
200ms/`easeOutQuart` the color swap still uses — Chart.js resolves the more specific
per-property override first). The *actual* bar's corner radius doesn't matter while
hovered since it's invisible (`hoverBackgroundColor: 'transparent'`) — `barHoverBouncePlugin`
just reads `bar.options.borderRadius`'s live interpolated value each frame and rescales it
back to a 0..1 lift progress (`(raw - BASE_RADIUS) / (HOVER_RADIUS - BASE_RADIUS)`) to drive
the translate/shadow. **When adding a new bar dataset, follow the existing pattern**:
`backgroundColor` normal, `hoverBackgroundColor: 'transparent'`, `hoverFillFn: <the old boosted
gradient the hover color used to be>` (a plain function stored directly on the dataset — not a
real Chart.js option key, so `barHoverBouncePlugin` just reads it straight off
`chart.data.datasets[i]` rather than through the animated-options system), `borderRadius:
hoverBorderRadius()`, and add `barHoverBouncePlugin` to that chart's `plugins: [...]` array
(after `volumeShadowPlugin`, before any label-drawing plugin) — skipping any one of these
either leaves a visible ghost of the old un-lifted bar behind, or gives that one chart no bounce
at all.

**Hover tooltips show only the bare number, nothing else.** Tooltips were disabled entirely at
one point (`plugins.tooltip = { enabled: false }` everywhere, on request), then brought back
but deliberately stripped down rather than restored to Chart.js's default — the default tooltip
repeats the category/day label (already on the axis) and the dataset name (already in the
legend or the companion table), which is exactly the clutter that got them turned off in the
first place. `numberOnlyTooltip(p)` (shared by `baseChartOptions` and `donutChart`, so every
chart gets it uniformly) overrides `callbacks.title` to return `''` and `callbacks.label` to
return only `ctx.formattedValue`, with `displayColors: false` (no color swatch) and a small
themed bubble (`backgroundColor: p.textPrimary`, `bodyColor: p.surface` — inverted so it reads
in both themes). The companion `renderTable`/`card__table` next to every chart still carries
the full label+percent breakdown; the tooltip's only job is confirming the exact number under
the cursor. **Don't add back a `label` callback that prepends the dataset name or a `title`
callback that shows the category** — that regresses to the clutter this was built to avoid;
if a chart needs more context than a bare number, that belongs in its table, not the tooltip.

**По отделам draws its labels inside the bars, not in a separate table.** It went through a
donut phase (fixed ~220px regardless of department count) and back — a pie reads department
share fine but the user wanted the bar chart back, just without the height problem. The fix
wasn't the chart type, it was `card__table`: `renderDeptChart` has no companion table at all
now, so there's nothing to add height on top of the chart. Instead, `barInlineLabelsPlugin`
(a `afterDatasetsDraw` plugin, registered alongside `volumeShadowPlugin`) draws each bar's own
`"Отдел — N"` label *inside* the bar in white, measuring the text against the bar's rendered
length and falling back to drawing it just past the bar's end in the normal text color when the
bar's too short to hold it — so the y-axis ticks are turned off (`ticks: { display: false }`)
without losing the department names. `sizeCategoryChartBody` still sizes the body by department
count (smaller constants than before, since there's no table to budget height against), so the
card is short with 3 departments and still readable with 20.

**`#card-dept { align-self: start; }`** — CSS Grid's default `align-items: stretch` fills every
item in a row to match its tallest row-mate, which defeated the height fix above: the *content*
got shorter but the grid still stretched the card to match "Голосование по дням"/"Способ
голосования" next to it, so it looked exactly as tall as before. `align-self: start` opts this
one card out of that stretch so it actually sizes to its own (now short) content, leaving open
grid space below it in that row. If a future redesign shortens another small card's content,
it needs the same treatment or it'll silently stay stretched.

**Category count still drives chart height for the instructor chart.**
`sizeCategoryChartBody(canvasId, count, opts)` sets the `.card__body`'s height in JS (before
the `new Chart(...)` call, since Chart.js reads the container size at construction) as
`padding + count * (perRow * groupSize + gap)`, clamped to `[min, max]` — beyond `max` the body
switches to `card__body--scroll` (`overflow-y: auto`) instead of growing forever. Dept
(`groupSize: 1`) and `renderInstructorChart` (`groupSize: 1`, see next) call this on every
render so both stay readable at any category count; days/format have a fixed known category
count and don't need it.

**Instructor load is one stacked bar per instructor, not two side-by-side ones.** It used to
draw "всего закреплено" and "проголосовало" as two separate bars per instructor and was still
reported unreadable/cramped even after the height fix — the real problem was two bars per row,
not row height. `renderInstructorChart` now stacks "Проголосовало" + "Не проголосовало"
(`scales.x.stacked`/`scales.y.stacked: true`) so each instructor is a single bar whose split
shows the turnout proportion directly, at half the vertical cost. `byInstructor` entries in
`stats.js` carry `notVotedRows` (`rows.filter(r => !r.voted)`) alongside `rows`/`votedRows` for
this dataset's drill-down.

**No more ДО-specific charts or KPI tiles — that information now lives entirely behind the
scope filter.** The dashboard used to carry four decree-specific visualizations (a "Декретный
отпуск" donut, a "Явка сотрудников в ДО" donut, a "ДО: способ голосования" donut, and a
"Не проголосовали" donut splitting ДО vs "ЧКЭ") plus two decree-specific KPI tiles ("В
декретном отпуске", "Явка среди ДО"). All of that was removed: `computeStats` no longer
computes `dekret`/`dekretTurnout`/`dekretFormat`, and `notVoted` was simplified down to a
plain `{ count, pct, rows }` (used only by KPI card 4 now — it no longer carries a ДО/`other`
split). To see decree-specific numbers now, select "ДО" in the Категория KPI tile — every
remaining chart and KPI recomputes against that scoped row set instead of needing its own
dedicated ДО chart. **Don't add a new decree-specific chart/KPI back** — extend the scope
filter's reach instead (e.g. a new stat in `computeStats` any chart can read, scoped for free
via `getFilteredRows()`/`getScopedRows()`).

**Bento grid balance:** the `.card--1`…`.card--4` hero-palette classes cycle in DOM order
across *all* chart cards (currently 3 small + 3 wide = 6) in their current order, not
per-section — so adding, removing, or reordering a card shifts every color after it; re-derive
the sequence rather than picking a color ad hoc. Small-card count should stay a multiple of
the grid's column count at the widest breakpoint (3, via `.chart-grid`'s `repeat(auto-fit,
minmax(340px, 1fr))`) so a full row never leaves a lone card next to dead space — if a new stat
card unbalances the count, either add a second one to get back to a multiple of 3, or promote
it to `.card--wide` with a `.card__panel--split` layout (see next) instead. Wide cards
(`.card--wide { grid-column: 1 / -1; }`) always take a full row each regardless of count, so
their number alone never causes a balance problem.

**`.card__panel--split`:** for a wide card built around a single donut — none of the current
wide cards are (they're all bar charts, which already fill the width on their own), so this
modifier is currently unused CSS, kept for the next one — the chart doesn't need to stack above
a mostly-empty-width table. This modifier lays the panel out as a row (fixed-width chart, table
filling the rest, vertically centered), falling back to the normal stacked column under 640px.
Only donuts in wide cards
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
