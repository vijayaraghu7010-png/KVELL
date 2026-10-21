import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'kvcet:theme';
const THEME_EVENT = 'kvcet:theme-change';

/**
 * The stored choice. The institutional light theme is the default: dark is
 * opt-in, not inherited from the device, so everyone sees the same identity
 * until they choose otherwise.
 */
export function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* private mode — fall through to the default */
  }
  return 'light';
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

/**
 * Light/dark preference, kept on <html> as a `dark` class (see the dark theme
 * block in index.css) and remembered per browser.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Keep every mounted toggle in step when one of them flips the preference.
  useEffect(() => {
    const sync = () => setThemeState(readTheme());
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* preference is not persisted, but still applies for this session */
    }
    applyTheme(next);
    setThemeState(next);
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);

  const toggleTheme = useCallback(() => setTheme(readTheme() === 'dark' ? 'light' : 'dark'), [setTheme]);

  return { theme, setTheme, toggleTheme };
}
