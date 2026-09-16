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
  dark: {
    surface: '#1a1a19',
    page: '#0d0d0d',
    textPrimary: '#ffffff',
    textSecondary: '#c3c2b7',
    muted: '#898781',
    grid: '#2c2c2a',
    baseline: '#383835',
    border: 'rgba(255,255,255,0.10)',
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
