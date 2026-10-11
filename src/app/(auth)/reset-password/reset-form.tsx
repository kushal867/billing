"use client";
import { useActionState } from "react";
import { resetPassword } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { useT } from "@/lib/i18n/client";

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, undefined);
  const t = useT();
  const e = state?.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
      {state?.error && <Alert tone="error">{t(state.error)}</Alert>}
      <input type="hidden" name="token" value={token} />
      <Field label={t("New password")} htmlFor="password" error={e.password && t(e.password)} hint={t("At least 8 characters with letters and numbers")}><Input id="password" name="password" type="password" autoComplete="new-password" autoFocus required /></Field>
      <Field label={t("Confirm password")} htmlFor="confirm" error={e.confirm && t(e.confirm)}><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>{t("Save new password")}</Button>
    </form>
  );
}
