import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { LangProvider } from "@/lib/i18n/client";
import { getLang } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: { default: "KusBill", template: "%s | KusBill" },
  description: "Your Bills. Your Balance. Automatically.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await getLang();
  return (
    <html lang={lang}>
      <body>
        <LangProvider lang={lang}>{children}</LangProvider>
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
