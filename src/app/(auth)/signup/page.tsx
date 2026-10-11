import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignupForm } from "./signup-form";
import { signupEnabled } from "@/lib/services/signup";
import { getT } from "@/lib/i18n/server";
import { LanguageToggle } from "@/components/language-toggle";

export const metadata: Metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (!signupEnabled()) redirect("/login");
  const { t } = await getT();
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-xl font-bold text-white">K</div>
          <h1 className="text-2xl font-semibold text-navy">{t("Create your KusBill account")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("Your Bills. Your Balance. Automatically.")}</p>
        </div>
        <SignupForm />
        <p className="text-center text-sm text-muted-foreground">{t("Already have an account?")} <Link href="/login" className="font-medium text-primary hover:underline">{t("Sign in")}</Link></p>
        <div className="flex justify-center"><LanguageToggle /></div>
      </div>
    </main>
  );
}
