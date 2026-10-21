"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import messages from "./en.json";
import chinese from "./zh.json";
export type Locale = "en" | "zh";
export type Translate = (
  key: string,
  values?: Record<string, string | number>,
) => string;
export function translate(
  locale: Locale,
  key: string,
  values: Record<string, string | number> = {},
) {
  const text =
    locale === "en"
      ? ((messages as Record<string, string>)[key] ?? key)
      : ((chinese as Record<string, string>)[key] ?? key);
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    String(values[name] ?? match),
  );
}
const Context = createContext({
  locale: "en" as Locale,
  setLocale: (_locale: Locale) => {
    void _locale;
  },
  t: ((key, values) => translate("en", key, values)) as Translate,
});
export function LocaleProvider({
  children,
  fixedLocale,
}: {
  children: ReactNode;
  fixedLocale?: Locale;
}) {
  const pathname = usePathname();
  const [selected, setSelected] = useState<Locale>(fixedLocale ?? "en");
  const locale = fixedLocale ?? selected;
  useEffect(() => {
    if (fixedLocale) return;
    const path = window.location.pathname;
    const docsRoute =
      /\/docs(?:\/|$)/.test(path) ||
      process.env.NEXT_PUBLIC_DOCS_ONLY === "true";
    const initial = docsRoute
      ? /\/docs\/zh(?:\/|$)/.test(path)
        ? "zh"
        : "en"
      : localStorage.getItem("skiva-locale") === "zh"
        ? "zh"
        : "en";
    setSelected(initial);
  }, [fixedLocale, pathname]);
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  const setLocale = useCallback((value: Locale) => {
    localStorage.setItem("skiva-locale", value);
    setSelected(value);
  }, []);
  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t: ((key, values) => translate(locale, key, values)) as Translate,
    }),
    [locale, setLocale],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useI18n() {
  return useContext(Context);
}
export function LanguageSwitch() {
  const { locale, setLocale } = useI18n();
  return (
    <button
      type="button"
      className="language-switch"
      aria-label={locale === "en" ? "Switch to Chinese" : "切换为英文"}
      onClick={() => setLocale(locale === "en" ? "zh" : "en")}
    >
      {locale === "en" ? "中文" : "EN"}
    </button>
  );
}
