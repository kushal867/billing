import type { Prisma, Transaction } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { assertWrite } from "@/lib/auth/context";
import { AppError, conflict, notFound, validation } from "@/lib/errors";
import { D, type Decimal } from "@/lib/money";
import { fromIso, toIso, todayIso } from "@/lib/dates";
import { parseEntry, type ParsedEntry } from "@/lib/validators";
import { audit } from "./audit";
import { getAnchor } from "./periods";
import { syncJournalForTransaction } from "./accounting";
import { resolveParty } from "./parties";

type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` in a DB transaction holding a per-business advisory lock, so concurrent
 * writers are serialised. (Balances are derived from the data, never stored, so there
 * is nothing that can drift; the lock makes duplicate checks and the "before opening
 * balance" check race-free.)
 */
export async function withBusinessLock<T>(businessId: string, fn: (tx: Tx) => Promise<T>, timeoutMs = 20000): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${businessId}))`;
      return fn(tx);
    },
    { timeout: timeoutMs, maxWait: 15000 },
  );
}

export type DuplicateMatch = { id: string; date: string; billNumber: string; debit: string; credit: string; description: string };
export type DuplicateInfo = { exact: DuplicateMatch[]; sameBill: DuplicateMatch[] };

const toMatch = (t: Transaction): DuplicateMatch => ({
  id: t.id,
  date: toIso(t.transactionDate),
  billNumber: t.billNumber,
  debit: D(t.debitAmount).toFixed(2),
  credit: D(t.creditAmount).toFixed(2),
  description: t.description,
});

export async function findDuplicates(
  tx: Tx,
  businessId: string,
  e: { dateIso: string; billNumber: string; debit: Decimal; credit: Decimal },
  excludeId?: string,
): Promise<DuplicateInfo> {
  if (!e.billNumber.trim()) return { exact: [], sameBill: [] };
  const sameBill = await tx.transaction.findMany({
    where: { businessId, billNumber: e.billNumber.trim(), status: "POSTED", ...(excludeId ? { NOT: { id: excludeId } } : {}) },
    orderBy: { seq: "asc" },
    take: 10,
  });
  const exact = sameBill.filter(
    (t) => toIso(t.transactionDate) === e.dateIso && D(t.debitAmount).eq(e.debit) && D(t.creditAmount).eq(e.credit),
  );
  return { exact: exact.map(toMatch), sameBill: sameBill.filter((t) => !exact.includes(t)).map(toMatch) };
}

async function assertAfterAnchor(tx: Tx, businessId: string, dateIso: string) {
  const anchor = await getAnchor(tx, businessId);
  if (anchor.date && dateIso < anchor.date)
    throw validation(`This date is before the opening balance date (${anchor.date}). Change the opening balance's effective date first.`, {
      dateText: "Before the opening balance date",
    });
}

async function assertCategory(tx: Tx, businessId: string, categoryId?: string) {
  if (!categoryId) return;
  const c = await tx.category.findFirst({ where: { id: categoryId, businessId, isActive: true } });
  if (!c) throw validation("That category does not exist", { categoryId: "Choose a valid category" });
}

export type SaveResult =
  | { status: "saved"; transaction: Transaction; warnings: string[]; alreadySaved?: boolean }
  | { status: "duplicate"; duplicates: DuplicateInfo };

const warningsFor = (e: ParsedEntry): string[] => {
  const w: string[] = [];
  if (e.dateIso > todayIso()) w.push("This entry is dated in the future.");
  return w;
};

