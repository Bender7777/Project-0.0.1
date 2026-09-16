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

**Service worker cache list:** `sw.js` precaches an explicit `APP_SHELL` file list. Any new
file added under `src/`, `vendor/`, or `icons/` that the app needs offline must be added to
that list, and `CACHE_NAME` bumped so returning clients pick up the change.

**Expected Excel columns** (header text, any order): `Отдел`, `Фамилия, Имя, Отчество`,
`Таб.№`, `SAP таб`, `Декрет`, `Инструктор`, `Факт выполнения`, `ДАТА`, `ДЭГ/ОЧНО`. `Декрет`
is treated as boolean (`ДО` vs blank), `Факт выполнения` as boolean (`Да` vs blank), and
`ДЭГ/ОЧНО` as the voting method of whoever has `Факт выполнения = Да`.
