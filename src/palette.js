// Reference palette from the dataviz skill (validated categorical order, status colors).
const PALETTE = {
  light: {
    surface: '#fcfcfb',
    page: '#f9f9f7',
    textPrimary: '#0b0b0b',
    textSecondary: '#52514e',
    muted: '#898781',
    grid: '#e1e0d9',
    baseline: '#c3c2b7',
    border: 'rgba(11,11,11,0.10)',
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#d03b3b',
    categorical: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  },
  // "Анализатор" dark theme (graphite/navy #202633 + teal accent #3FD0D8),
  // ported in wholesale for surface/text/grid tokens — these must stay
  // numerically identical to style.css's dark blocks (mirrored, see
  // CLAUDE.md). good/warning/serious/critical/categorical are left alone:
  // that's the dataviz skill's validated, CVD-safe status/series palette,
  // a separate system from UI chrome and untouched by this reskin.
  dark: {
    surface: '#272e38',
    page: '#202633',
    textPrimary: '#f5f5f7',
    textSecondary: '#a1a1a6',
    muted: '#9a9aa0',
    grid: 'rgba(255,255,255,0.08)',
    baseline: 'rgba(255,255,255,0.22)',
    border: 'rgba(255,255,255,0.14)',
    good: '#0ca30c',
    warning: '#fab219',
    serious: '#ec835a',
    critical: '#e66767',
    categorical: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  },
};

function currentThemeMode() {
  const stamp = document.documentElement.getAttribute('data-theme');
  if (stamp === 'light' || stamp === 'dark') return stamp;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function currentPalette() {
  return PALETTE[currentThemeMode()];
}

// Fixed-order categorical color for a given index; overflow folds into a muted "other" slot.
function categoricalColor(index, mode) {
  const p = PALETTE[mode || currentThemeMode()];
  if (index < p.categorical.length) return p.categorical[index];
  return p.muted;
}
