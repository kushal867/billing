import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/server";
import { verifyEmailToken } from "@/lib/services/auth-tokens";
import { verificationRequired } from "@/lib/mail";
import { getT } from "@/lib/i18n/server";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LanguageToggle } from "@/components/language-toggle";
import { ResendButton } from "./resend-button";
import { logout } from "@/actions/auth";

export const metadata: Metadata = { title: "Verify your email" };
export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const { t } = await getT();
  const user = await getSessionUser();

  let body: React.ReactNode;
  if (token) {
    const r = await verifyEmailToken(token);
    body = r.ok ? (
      <div className="space-y-4">
        <Alert tone="success" title={t("Email verified")}>{t("Thank you. Your email address is confirmed.")}</Alert>
        <Button asChild className="w-full" size="lg"><Link href={user ? "/welcome" : "/login"}>{user ? t("Continue") : t("Sign in")}</Link></Button>
      </div>
    ) : (
      <div className="space-y-4">
        <Alert tone="error" title={t("This link cannot be used")}>{t("It has expired or was already used. Sign in and ask for a new email.")}</Alert>
        <Button asChild variant="outline" className="w-full"><Link href={user ? "/verify-email" : "/login"}>{t(user ? "Send me a new email" : "Sign in")}</Link></Button>
      </div>
    );
  } else if (!user) {
    redirect("/login");
  } else if (user.emailVerified || !verificationRequired()) {
    redirect("/dashboard");
  } else {
    body = (
      <div className="space-y-4">
        <Alert tone="info" title={t("Check your email")}>{t("We sent a link to {email}. Open it to start using KusBill.", { email: user.email })}</Alert>
        <ResendButton />
        <form action={logout}><Button type="submit" variant="ghost" className="w-full">{t("Sign out")}</Button></form>
      </div>
    );
  }
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-xl font-bold text-white">K</div>
          <h1 className="text-2xl font-semibold text-navy">{t("Verify your email")}</h1>
        </div>
        {body}
        <div className="flex justify-center"><LanguageToggle /></div>
      </div>
    </main>
  );
}
