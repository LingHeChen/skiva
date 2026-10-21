import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { docs, getDocs, docHref, parseDocPath } from "@/content/docs";
import { Documentation } from "@/components/documentation";
import { LocaleProvider } from "@/lib/i18n";
import "../docs.css";
type Props = { params: Promise<{ slug?: string[] }> };
export function generateStaticParams() {
  return ["en", "zh"].flatMap((locale) =>
    docs.map((doc) => ({
      slug: [
        ...(locale === "zh" ? ["zh"] : []),
        ...(doc.slug ? [doc.slug] : []),
      ],
    })),
  );
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = parseDocPath((await params).slug);
  const doc = getDocs(locale).find((item) => item.slug === slug);
  const prefix =
    process.env.NEXT_PUBLIC_DOCS_ONLY === "true"
      ? "https://linghechen.github.io/skiva"
      : "";
  return {
    title: doc
      ? `${doc.title} · Skiva ${locale === "zh" ? "文档" : "Docs"}`
      : "Page not found · Skiva",
    description: doc?.description,
    alternates: {
      languages: {
        en: prefix + docHref(slug, "en"),
        "zh-CN": prefix + docHref(slug, "zh"),
      },
    },
  };
}
export default async function Page({ params }: Props) {
  const { locale, slug } = parseDocPath((await params).slug);
  if (!getDocs(locale).some((doc) => doc.slug === slug)) notFound();
  return (
    <LocaleProvider fixedLocale={locale}>
      <Documentation key={`${locale}/${slug}`} slug={slug} />
    </LocaleProvider>
  );
}
