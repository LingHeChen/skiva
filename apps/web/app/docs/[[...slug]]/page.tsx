import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { docs } from "@/content/docs";
import { Documentation } from "@/components/documentation";
import "../docs.css";

type Props = { params: Promise<{ slug?: string[] }> };
export function generateStaticParams() {
  return docs.map((doc) => ({ slug: doc.slug ? [doc.slug] : [] }));
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug?.join("/") || "";
  const doc = docs.find((item) => item.slug === slug);
  return {
    title: doc ? `${doc.title} · ESDP 文档` : "文档未找到 · ESDP",
    description: doc?.description,
  };
}
export default async function Page({ params }: Props) {
  const slug = (await params).slug?.join("/") || "";
  if (!docs.some((doc) => doc.slug === slug)) notFound();
  return <Documentation key={slug} slug={slug} />;
}
