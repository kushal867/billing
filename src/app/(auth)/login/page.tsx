import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { signupEnabled } from "@/lib/services/signup";
import { getT } from "@/lib/i18n/server";
import { LanguageToggle } from "@/components/language-toggle";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const { t } = await getT();
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-xl font-bold text-white">K</div>
          <h1 className="text-2xl font-semibold text-navy">KusBill</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("Your Bills. Your Balance. Automatically.")}</p>
        </div>
        <LoginForm next={next} />
        <div className="flex justify-center"><LanguageToggle /></div>
        {signupEnabled() && (
          <p className="text-center text-sm text-muted-foreground">{t("New here?")} <Link href="/signup" className="font-medium text-primary hover:underline">{t("Create an account")}</Link></p>
        )}
      </div>
    </main>
  );
}
