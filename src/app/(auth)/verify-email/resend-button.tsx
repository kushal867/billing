"use client";
import { useState, useTransition } from "react";
import { resendVerification } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

export function ResendButton() {
  const t = useT();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="space-y-2">
      <Button type="button" variant="outline" className="w-full" loading={pending} onClick={() => start(async () => {
        const r = await resendVerification();
        setMsg(r.ok ? { ok: true, text: t("Email sent. Please check your inbox (and spam folder).") } : { ok: false, text: t(r.error ?? "Something went wrong. Please try again.") });
      })}>{t("Send the email again")}</Button>
      {msg && <p role="status" className={msg.ok ? "text-sm text-income" : "text-sm text-expense"}>{msg.text}</p>}
    </div>
  );
}