export async function createTransaction(ctx: Ctx, raw: unknown): Promise<SaveResult> {
  assertWrite(ctx);
  const parsed = parseEntry(raw);
  if (!parsed.ok) throw validation("Please fix the highlighted fields", parsed.errors);
  const e = parsed.value;

  return withBusinessLock(ctx.businessId, async (tx) => {
    if (e.clientToken) {
      const prior = await tx.transaction.findUnique({ where: { businessId_clientToken: { businessId: ctx.businessId, clientToken: e.clientToken } } });
      if (prior) return { status: "saved" as const, transaction: prior, warnings: [], alreadySaved: true };
    }
    await assertAfterAnchor(tx, ctx.businessId, e.dateIso);
    await assertCategory(tx, ctx.businessId, e.categoryId);
    if (e.status === "POSTED" && !e.allowDuplicate) {
      const dups = await findDuplicates(tx, ctx.businessId, { dateIso: e.dateIso, billNumber: e.billNumber, debit: e.debit, credit: e.credit });
      if (dups.exact.length || dups.sameBill.length) return { status: "duplicate" as const, duplicates: dups };
    }
    const partyId = await resolveParty(tx, ctx, e.partyName);
    const created = await tx.transaction.create({
      data: {
        businessId: ctx.businessId,
        transactionDate: fromIso(e.dateIso),
        enteredDateText: e.dateText,
        enteredCalendar: e.calendar,
        billNumber: e.billNumber,
        debitAmount: e.debit,
        creditAmount: e.credit,
        description: e.description,
        categoryId: e.categoryId ?? null,
        partyId,
        status: e.status,
        clientToken: e.clientToken ?? null,
        createdBy: ctx.userId,
      },
    });
    await syncJournalForTransaction(tx, ctx, created);
    await audit(tx, ctx, { action: e.status === "DRAFT" ? "CREATE_DRAFT" : "CREATE", entityType: "Transaction", entityId: created.id, after: created });
    return { status: "saved" as const, transaction: created, warnings: warningsFor(e) };
  });
}

export async function getTransaction(ctx: Pick<Ctx, "businessId">, id: string) {
  const t = await db.transaction.findFirst({
    where: { id, businessId: ctx.businessId },
    include: { category: true, party: true },
  });
  if (!t) throw notFound("Entry");
  return t;
}

export async function updateTransaction(ctx: Ctx, id: string, raw: unknown, expectedVersion: number): Promise<SaveResult> {
  assertWrite(ctx);
  const parsed = parseEntry(raw);
  if (!parsed.ok) throw validation("Please fix the highlighted fields", parsed.errors);
  const e = parsed.value;

  return withBusinessLock(ctx.businessId, async (tx) => {
    const before = await tx.transaction.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!before) throw notFound("Entry");
    if (before.status === "VOID") throw conflict("This entry was deleted and can no longer be edited");
    if (before.version !== expectedVersion) throw conflict("This entry was changed by someone else. Reload the page and try again.");
    if (before.reversalOfId) throw conflict("Reversal entries cannot be edited; delete and re-enter instead");
    await assertAfterAnchor(tx, ctx.businessId, e.dateIso);
    await assertCategory(tx, ctx.businessId, e.categoryId);
    if (e.status === "POSTED" && !e.allowDuplicate) {
      const dups = await findDuplicates(tx, ctx.businessId, { dateIso: e.dateIso, billNumber: e.billNumber, debit: e.debit, credit: e.credit }, id);
      if (dups.exact.length || dups.sameBill.length) return { status: "duplicate" as const, duplicates: dups };
    }
    const partyId = e.partyName === undefined ? before.partyId : await resolveParty(tx, ctx, e.partyName);
    const after = await tx.transaction.update({
      where: { id },
      data: {
        transactionDate: fromIso(e.dateIso),
        enteredDateText: e.dateText,
        enteredCalendar: e.calendar,
        billNumber: e.billNumber,
        debitAmount: e.debit,
        creditAmount: e.credit,
        description: e.description,
        categoryId: e.categoryId ?? null,
        partyId,
        status: e.status,
        version: { increment: 1 },
        updatedBy: ctx.userId,
      },
    });
    await syncJournalForTransaction(tx, ctx, after);
    await audit(tx, ctx, { action: before.status === "DRAFT" && e.status === "POSTED" ? "POST" : "UPDATE", entityType: "Transaction", entityId: id, before, after });
    return { status: "saved" as const, transaction: after, warnings: warningsFor(e) };
  });
}

