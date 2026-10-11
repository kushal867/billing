"use server";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/lib/auth/server";
import { run } from "@/lib/action";
import { createTransaction, reverseTransaction, suggestNextBillNumber, updateTransaction, voidTransaction, type DuplicateInfo } from "@/lib/services/transactions";

export type SaveOutcome =
  | { status: "saved"; id: string; billNumber: string; warnings: string[]; nextBill: string; alreadySaved?: boolean }
  | { status: "duplicate"; duplicates: DuplicateInfo };

function refresh() {
  for (const p of ["/dashboard", "/ledger", "/reports", "/entries/new"]) revalidatePath(p);
}

export async function saveEntry(input: unknown) {
  return run<SaveOutcome>(async () => {
    const ctx = await requireCtx();
    const r = await createTransaction(ctx, input);
    if (r.status === "duplicate") return r;
    refresh();
    return { status: "saved", id: r.transaction.id, billNumber: r.transaction.billNumber, warnings: r.warnings, nextBill: await suggestNextBillNumber(ctx), alreadySaved: r.alreadySaved };
  });
}

export async function updateEntry(id: string, version: number, input: unknown) {
  return run<SaveOutcome>(async () => {
    const ctx = await requireCtx();
    const r = await updateTransaction(ctx, id, input, version);
    if (r.status === "duplicate") return r;
    refresh();
    revalidatePath(`/entries/${id}`);
    return { status: "saved", id: r.transaction.id, billNumber: r.transaction.billNumber, warnings: r.warnings, nextBill: "" };
  });
}

export async function voidEntry(id: string, reason: string) {
  return run(async () => {
    const ctx = await requireCtx();
    await voidTransaction(ctx, id, reason);
    refresh();
    revalidatePath(`/entries/${id}`);
  });
}

export async function reverseEntry(id: string, reason: string) {
  return run(async () => {
    const ctx = await requireCtx();
    const rev = await reverseTransaction(ctx, id, reason);
    refresh();
    return { id: rev.id };
  });
}
