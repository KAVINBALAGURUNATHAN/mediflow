import { createContext, useContext, useEffect } from 'react';

const ThemeContext = createContext(null);

// Queue Cure's application is light-only, corporate/clinical design -
// there is no dark mode toggle anywhere in the UI. This provider still
// exists (rather than deleting it and every dark: Tailwind class across the
// codebase in one pass) so `dark:` variants harmlessly never activate,
// without requiring a mechanical strip of every dark: className in every
// file right now.
export function ThemeProvider({ children }) {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark');
    root.classList.add('light');
  }, []);

  return (
    <ThemeContext.Provider value={{ theme: 'light', isDark: false }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
