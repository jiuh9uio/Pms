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

/** Animationen der Oberfläche: an (Standard) oder aus – je Gerät gespeichert. Die Geräteeinstellung „Bewegung reduzieren“ schaltet sie ebenfalls ab. */
export function storedMotion(): boolean {
  try { return localStorage.getItem('pms-motion') !== 'aus'; } catch { return true; }
}
export function applyMotion(on: boolean) {
  if (on) delete document.documentElement.dataset.motion; else document.documentElement.dataset.motion = 'off';
  try { localStorage.setItem('pms-motion', on ? 'an' : 'aus'); } catch { /* privater Modus */ }
}
