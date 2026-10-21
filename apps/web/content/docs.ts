import en from "./docs.en.json";
import zh from "./docs.zh.json";
import type { Locale } from "@/lib/i18n";
export type DocPage = {
  slug: string;
  title: string;
  description: string;
  group: string;
  body: string;
};
export const docs: DocPage[] = en;
export const getDocs = (locale: Locale): DocPage[] =>
  locale === "zh" ? zh : en;
export const docHref = (slug: string, locale: Locale = "en") =>
  `/docs${locale === "zh" ? "/zh" : ""}${slug ? `/${slug}` : ""}`;
export function parseDocPath(parts: string[] = []) {
  const locale: Locale = parts[0] === "zh" ? "zh" : "en";
  return { locale, slug: (locale === "zh" ? parts.slice(1) : parts).join("/") };
}
