"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCtx } from "@/lib/auth/server";
import { run } from "@/lib/action";
import { validation } from "@/lib/errors";
import { D, parseMoney, ZERO } from "@/lib/money";
import { parseEnteredDate } from "@/lib/dates";
import { createAccount, createCategory, createManualJournal, deleteManualJournal, setAccountActive, setSettlementAccount } from "@/lib/services/accounting";

const refresh = () => { revalidatePath("/accounts"); revalidatePath("/reports", "layout"); revalidatePath("/dashboard"); };
const types = z.enum(["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"]);

export async function addAccount(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const v = z.object({ code: z.string().trim().regex(/^[A-Za-z0-9-]{1,12}$/, "Use up to 12 letters, numbers or dashes"), name: z.string().trim().min(1, "Enter a name").max(80), type: types }).safeParse(input);
    if (!v.success) throw validation(v.error.issues[0].message);
    await createAccount(ctx, v.data);
    refresh();
  });
}

export async function toggleAccount(id: string, isActive: boolean) {
  return run(async () => { await setAccountActive(await requireCtx(), z.string().uuid().parse(id), isActive); refresh(); });
}

export async function addCategory(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const v = z.object({ name: z.string().trim().min(1, "Enter a name").max(60), kind: z.enum(["INCOME", "EXPENSE"]), accountId: z.string().uuid("Choose an account") }).safeParse(input);
    if (!v.success) throw validation(v.error.issues[0].message);
    await createCategory(ctx, v.data);
    refresh();
  });
}

export async function chooseSettlement(accountId: string) {
  return run(async () => { await setSettlementAccount(await requireCtx(), z.string().uuid().parse(accountId)); refresh(); });
}

export async function postJournal(input: { date: string; calendar: "BS" | "AD"; memo: string; reference?: string; lines: Array<{ accountId: string; debit: string; credit: string }> }) {
  return run(async () => {
    const ctx = await requireCtx();
    const date = parseEnteredDate(input.date, input.calendar);
    if (!date.ok) throw validation(date.error, { date: date.error });
    if (!input.memo.trim()) throw validation("Enter a short description", { memo: "Required" });
    const lines = input.lines.map((l, i) => {
      const debit = l.debit.trim() ? parseMoney(l.debit) : ZERO;
      const credit = l.credit.trim() ? parseMoney(l.credit) : ZERO;
      if (debit === null || credit === null) throw validation(`Line ${i + 1}: enter a valid amount`);
      if (!z.string().uuid().safeParse(l.accountId).success) throw validation(`Line ${i + 1}: choose an account`);
      return { accountId: l.accountId, debit: D(debit), credit: D(credit) };
    });
    await createManualJournal(ctx, { date: date.iso, memo: input.memo.trim().slice(0, 200), reference: (input.reference ?? "").slice(0, 40), lines });
    refresh();
  });
}

export async function removeJournal(id: string) {
  return run(async () => { await deleteManualJournal(await requireCtx(), z.string().uuid().parse(id)); refresh(); });
}
