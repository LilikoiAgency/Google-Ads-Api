import { useState, useEffect } from 'react';

const THEME_KEY = 'lik-theme';

/**
 * Persists and exposes the current UI theme ('dark' | 'light').
 * Reads from localStorage on mount, writes on every change.
 */
export function useTheme() {
  const [theme, setTheme] = useState('dark');

  // Read saved preference on mount
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);

  // Persist on change
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggleTheme };
}
