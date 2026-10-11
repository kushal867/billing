"use client";
import { useActionState } from "react";
import { signup } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { useT } from "@/lib/i18n/client";

export function SignupForm() {
  const [state, action, pending] = useActionState(signup, undefined);
  const t = useT();
  const e = state?.fieldErrors ?? {};
  const v = state?.values;
  return (
    <form action={action} className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
      {state?.error && <Alert tone="error">{t(state.error)}</Alert>}
      <Field label={t("Your name")} htmlFor="name" error={e.name && t(e.name)}><Input id="name" name="name" autoComplete="name" autoFocus required defaultValue={v?.name ?? ""} /></Field>
      <Field label={t("Business name (optional)")} htmlFor="businessName"><Input id="businessName" name="businessName" autoComplete="organization" defaultValue={v?.businessName ?? ""} /></Field>
      <Field label={t("Email")} htmlFor="email" error={e.email && t(e.email)}><Input id="email" name="email" type="email" autoComplete="username" required defaultValue={v?.email ?? ""} /></Field>
      <Field label={t("Password")} htmlFor="password" error={e.password && t(e.password)} hint={t("At least 8 characters with letters and numbers")}><Input id="password" name="password" type="password" autoComplete="new-password" required /></Field>
      <Field label={t("Confirm password")} htmlFor="confirm" error={e.confirm && t(e.confirm)}><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>{t("Create account")}</Button>
    </form>
  );
}
