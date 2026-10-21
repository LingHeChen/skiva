import "./globals.css";
import { LocaleProvider } from "@/lib/i18n";
import type { Metadata } from "next";
export const metadata: Metadata = {
  title: "Skiva · Enterprise Skills",
  description: "Git-backed Skills management and delivery for Agents",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <LocaleProvider>{children}</LocaleProvider>
      </body>
    </html>
  );
}
