"use client";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RotateCcw, Trash2 } from "lucide-react";
import { reverseEntry, voidEntry } from "@/actions/entries";
import { Button } from "@/components/ui/button";
import { ConfirmAction } from "@/components/confirm-action";
import { useT } from "@/lib/i18n/client";

export function EntryActions({ id, draft }: { id: string; draft?: boolean }) {
  const router = useRouter();
  const t = useT();
  return (
    <>
      {!draft && (
        <ConfirmAction
          trigger={<Button variant="outline"><RotateCcw className="h-4 w-4" aria-hidden /> {t("Reverse")}</Button>}
          title="Reverse this entry?"
          description="A new entry with the debit and credit swapped will be added today, so the balance returns to what it was. The original stays visible in the ledger."
          confirmLabel="Reverse entry"
          requireReason
          destructive={false}
          onConfirm={(reason) => reverseEntry(id, reason)}
          onDone={() => { toast.success(t("Entry reversed")); router.push("/ledger"); router.refresh(); }}
        />
      )}
      <ConfirmAction
        trigger={<Button variant="destructive"><Trash2 className="h-4 w-4" aria-hidden /> {t("Delete")}</Button>}
        title="Delete this entry?"
        description="The entry will be removed from the ledger, balances and reports. It is not erased from the database: the deletion and your reason are kept in the history."
        confirmLabel="Delete entry"
        requireReason
        onConfirm={(reason) => voidEntry(id, reason)}
        onDone={() => { toast.success(t("Entry deleted")); router.push("/ledger"); router.refresh(); }}
      />
    </>
  );
}
