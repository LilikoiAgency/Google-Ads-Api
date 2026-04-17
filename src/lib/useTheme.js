import { useState, useEffect } from 'react';

const THEME_KEY = 'lik-theme';

export function useTheme() {
  // Always start with 'light' to match server render — avoids hydration mismatch.
  // After mount, sync the real value from localStorage.
  const [theme, setTheme] = useState('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    const initial = saved === 'dark' || saved === 'light' ? saved : 'light';
    setTheme(initial);
    document.documentElement.dataset.theme = initial;
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(THEME_KEY, theme);
    document.documentElement.dataset.theme = theme;
  }, [theme, mounted]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggleTheme };
}
