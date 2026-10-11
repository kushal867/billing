import type { Metadata } from "next";
import Link from "next/link";
import { ForgotForm } from "./forgot-form";
import { getT } from "@/lib/i18n/server";
import { LanguageToggle } from "@/components/language-toggle";

export const metadata: Metadata = { title: "Forgot password" };
export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  const { t } = await getT();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-xl font-bold text-white">K</div>
          <h1 className="text-2xl font-semibold text-navy">{t("Forgot your password?")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("Enter your email and we will send you a link to choose a new one.")}</p>
        </div>
        <ForgotForm />
        <p className="text-center text-sm"><Link href="/login" className="font-medium text-primary hover:underline">{t("Back to sign in")}</Link></p>
        <div className="flex justify-center"><LanguageToggle /></div>
      </div>
    </main>
  );
}
