import type { Prisma, Transaction } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { assertWrite } from "@/lib/auth/context";
import { conflict, notFound, validation } from "@/lib/errors";
import { D, ZERO, type Decimal } from "@/lib/money";
import { fromIso, toIso } from "@/lib/dates";
import { audit, type Client } from "./audit";

const DEFAULT_ACCOUNTS = [
  { code: "1000", name: "Cash in Hand", type: "ASSET" },
  { code: "1100", name: "Bank", type: "ASSET" },
  { code: "2000", name: "Accounts Payable", type: "LIABILITY" },
  { code: "3000", name: "Owner's Capital", type: "EQUITY" },
  { code: "4000", name: "Sales Income", type: "INCOME" },
  { code: "4100", name: "Other Income", type: "INCOME" },
  { code: "5000", name: "Purchases", type: "EXPENSE" },
  { code: "5100", name: "Rent", type: "EXPENSE" },
  { code: "5200", name: "Salaries & Wages", type: "EXPENSE" },
  { code: "5300", name: "Utilities", type: "EXPENSE" },
  { code: "5900", name: "Other Expenses", type: "EXPENSE" },
] as const;

const DEFAULT_CATEGORIES = [
  { name: "Sales", kind: "INCOME", account: "4000" },
  { name: "Other Income", kind: "INCOME", account: "4100" },
  { name: "Purchases", kind: "EXPENSE", account: "5000" },
  { name: "Rent", kind: "EXPENSE", account: "5100" },
  { name: "Salaries", kind: "EXPENSE", account: "5200" },
  { name: "Utilities", kind: "EXPENSE", account: "5300" },
  { name: "Other Expenses", kind: "EXPENSE", account: "5900" },
] as const;

/** Creates the starter chart of accounts and categories (idempotent). */
export async function ensureDefaultChart(businessId: string) {
  for (const a of DEFAULT_ACCOUNTS) {
    await db.account.upsert({
      where: { businessId_code: { businessId, code: a.code } },
      create: { businessId, ...a },
      update: {},
    });
  }
  for (const c of DEFAULT_CATEGORIES) {
    const acct = await db.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code: c.account } } });
    await db.category.upsert({
      where: { businessId_name: { businessId, name: c.name } },
      create: { businessId, name: c.name, kind: c.kind, accountId: acct.id },
      update: {},
    });
  }
  const biz = await db.business.findUniqueOrThrow({ where: { id: businessId } });
  if (!biz.settlementAccountId) {
    const cash = await db.account.findUniqueOrThrow({ where: { businessId_code: { businessId, code: "1000" } } });
    await db.business.update({ where: { id: businessId }, data: { settlementAccountId: cash.id } });
  }
}

/**
 * Keeps the accounting journal in step with a billpad transaction.
 * A transaction produces a journal entry only when it is POSTED and has a category;
 * the recognised amount is the non-zero billpad amount (debit + credit).
 *   INCOME  category: Dr settlement account (cash/bank), Cr income account
 *   EXPENSE category: Dr expense account,               Cr settlement account
 * Uncategorised transactions are deliberately NOT treated as income or expense.
 */
