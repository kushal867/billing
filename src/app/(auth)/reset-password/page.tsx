import type { Metadata } from "next";
import Link from "next/link";
import { ResetForm } from "./reset-form";
import { peekToken } from "@/lib/services/auth-tokens";
import { getT } from "@/lib/i18n/server";
import { Alert } from "@/components/ui/alert";
import { LanguageToggle } from "@/components/language-toggle";

export const metadata: Metadata = { title: "Choose a new password" };
export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  const { t } = await getT();
  const valid = !!(await peekToken(token, "RESET_PASSWORD"));
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-xl font-bold text-white">K</div>
          <h1 className="text-2xl font-semibold text-navy">{t("Choose a new password")}</h1>
        </div>
        {valid ? <ResetForm token={token} /> : (
          <div className="space-y-4">
            <Alert tone="error" title={t("This link cannot be used")}>{t("It has expired or was already used. Ask for a new one.")}</Alert>
            <p className="text-center"><Link href="/forgot-password" className="font-medium text-primary hover:underline">{t("Send me a new link")}</Link></p>
          </div>
        )}
        <div className="flex justify-center"><LanguageToggle /></div>
      </div>
    </main>
  );
}
