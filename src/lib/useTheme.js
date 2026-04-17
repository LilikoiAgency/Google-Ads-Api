import { useState, useEffect } from 'react';

const THEME_KEY = 'lik-theme';

/**
 * Persists and exposes the current UI theme ('dark' | 'light').
 * Reads from localStorage synchronously via lazy initializer — no flash on remount.
 * Writes to localStorage on every change.
 * Default: 'light'.
 */
export function useTheme() {
  const [theme, setTheme] = useState(() => {
    // typeof window check keeps SSR safe (server always gets the default)
    if (typeof window === 'undefined') return 'light';
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'light';
  });

  // Persist on change and apply to document root for CSS targeting
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggleTheme };
}
