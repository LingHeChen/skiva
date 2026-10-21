"use client";
import { useI18n } from "@/lib/i18n";

export default function ErrorPage({ reset }: { reset: () => void }) {
  const { t } = useI18n();

  return (
    <main className="standalone">
      <h1>{t("页面暂时无法加载")}</h1>
      <p>{t("请重试；若问题持续，请联系管理员。")}</p>
      <button onClick={reset}>{t("重新加载")}</button>
    </main>
  );
}
