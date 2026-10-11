"use client";
import { useActionState } from "react";
import { login } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { useT } from "@/lib/i18n/client";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  const t = useT();
  return (
    <form action={action} className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
      {state?.error && <Alert tone="error">{t(state.error)}</Alert>}
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label={t("Email")} htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" autoFocus required defaultValue={state?.email ?? ""} />
      </Field>
      <Field label={t("Password")} htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <Button type="submit" className="w-full" size="lg" loading={pending}>{t("Sign in")}</Button>
    </form>
  );
}
