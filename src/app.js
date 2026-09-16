const STORAGE_KEY = 'voting-dashboard:last-dataset:v1';
const THEME_KEY = 'voting-dashboard:theme';

let currentStats = null;
let currentDeptStats = null;
let currentRows = [];
let excludedDepts = new Set();
let scopeFilter = 'all'; // 'all' | 'chke' | 'do'

const els = {
  fileInput: document.getElementById('file-input'),
  clearBtn: document.getElementById('clear-btn'),
  themeToggle: document.getElementById('theme-toggle'),
  emptyState: document.getElementById('empty-state'),
  dashboard: document.getElementById('dashboard'),
  subtitle: document.getElementById('subtitle'),
  fileMeta: document.getElementById('file-meta'),
  toast: document.getElementById('toast'),
  filterBar: document.getElementById('filter-bar'),
  deptDropdown: document.getElementById('dept-dropdown'),
  deptTrigger: document.getElementById('dept-dropdown-trigger'),
  deptLabel: document.getElementById('dept-dropdown-label'),
  deptPanel: document.getElementById('dept-dropdown-panel'),
  deptList: document.getElementById('dept-dropdown-list'),
  deptSelectAll: document.getElementById('dept-dropdown-select-all'),
  deptReset: document.getElementById('dept-dropdown-reset'),
  deptOk: document.getElementById('dept-dropdown-ok'),
  drilldownOverlay: document.getElementById('drilldown-overlay'),
  drilldownTitle: document.getElementById('drilldown-title'),
  drilldownCount: document.getElementById('drilldown-count'),
  drilldownTbody: document.getElementById('drilldown-tbody'),
  drilldownClose: document.getElementById('drilldown-close'),
  drilldownExport: document.getElementById('drilldown-export'),
};

const CHECK_ICON_SVG =
  '<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function showToast(message, isError) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  els.toast.style.background = isError ? 'var(--critical)' : 'var(--text-primary)';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    els.toast.hidden = true;
  }, 4000);
}

function serializeRows(rows) {
  return rows.map((r) => ({ ...r, date: r.date ? r.date.toISOString() : null }));
}

function deserializeRows(rows) {
  return rows.map((r) => ({ ...r, date: r.date ? new Date(r.date) : null }));
}

// --- Department filter -----------------------------------------------------
//
// Excel-style: opening the panel snapshots the applied `excludedDepts` into
// `pendingExcludedDepts`; checkboxes and the select-all/reset actions only
// edit that pending copy. Nothing is applied to the dashboard (and the panel
// never closes) until "Ок" commits it — closing any other way (outside
// click, Escape, re-clicking the trigger) just discards the pending edits.

let allDeptNames = [];
let pendingExcludedDepts = new Set();

// Scope ("Все"/"ЧКЭ"/"ДО") narrows currentRows before the department filter
// applies on top of it — the two combine, same as the CLAUDE.md data flow.
function getScopedRows() {
  if (scopeFilter === 'chke') return currentRows.filter((r) => !r.dekret);
  if (scopeFilter === 'do') return currentRows.filter((r) => r.dekret);
  return currentRows;
}

function getFilteredRows() {
  const scoped = getScopedRows();
  if (!excludedDepts.size) return scoped;
  return scoped.filter((r) => !excludedDepts.has(r.dept));
}

// The Все/ЧКЭ/ДО buttons live inside the "Категория" KPI tile
// (renderKPIs in charts.js), rebuilt on every refreshDashboard() — so
// there's no persistent DOM to keep in sync here, renderKPIs reads
// `scopeFilter` fresh each time it runs.
function setScope(scope) {
  if (scope === scopeFilter) return;
  scopeFilter = scope;
  refreshDashboard();
}

// Clicking a department bar in "По отделам" drives the same `excludedDepts`
// state as the dropdown filter above it — clicking the sole selected
// department again toggles back to showing every department.
function filterByDepartment(name) {
  const onlyThis = excludedDepts.size === allDeptNames.length - 1 && !excludedDepts.has(name);
  excludedDepts = onlyThis ? new Set() : new Set(allDeptNames.filter((d) => d !== name));
  refreshDashboard();
}

function updateDeptOkState() {
  els.deptOk.disabled = pendingExcludedDepts.size >= allDeptNames.length;
}

function syncDeptOptionVisuals() {
  for (const btn of els.deptList.children) {
    const checked = !pendingExcludedDepts.has(btn.dataset.dept);
    btn.classList.toggle('is-checked', checked);
    btn.setAttribute('aria-selected', String(checked));
  }
  updateDeptOkState();
}

