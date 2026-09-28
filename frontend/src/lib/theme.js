import { useEffect, useState } from 'react';

export const THEMES = { LIGHT: 'light', DARK: 'dark' };
const STORAGE_KEY = 'cipher:theme';

export function readStored() {
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored === 'dark' || stored === 'light' ? stored : null;
}

export function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function currentTheme() {
  return document.documentElement.getAttribute('data-theme') || readStored() || systemTheme();
}

export function apply(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (theme === 'dark') {
    meta.setAttribute('content', '#16130f');
  } else {
    meta.setAttribute('content', '#f6f3ec');
  }
}

export function initTheme() {
  apply(readStored() || systemTheme());
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);

  useEffect(() => {
    apply(theme);
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const onChange = (event) => {
      const next = event.newValue;
      if (next === 'dark' || next === 'light') {
        apply(next);
        setTheme(next);
      }
    };
    window.addEventListener('storage', onChange);
    return () => window.removeEventListener('storage', onChange);
  }, []);

  return {
    theme,
    isDark: theme === 'dark',
    toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  };
}