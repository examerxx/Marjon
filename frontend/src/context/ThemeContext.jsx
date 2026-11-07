import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState } from "react";

const ThemeContext = createContext(null);
const STORAGE_KEY = "marjon_theme";
const isTheme = value => value === "light" || value === "dark";

function readTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // The switch still works when browser storage is unavailable.
  }
  return "light";
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readTheme);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Keep the in-memory preference for this session.
    }
  }, [theme]);

  useEffect(() => {
    function syncTheme(event) {
      if (event.storageArea !== localStorage) return;
      if (event.key === null || event.key === STORAGE_KEY) {
        setThemeState(isTheme(event.newValue) ? event.newValue : "light");
      }
    }
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  const setTheme = useCallback(next => {
    if (isTheme(next)) setThemeState(next);
  }, []);
  const toggle = useCallback(() => {
    setThemeState(current => current === "dark" ? "light" : "dark");
  }, []);
  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>");
  return context;
}