export async function syncJournalForTransaction(tx: Prisma.TransactionClient, ctx: Pick<Ctx, "userId" | "businessId">, t: Transaction) {
  await tx.journalEntry.deleteMany({ where: { transactionId: t.id, businessId: ctx.businessId } });
  if (t.status !== "POSTED" || !t.categoryId) return;
  const [cat, biz] = await Promise.all([
    tx.category.findFirst({ where: { id: t.categoryId, businessId: ctx.businessId }, include: { account: true } }),
    tx.business.findUniqueOrThrow({ where: { id: ctx.businessId } }),
  ]);
  if (!cat || !biz.settlementAccountId) return;
  const amount = D(t.debitAmount).plus(t.creditAmount);
  const income = cat.kind === "INCOME";
  await tx.journalEntry.create({
    data: {
      businessId: ctx.businessId,
      entryDate: t.transactionDate,
      memo: `${cat.name}${t.description ? ` - ${t.description}` : ""}`.slice(0, 200),
      reference: t.billNumber,
      transactionId: t.id,
      createdBy: ctx.userId,
      lines: {
        create: [
          { accountId: income ? biz.settlementAccountId : cat.accountId, debit: amount, credit: 0 },
          { accountId: income ? cat.accountId : biz.settlementAccountId, debit: 0, credit: amount },
        ],
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Chart of accounts management
// ---------------------------------------------------------------------------

export async function createAccount(ctx: Ctx, input: { code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE" }) {
  assertWrite(ctx);
  const dup = await db.account.findUnique({ where: { businessId_code: { businessId: ctx.businessId, code: input.code } } });
  if (dup) throw conflict(`Account code ${input.code} already exists`);
  const acct = await db.account.create({ data: { businessId: ctx.businessId, ...input } });
  await audit(db, ctx, { action: "CREATE", entityType: "Account", entityId: acct.id, after: acct });
  return acct;
}

export async function setAccountActive(ctx: Ctx, id: string, isActive: boolean) {
  assertWrite(ctx);
  const a = await db.account.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!a) throw notFound("Account");
  const biz = await db.business.findUniqueOrThrow({ where: { id: ctx.businessId } });
  if (!isActive && biz.settlementAccountId === id) throw conflict("This is the cash/bank settlement account; choose another before deactivating it");
  const updated = await db.account.update({ where: { id }, data: { isActive } });
  await audit(db, ctx, { action: "UPDATE", entityType: "Account", entityId: id, before: a, after: updated });
}

export async function createCategory(ctx: Ctx, input: { name: string; kind: "INCOME" | "EXPENSE"; accountId: string }) {
  assertWrite(ctx);
  const acct = await db.account.findFirst({ where: { id: input.accountId, businessId: ctx.businessId } });
  if (!acct) throw notFound("Account");
  if (acct.type !== input.kind) throw validation(`A ${input.kind.toLowerCase()} category must use an ${input.kind.toLowerCase()} account`, { accountId: "Wrong account type" });
  const dup = await db.category.findUnique({ where: { businessId_name: { businessId: ctx.businessId, name: input.name } } });
  if (dup) throw conflict(`A category named "${input.name}" already exists`);
  const cat = await db.category.create({ data: { businessId: ctx.businessId, ...input } });
  await audit(db, ctx, { action: "CREATE", entityType: "Category", entityId: cat.id, after: cat });
  return cat;
}

export async function setSettlementAccount(ctx: Ctx, accountId: string) {
  assertWrite(ctx);
  const acct = await db.account.findFirst({ where: { id: accountId, businessId: ctx.businessId, type: "ASSET", isActive: true } });
  if (!acct) throw validation("Choose an active asset account (cash or bank)");
  await db.$transaction(async (tx) => {
    await tx.business.update({ where: { id: ctx.businessId }, data: { settlementAccountId: accountId } });
    // Re-generate journals so reports stay consistent with the new setting.
    const txns = await tx.transaction.findMany({ where: { businessId: ctx.businessId, status: "POSTED", categoryId: { not: null } } });
    for (const t of txns) await syncJournalForTransaction(tx, ctx, t);
    await audit(tx, ctx, { action: "UPDATE", entityType: "Business", entityId: ctx.businessId, note: `Settlement account set to ${acct.code} ${acct.name}` });
  }, { timeout: 60000 });
}

// ---------------------------------------------------------------------------
// Manual journal entries (double entry: must balance)
// ---------------------------------------------------------------------------

export type JournalLineInput = { accountId: string; debit: Decimal; credit: Decimal };

export async function createManualJournal(ctx: Ctx, input: { date: string; memo: string; reference?: string; lines: JournalLineInput[] }) {
  assertWrite(ctx);
  if (input.lines.length < 2) throw validation("A journal entry needs at least two lines");
  for (const l of input.lines) {
    if (l.debit.isNegative() || l.credit.isNegative()) throw validation("Amounts cannot be negative");
    if (l.debit.gt(0) === l.credit.gt(0)) throw validation("Each line must have either a debit or a credit (not both, not neither)");
  }
  const totalDebit = input.lines.reduce((a, l) => a.plus(l.debit), ZERO);
  const totalCredit = input.lines.reduce((a, l) => a.plus(l.credit), ZERO);
  if (!totalDebit.eq(totalCredit)) throw validation(`Entry does not balance: debits ${totalDebit.toFixed(2)} vs credits ${totalCredit.toFixed(2)}`);
  const ids = [...new Set(input.lines.map((l) => l.accountId))];
  const accounts = await db.account.findMany({ where: { id: { in: ids }, businessId: ctx.businessId, isActive: true } });
  if (accounts.length !== ids.length) throw validation("One or more accounts are invalid");
  return db.$transaction(async (tx) => {
    const entry = await tx.journalEntry.create({
      data: {
        businessId: ctx.businessId,
        entryDate: fromIso(input.date),
        memo: input.memo,
        reference: input.reference ?? "",
        createdBy: ctx.userId,
        lines: { create: input.lines.map((l) => ({ accountId: l.accountId, debit: l.debit, credit: l.credit })) },
      },
      include: { lines: true },
    });
    await audit(tx, ctx, { action: "CREATE", entityType: "JournalEntry", entityId: entry.id, after: entry });
    return entry;
  });
}

export async function deleteManualJournal(ctx: Ctx, id: string) {
  assertWrite(ctx);
  const entry = await db.journalEntry.findFirst({ where: { id, businessId: ctx.businessId }, include: { lines: true } });
  if (!entry) throw notFound("Journal entry");
  if (entry.transactionId) throw conflict("This entry was generated from a billpad transaction. Change the transaction's category instead.");
  await db.$transaction(async (tx) => {
    await tx.journalEntry.delete({ where: { id } });
    await audit(tx, ctx, { action: "DELETE", entityType: "JournalEntry", entityId: id, before: entry });
  });
}

// ---------------------------------------------------------------------------
// Queries used by reports
// ---------------------------------------------------------------------------

export type AccountTotals = { accountId: string; code: string; name: string; type: string; debit: Decimal; credit: Decimal };

/** Per-account debit/credit totals from journal lines inside [from, to] (either bound optional). */
export async function accountTotals(client: Client, businessId: string, range: { from?: string; to?: string }): Promise<AccountTotals[]> {
  const where: Prisma.JournalLineWhereInput = {
    journalEntry: {
      businessId,
      entryDate: { ...(range.from ? { gte: fromIso(range.from) } : {}), ...(range.to ? { lte: fromIso(range.to) } : {}) },
    },
  };
  const grouped = await client.journalLine.groupBy({ by: ["accountId"], where, _sum: { debit: true, credit: true } });
  if (grouped.length === 0) return [];
  const accounts = await client.account.findMany({ where: { id: { in: grouped.map((g) => g.accountId) }, businessId } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  return grouped
    .map((g) => {
      const a = byId.get(g.accountId)!;
      return { accountId: a.id, code: a.code, name: a.name, type: a.type, debit: D(g._sum.debit), credit: D(g._sum.credit) };
    })
    .sort((x, y) => x.code.localeCompare(y.code));
}

export { toIso };
