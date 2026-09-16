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

**Service worker cache list:** `sw.js` precaches an explicit `APP_SHELL` file list. Any new
file added under `src/`, `vendor/`, or `icons/` that the app needs offline must be added to
that list, and `CACHE_NAME` bumped so returning clients pick up the change.

**Expected Excel columns** (header text, any order): `Отдел`, `Фамилия, Имя, Отчество`,
`Таб.№`, `SAP таб`, `Декрет`, `Инструктор`, `Факт выполнения`, `ДАТА`, `ДЭГ/ОЧНО`. `Декрет`
is treated as boolean (`ДО` vs blank), `Факт выполнения` as boolean (`Да` vs blank), and
`ДЭГ/ОЧНО` as the voting method of whoever has `Факт выполнения = Да`.
