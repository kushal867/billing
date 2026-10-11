"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";
import { useT } from "@/lib/i18n/client";

/** Confirmation dialog for destructive actions. Optionally collects a reason that is stored in the audit trail. */
export function ConfirmAction({
  trigger, title, description, confirmLabel, requireReason, destructive = true, onConfirm, onDone,
}: {
  trigger: React.ReactNode; title: string; description: React.ReactNode; confirmLabel: string; requireReason?: boolean; destructive?: boolean;
  onConfirm: (reason: string) => Promise<ActionResult<unknown>>; onDone?: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const submit = () =>
    start(async () => {
      const res = await onConfirm(reason);
      if (res.ok) {
        setOpen(false);
        setReason("");
        setError("");
        onDone?.();
      } else {
        setError(t(res.fieldErrors?.reason ?? res.error));
        toast.error(res.error);
      }
    });

  return (
    <AlertDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setError(""); }}>
      <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogTitle>{t(title)}</AlertDialogTitle>
        <AlertDialogDescription asChild><div>{typeof description === "string" ? t(description) : description}</div></AlertDialogDescription>
        {requireReason && (
          <div className="space-y-1.5">
            <label htmlFor="reason" className="text-sm font-medium">{t("Reason (kept in the history)")}</label>
            <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} invalid={!!error} rows={2} />
          </div>
        )}
        {error && <p role="alert" className="text-sm text-expense">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>{t("Cancel")}</Button>
          <Button variant={destructive ? "destructive" : "default"} loading={pending} onClick={submit} disabled={requireReason && reason.trim().length < 3}>{t(confirmLabel)}</Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
