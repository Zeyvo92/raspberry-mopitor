import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * "system" follows the reader's OS setting; the two explicit choices pin the
 * interface. Whatever the choice, the *resolved* theme is written to
 * <html data-theme>, which is the only thing the stylesheet keys off.
 */
export type ThemeChoice = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const THEME_CHOICES: readonly ThemeChoice[] = ["system", "light", "dark"];

const STORAGE_KEY = "mopitor.theme";
const LIGHT_QUERY = "(prefers-color-scheme: light)";

function isChoice(value: string | null): value is ThemeChoice {
  return value === "system" || value === "light" || value === "dark";
}

function storedChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isChoice(stored)) return stored;
  } catch {
    // private mode / storage disabled — follow the system this session
  }
  return "system";
}

/** dark unless the browser says otherwise: the dashboard is a night-time tool */
function systemTheme(): ResolvedTheme {
  return window.matchMedia?.(LIGHT_QUERY).matches ? "light" : "dark";
}

interface ThemeApi {
  choice: ThemeChoice;
  setChoice: (choice: ThemeChoice) => void;
  theme: ResolvedTheme;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(storedChoice);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const query = window.matchMedia?.(LIGHT_QUERY);
    // no matchMedia at all, or a MediaQueryList without the listener API
    // (Safari before 14): the theme simply stops following the system
    if (typeof query?.addEventListener !== "function") return;
    const onChange = (event: MediaQueryListEvent) =>
      setSystem(event.matches ? "light" : "dark");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  const theme = choice === "system" ? system : choice;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    // scrollbars, form controls and the browser's own chrome follow along
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not persisting is fine, the choice still applies to this session
    }
  }, []);

  const value = useMemo<ThemeApi>(
    () => ({ choice, setChoice, theme }),
    [choice, setChoice, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside <ThemeProvider>");
  return context;
}
