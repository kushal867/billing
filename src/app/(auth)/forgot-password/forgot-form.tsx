"use client";
import { useActionState } from "react";
import { forgotPassword } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { useT } from "@/lib/i18n/client";

export function ForgotForm() {
  const [state, action, pending] = useActionState(forgotPassword, undefined);
  const t = useT();
  if (state?.done) {
    return <Alert tone="success" title={t("Check your email")}>{t("If an account exists for that address, we have sent a link. It works for 1 hour.")}</Alert>;
  }
  return (
    <form action={action} className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
      {state?.error && <Alert tone="error">{t(state.error)}</Alert>}
      <Field label={t("Email")} htmlFor="email"><Input id="email" name="email" type="email" autoComplete="username" autoFocus required defaultValue={state?.email ?? ""} /></Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>{t("Send reset link")}</Button>
    </form>
  );
}