/** Soft-delete: the record stays in the database and audit trail but no longer affects balances. */
export async function voidTransaction(ctx: Ctx, id: string, reason: string) {
  assertWrite(ctx);
  const r = reason.trim();
  if (r.length < 3) throw validation("Please give a short reason", { reason: "Reason is required" });
  return withBusinessLock(ctx.businessId, async (tx) => {
    const before = await tx.transaction.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!before) throw notFound("Entry");
    if (before.status === "VOID") throw conflict("This entry is already deleted");
    const after = await tx.transaction.update({
      where: { id },
      data: { status: "VOID", voidReason: r, version: { increment: 1 }, updatedBy: ctx.userId },
    });
    await tx.journalEntry.deleteMany({ where: { transactionId: id, businessId: ctx.businessId } });
    await audit(tx, ctx, { action: "VOID", entityType: "Transaction", entityId: id, before, after, note: r });
    return after;
  });
}

/** Creates an offsetting entry (debit and credit swapped) so the original stays visible in the ledger. */
export async function reverseTransaction(ctx: Ctx, id: string, reason: string, dateIso: string = todayIso()) {
  assertWrite(ctx);
  const r = reason.trim();
  if (r.length < 3) throw validation("Please give a short reason", { reason: "Reason is required" });
  return withBusinessLock(ctx.businessId, async (tx) => {
    const orig = await tx.transaction.findFirst({ where: { id, businessId: ctx.businessId } });
    if (!orig) throw notFound("Entry");
    if (orig.status !== "POSTED") throw conflict("Only saved entries can be reversed");
    if (orig.reversalOfId) throw conflict("A reversal cannot itself be reversed");
    const existing = await tx.transaction.findFirst({ where: { businessId: ctx.businessId, reversalOfId: id, status: "POSTED" } });
    if (existing) throw conflict("This entry has already been reversed");
    const date = dateIso < toIso(orig.transactionDate) ? toIso(orig.transactionDate) : dateIso;
    await assertAfterAnchor(tx, ctx.businessId, date);
    const rev = await tx.transaction.create({
      data: {
        businessId: ctx.businessId,
        transactionDate: fromIso(date),
        enteredDateText: date,
        enteredCalendar: "AD",
        billNumber: orig.billNumber,
        debitAmount: orig.creditAmount,
        creditAmount: orig.debitAmount,
        description: `Reversal of bill ${orig.billNumber}: ${r}`.slice(0, 500),
        categoryId: orig.categoryId,
        partyId: orig.partyId,
        status: "POSTED",
        reversalOfId: orig.id,
        createdBy: ctx.userId,
      },
    });
    await syncJournalForTransaction(tx, ctx, rev);
    await audit(tx, ctx, { action: "REVERSE", entityType: "Transaction", entityId: id, after: rev, note: r });
    return rev;
  });
}

/** Suggests (never forces) the next bill number based on the most recently entered bill. */
export async function suggestNextBillNumber(ctx: Pick<Ctx, "businessId">): Promise<string> {
  const last = await db.transaction.findFirst({
    where: { businessId: ctx.businessId, status: { in: ["POSTED", "DRAFT"] }, reversalOfId: null, NOT: { billNumber: "" } },
    orderBy: { seq: "desc" },
    select: { billNumber: true },
  });
  if (!last) return "1";
  const m = /^(.*?)(\d+)$/.exec(last.billNumber.trim());
  if (!m) return "";
  const next = (BigInt(m[2]) + 1n).toString().padStart(m[2].length, "0");
  return `${m[1]}${next}`;
}

export async function getAuditTrail(ctx: Pick<Ctx, "businessId">, entityType: string, entityId: string) {
  return db.auditLog.findMany({ where: { businessId: ctx.businessId, entityType, entityId }, orderBy: { createdAt: "desc" }, take: 100 });
}

export { AppError };
