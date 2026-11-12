export type Theme = 'system' | 'light' | 'dark';

export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem('pms-theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme: Theme) {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('pms-theme', theme); } catch { /* privater Modus */ }
}
