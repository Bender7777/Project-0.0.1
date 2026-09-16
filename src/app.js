const STORAGE_KEY = 'voting-dashboard:last-dataset:v1';
const THEME_KEY = 'voting-dashboard:theme';

let currentStats = null;
let currentRows = [];
let excludedDepts = new Set();

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
  deptChips: document.getElementById('dept-filter-chips'),
};

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

function getFilteredRows() {
  if (!excludedDepts.size) return currentRows;
  return currentRows.filter((r) => !excludedDepts.has(r.dept));
}

function chipButton({ label, count, active, dashed }) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chip' + (active ? ' is-active' : '') + (dashed ? ' chip--all' : '');
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  btn.appendChild(labelSpan);
  if (count != null) {
    const countSpan = document.createElement('span');
    countSpan.className = 'chip__count';
    countSpan.textContent = count;
    btn.appendChild(countSpan);
  }
  return btn;
}

function renderDeptFilter() {
  const deptMap = new Map();
  for (const r of currentRows) deptMap.set(r.dept, (deptMap.get(r.dept) || 0) + 1);
  const depts = [...deptMap.entries()].sort((a, b) => b[1] - a[1]);

  if (depts.length < 2) {
    els.filterBar.hidden = true;
    return;
  }
  els.filterBar.hidden = false;
  els.deptChips.innerHTML = '';

  const allChip = chipButton({ label: 'Все', count: currentRows.length, active: excludedDepts.size === 0, dashed: true });
  allChip.addEventListener('click', () => {
    excludedDepts.clear();
    refreshDashboard();
  });
  els.deptChips.appendChild(allChip);

  for (const [dept, count] of depts) {
    const active = !excludedDepts.has(dept);
    const chip = chipButton({ label: dept, count, active });
    chip.addEventListener('click', () => {
      if (active) {
        // Keep at least one department selected.
        if (excludedDepts.size >= depts.length - 1) return;
        excludedDepts.add(dept);
      } else {
        excludedDepts.delete(dept);
      }
      refreshDashboard();
    });
    els.deptChips.appendChild(chip);
  }
}

// --- Rendering ---------------------------------------------------------

function refreshDashboard(meta) {
  const filtered = getFilteredRows();
  const stats = computeStats(filtered);
  currentStats = stats;
  els.emptyState.hidden = true;
  els.dashboard.hidden = false;
  els.clearBtn.hidden = false;

  const filterNote = excludedDepts.size ? ` (отфильтровано из ${currentRows.length})` : '';
  els.subtitle.textContent = `${stats.total} записей${filterNote} • обновлено ${new Date().toLocaleString('ru-RU')}`;
  if (meta) els.fileMeta.textContent = meta;

  renderDeptFilter();
  renderAllCharts(stats);
}

async function handleFile(file) {
  try {
    const buffer = await file.arrayBuffer();
    const { rows, warnings } = parseWorkbook(buffer);
    currentRows = rows;
    excludedDepts = new Set();
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
    refreshDashboard(`Файл: ${fileName} • сохранено ${new Date(savedAt).toLocaleString('ru-RU')}`);
  } catch (err) {
    console.warn('Не удалось восстановить сохранённые данные', err);
  }
}

function clearData() {
  localStorage.removeItem(STORAGE_KEY);
  currentStats = null;
  currentRows = [];
  excludedDepts = new Set();
  els.dashboard.hidden = true;
  els.emptyState.hidden = false;
  els.clearBtn.hidden = true;
  els.filterBar.hidden = true;
  els.subtitle.textContent = 'Загрузите Excel-файл, чтобы увидеть статистику';
  Object.keys(chartRegistry).forEach(destroyChart);
}

// --- Theme -------------------------------------------------------------

function applyTheme(mode) {
  if (mode === 'light' || mode === 'dark') {
    document.documentElement.setAttribute('data-theme', mode);
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  if (currentStats) renderAllCharts(currentStats);
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
