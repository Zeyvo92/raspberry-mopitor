import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en, type TranslationKey } from "./en";
import { fr } from "./fr";

const dictionaries = { en, fr };

export type Lang = keyof typeof dictionaries;
export const LANGS = Object.keys(dictionaries) as Lang[];

export const LANG_LABELS: Record<Lang, string> = {
  en: "English",
  fr: "Français",
};

const STORAGE_KEY = "mopitor.lang";

function isLang(value: string | null | undefined): value is Lang {
  return value === "en" || value === "fr";
}

/** stored choice first, then the browser's preference, then English */
function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLang(stored)) return stored;
  } catch {
    // private mode / storage disabled — fall through to the browser locale
  }
  const browser = navigator.language.slice(0, 2).toLowerCase();
  return isLang(browser) ? browser : "en";
}

/** replaces {placeholders} — plain string interpolation, no plural rules needed yet */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match,
  );
}

export type Translate = (
  key: TranslationKey,
  vars?: Record<string, string | number>,
) => string;

interface I18n {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** BCP 47 tag for Intl (dates, numbers) */
  locale: string;
  t: Translate;
}

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // not persisting is fine, the choice still applies to this session
    }
  }, []);

  const value = useMemo<I18n>(() => {
    const dictionary = dictionaries[lang];
    return {
      lang,
      setLang,
      locale: lang === "fr" ? "fr-FR" : "en-GB",
      t: (key, vars) => interpolate(dictionary[key], vars),
    };
  }, [lang, setLang]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18n {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside <I18nProvider>");
  return context;
}

export type { TranslationKey };
