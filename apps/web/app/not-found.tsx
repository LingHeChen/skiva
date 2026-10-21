"use client";
import { useI18n } from "@/lib/i18n";
import Link from "next/link";
export default function NotFound() {
  const { t } = useI18n();

  return (
    <main className="standalone">
      <p>404</p>
      <h1>{t("页面不存在")}</h1>
      <Link href="/dashboard">{t("返回概览")}</Link>
    </main>
  );
}
