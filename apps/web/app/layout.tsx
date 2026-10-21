import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "ESDP · Enterprise Skills",
  description: "企业 Skills 发布与分发控制台",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