function openDeptDropdown() {
  pendingExcludedDepts = new Set(excludedDepts);
  syncDeptOptionVisuals();
  els.deptDropdown.classList.add('is-open');
  els.deptPanel.hidden = false;
  els.deptTrigger.setAttribute('aria-expanded', 'true');
}

function closeDeptDropdown() {
  els.deptDropdown.classList.remove('is-open');
  els.deptPanel.hidden = true;
  els.deptTrigger.setAttribute('aria-expanded', 'false');
}

function toggleDeptDropdown() {
  if (els.deptPanel.hidden) openDeptDropdown();
  else closeDeptDropdown();
}

function applyDeptDropdown() {
  if (els.deptOk.disabled) return;
  excludedDepts = new Set(pendingExcludedDepts);
  closeDeptDropdown();
  refreshDashboard();
}

function deptOptionRow({ dept, count, checked }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dropdown__option' + (checked ? ' is-checked' : '');
  btn.setAttribute('role', 'option');
  btn.setAttribute('aria-selected', String(checked));
  btn.dataset.dept = dept;

  const check = document.createElement('span');
  check.className = 'dropdown__check';
  check.innerHTML = CHECK_ICON_SVG;
  btn.appendChild(check);

  const labelSpan = document.createElement('span');
  labelSpan.className = 'dropdown__option-label';
  labelSpan.textContent = dept;
  btn.appendChild(labelSpan);

  const countSpan = document.createElement('span');
  countSpan.className = 'dropdown__option-count';
  countSpan.textContent = count;
  btn.appendChild(countSpan);

  btn.addEventListener('click', () => {
    if (pendingExcludedDepts.has(dept)) pendingExcludedDepts.delete(dept);
    else pendingExcludedDepts.add(dept);
    const checkedNow = !pendingExcludedDepts.has(dept);
    btn.classList.toggle('is-checked', checkedNow);
    btn.setAttribute('aria-selected', String(checkedNow));
    updateDeptOkState();
  });

  return btn;
}

function renderDeptFilter() {
  const scoped = getScopedRows();
  const deptMap = new Map();
  for (const r of scoped) deptMap.set(r.dept, (deptMap.get(r.dept) || 0) + 1);
  const depts = [...deptMap.entries()].sort((a, b) => b[1] - a[1]);
  allDeptNames = depts.map(([dept]) => dept);

  if (depts.length < 2) {
    els.filterBar.hidden = true;
    closeDeptDropdown();
    return;
  }
  els.filterBar.hidden = false;

  const includedCount = depts.length - excludedDepts.size;
  if (excludedDepts.size === 0) {
    els.deptLabel.textContent = `Все отделы (${scoped.length})`;
  } else if (includedCount === 1) {
    els.deptLabel.textContent = depts.find(([d]) => !excludedDepts.has(d))[0];
  } else {
    els.deptLabel.textContent = `${includedCount} из ${depts.length} отделов`;
  }

  els.deptList.innerHTML = '';
  for (const [dept, count] of depts) {
    els.deptList.appendChild(deptOptionRow({ dept, count, checked: !excludedDepts.has(dept) }));
  }
}

// --- Rendering ---------------------------------------------------------

function refreshDashboard(meta) {
  const filtered = getFilteredRows();
  const stats = computeStats(filtered);
  const deptStats = computeStats(getScopedRows());
  currentStats = stats;
  currentDeptStats = deptStats;
  els.emptyState.hidden = true;
  els.dashboard.hidden = false;
  els.clearBtn.hidden = false;

  const noteParts = [];
  if (scopeFilter === 'chke') noteParts.push('ЧКЭ');
  else if (scopeFilter === 'do') noteParts.push('ДО');
  if (excludedDepts.size) noteParts.push(`отфильтровано из ${currentRows.length}`);
  const filterNote = noteParts.length ? ` (${noteParts.join(', ')})` : '';
  els.subtitle.textContent = `${stats.total} записей${filterNote} • обновлено ${new Date().toLocaleString('ru-RU')}`;
  if (meta) els.fileMeta.textContent = meta;

  renderDeptFilter();
  renderAllCharts(stats, deptStats);
}

async function handleFile(file) {
  try {
    const buffer = await file.arrayBuffer();
    const { rows, warnings } = parseWorkbook(buffer);
    currentRows = rows;
    excludedDepts = new Set();
    scopeFilter = 'all';
    refreshDashboard(`Файл: ${file.name} • ${rows.length} строк`);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ rows: serializeRows(rows), fileName: file.name, savedAt: Date.now() })
    );
    if (warnings.length) showToast(warnings.join(' '), true);
    else showToast('Файл успешно обработан.');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Не удалось обработать файл.', true);
  }
}

function restoreFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const { rows, fileName, savedAt } = JSON.parse(raw);
    currentRows = deserializeRows(rows);
    excludedDepts = new Set();
    scopeFilter = 'all';
    refreshDashboard(`Файл: ${fileName} • сохранено ${new Date(savedAt).toLocaleString('ru-RU')}`);
  } catch (err) {
    console.warn('Не удалось восстановить сохранённые данные', err);
  }
}

function clearData() {
  localStorage.removeItem(STORAGE_KEY);
  currentStats = null;
  currentDeptStats = null;
  currentRows = [];
  excludedDepts = new Set();
  scopeFilter = 'all';
  els.dashboard.hidden = true;
  els.emptyState.hidden = false;
  els.clearBtn.hidden = true;
  els.filterBar.hidden = true;
  closeDeptDropdown();
  closeDrilldown();
  els.subtitle.textContent = 'Загрузите Excel-файл, чтобы увидеть статистику';
  Object.keys(chartRegistry).forEach(destroyChart);
}

// --- Drill-down modal ----------------------------------------------------

let drilldownRows = [];
let drilldownTitle = '';

function formatDrilldownDate(row) {
  return row.date ? row.date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' }) : '—';
}

function openDrilldown(title, rows) {
  drilldownRows = rows || [];
  drilldownTitle = title;
  els.drilldownTitle.textContent = title;
  els.drilldownCount.textContent = `${drilldownRows.length} чел.`;
  els.drilldownTbody.innerHTML = '';
  drilldownRows.forEach((r, i) => {
    const tr = document.createElement('tr');
    [i + 1, r.fio, r.dept, r.tabNum ?? '', r.instructor, formatDrilldownDate(r), r.voted ? 'Да' : '—', r.format || '—'].forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    });
    els.drilldownTbody.appendChild(tr);
  });
  els.drilldownOverlay.hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeDrilldown() {
  els.drilldownOverlay.hidden = true;
  document.body.style.overflow = '';
}

function exportDrilldown() {
  if (!drilldownRows.length) return;
  const data = drilldownRows.map((r) => ({
    'Отдел': r.dept,
    'Фамилия, Имя, Отчество': r.fio,
    'Таб.№': r.tabNum ?? '',
    'SAP таб': r.sapNum ?? '',
    'Декрет': r.dekret ? 'ДО' : '',
    'Инструктор': r.instructor,
    'Факт выполнения': r.voted ? 'Да' : '',
    'ДАТА': formatDrilldownDate(r),
    'ДЭГ/ОЧНО': r.format || '',
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Список');
  const safeName = drilldownTitle.replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '') || 'spisok';
  XLSX.writeFile(wb, `${safeName}.xlsx`);
}

// --- Theme -------------------------------------------------------------

function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') {
    document.documentElement.setAttribute('data-theme', mode);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  if (currentStats) renderAllCharts(currentStats, currentDeptStats);
}

function toggleTheme() {
  const current = currentThemeMode();
  const next = current === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}

// --- Wiring --------------------------------------------------------------

els.fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFile(file);
  e.target.value = '';
});

els.clearBtn.addEventListener('click', clearData);
els.themeToggle.addEventListener('click', toggleTheme);

els.deptTrigger.addEventListener('click', toggleDeptDropdown);
els.deptSelectAll.addEventListener('click', () => {
  pendingExcludedDepts.clear();
  syncDeptOptionVisuals();
});
els.deptReset.addEventListener('click', () => {
  pendingExcludedDepts = new Set(allDeptNames);
  syncDeptOptionVisuals();
});
els.deptOk.addEventListener('click', applyDeptDropdown);
document.addEventListener('click', (e) => {
  if (!els.deptPanel.hidden && !els.deptDropdown.contains(e.target)) closeDeptDropdown();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !els.deptPanel.hidden) {
    closeDeptDropdown();
    els.deptTrigger.focus();
  }
  if (e.key === 'Escape' && !els.drilldownOverlay.hidden) closeDrilldown();
});

els.drilldownClose.addEventListener('click', closeDrilldown);
els.drilldownExport.addEventListener('click', exportDrilldown);
els.drilldownOverlay.addEventListener('click', (e) => {
  if (e.target === els.drilldownOverlay) closeDrilldown();
});

['dragover', 'dragenter'].forEach((evt) =>
  els.emptyState.addEventListener(evt, (e) => {
    e.preventDefault();
    els.emptyState.classList.add('drag-over');
  })
);
['dragleave', 'drop'].forEach((evt) =>
  els.emptyState.addEventListener(evt, (e) => {
    e.preventDefault();
    els.emptyState.classList.remove('drag-over');
  })
);
els.emptyState.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});

document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

const savedTheme = localStorage.getItem(THEME_KEY);
if (savedTheme) applyTheme(savedTheme);

restoreFromStorage();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}
