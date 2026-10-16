import type { Party, Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { assertWrite } from "@/lib/auth/context";
import { conflict, notFound, validation } from "@/lib/errors";
import { D, ZERO, parseMoney, type Decimal } from "@/lib/money";
import { fromIso, toIso, todayIso } from "@/lib/dates";
import { audit } from "./audit";

type Tx = Prisma.TransactionClient;

export const cleanPartyName = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Finds the party with this name (ignoring upper/lower case) or creates it, so typing a new name in the
 * entry form adds the customer on the spot. Returns null for an empty name.
 */
export async function resolveParty(tx: Tx, ctx: Pick<Ctx, "businessId" | "userId" | "userName">, rawName: string | undefined): Promise<string | null> {
  const name = cleanPartyName(rawName ?? "");
  if (!name) return null;
  if (name.length > 100) throw validation("Party name is too long", { partyName: "Keep the name under 100 characters" });
  const found = await tx.party.findFirst({ where: { businessId: ctx.businessId, name: { equals: name, mode: "insensitive" } } });
  if (found) return found.id;
  const created = await tx.party.create({ data: { businessId: ctx.businessId, name } });
  await audit(tx, ctx, { action: "CREATE", entityType: "Party", entityId: created.id, after: created });
  return created.id;
}

// ---------------------------------------------------------------------------
// Balances and ageing
// ---------------------------------------------------------------------------
export const AGE_BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
export type AgeBuckets = Record<(typeof AGE_BUCKETS)[number], Decimal>;
const emptyBuckets = (): AgeBuckets => ({ "0-30": ZERO, "31-60": ZERO, "61-90": ZERO, "90+": ZERO });

export type PartyRow = {
  id: string;
  name: string;
  kind: "CUSTOMER" | "SUPPLIER";
  phone: string;
  isActive: boolean;
  debit: Decimal;
  credit: Decimal;
  /** Net debit including the brought-forward amount: positive = they owe you, negative = you owe them. */
  net: Decimal;
  entries: number;
  lastDate: string | null;
  lastPaymentDate: string | null;
  /** How the amount they owe you has aged (oldest debits are settled first). Empty when they do not owe you. */
  ageing: AgeBuckets;
  oldestDays: number | null;
};

type Line = { date: string; debit: Decimal; credit: Decimal };

/** First-in-first-out ageing: every credit settles the oldest unpaid debit; what is left is bucketed by age. */
export function ageOutstanding(openingNet: Decimal, lines: Line[], today: string = todayIso()): { buckets: AgeBuckets; oldestDays: number | null } {
  const open: { date: string | null; amount: Decimal }[] = [];
  if (openingNet.gt(0)) open.push({ date: null, amount: openingNet });
  let credit = openingNet.lt(0) ? openingNet.abs() : ZERO; // money we owed them settles later sales first
  const sorted = [...lines].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const l of sorted) {
    if (l.debit.gt(0)) open.push({ date: l.date, amount: l.debit });
    credit = credit.plus(l.credit);
  }
  for (const o of open) {
    if (credit.lte(0)) break;
    const used = credit.lt(o.amount) ? credit : o.amount;
    o.amount = o.amount.minus(used);
    credit = credit.minus(used);
  }
  const buckets = emptyBuckets();
  let oldest: number | null = null;
  const t = fromIso(today).getTime();
  for (const o of open) {
    if (o.amount.lte(0)) continue;
    const days = o.date ? Math.max(0, Math.round((t - fromIso(o.date).getTime()) / 86_400_000)) : 9999; // brought forward = oldest
    oldest = oldest === null ? days : Math.max(oldest, days);
    const k: keyof AgeBuckets = days <= 30 ? "0-30" : days <= 60 ? "31-60" : days <= 90 ? "61-90" : "90+";
    buckets[k] = buckets[k].plus(o.amount);
  }
  return { buckets, oldestDays: oldest === 9999 ? null : oldest };
}

export type PartyFilter = "all" | "owes" | "owed" | "settled";

export async function listParties(ctx: Pick<Ctx, "businessId">, opts: { q?: string; filter?: PartyFilter; includeInactive?: boolean } = {}): Promise<PartyRow[]> {
  const parties = await db.party.findMany({
    where: {
      businessId: ctx.businessId,
      ...(opts.includeInactive ? {} : { isActive: true }),
      ...(opts.q?.trim() ? { OR: [{ name: { contains: opts.q.trim(), mode: "insensitive" } }, { phone: { contains: opts.q.trim() } }] } : {}),
    },
    orderBy: { name: "asc" },
  });
  if (!parties.length) return [];
  const txs = await db.transaction.findMany({
    where: { businessId: ctx.businessId, status: "POSTED", partyId: { in: parties.map((p) => p.id) } },
    select: { partyId: true, transactionDate: true, debitAmount: true, creditAmount: true },
  });
  const byParty = new Map<string, Line[]>();
  for (const t of txs) {
    const arr = byParty.get(t.partyId!) ?? [];
    arr.push({ date: toIso(t.transactionDate), debit: D(t.debitAmount), credit: D(t.creditAmount) });
    byParty.set(t.partyId!, arr);
  }
  const today = todayIso();
  const rows = parties.map((p): PartyRow => {
    const lines = byParty.get(p.id) ?? [];
    const debit = lines.reduce((a, l) => a.plus(l.debit), ZERO);
    const credit = lines.reduce((a, l) => a.plus(l.credit), ZERO);
    const net = D(p.openingNet).plus(debit).minus(credit);
    const dates = lines.map((l) => l.date).sort();
    const pays = lines.filter((l) => l.credit.gt(0)).map((l) => l.date).sort();
    const aged = net.gt(0) ? ageOutstanding(D(p.openingNet), lines, today) : { buckets: emptyBuckets(), oldestDays: null };
    return {
      id: p.id, name: p.name, kind: p.kind, phone: p.phone, isActive: p.isActive,
      debit, credit, net, entries: lines.length,
      lastDate: dates.length ? dates[dates.length - 1] : null,
      lastPaymentDate: pays.length ? pays[pays.length - 1] : null,
      ageing: aged.buckets, oldestDays: aged.oldestDays,
    };
  });
  const f = opts.filter ?? "all";
  return rows.filter((r) => (f === "owes" ? r.net.gt(0) : f === "owed" ? r.net.lt(0) : f === "settled" ? r.net.isZero() : true));
}

export type OutstandingTotals = { receivable: Decimal; payable: Decimal; owingCount: number; owedCount: number };
export function totalsOf(rows: PartyRow[]): OutstandingTotals {
  let receivable = ZERO, payable = ZERO, owingCount = 0, owedCount = 0;
  for (const r of rows) {
    if (r.net.gt(0)) { receivable = receivable.plus(r.net); owingCount++; }
    else if (r.net.lt(0)) { payable = payable.plus(r.net.abs()); owedCount++; }
  }
  return { receivable, payable, owingCount, owedCount };
}

export async function getParty(ctx: Pick<Ctx, "businessId">, id: string): Promise<Party> {
  const p = /^[0-9a-f-]{36}$/i.test(id) ? await db.party.findFirst({ where: { id, businessId: ctx.businessId } }) : null;
  if (!p) throw notFound("Party");
  return p;
}

export async function getPartyRow(ctx: Pick<Ctx, "businessId">, id: string): Promise<PartyRow> {
  await getParty(ctx, id);
  const rows = await listParties(ctx, { includeInactive: true });
  const r = rows.find((x) => x.id === id);
  if (!r) throw notFound("Party");
  return r;
}

/** Names for the entry form's type-ahead. */
export async function partyNames(ctx: Pick<Ctx, "businessId">): Promise<string[]> {
  const rows = await db.party.findMany({ where: { businessId: ctx.businessId, isActive: true }, orderBy: { name: "asc" }, select: { name: true }, take: 2000 });
  return rows.map((r) => r.name);
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------
const partySchema = z.object({
  name: z.string().transform(cleanPartyName).pipe(z.string().min(1, "Enter a name").max(100, "Keep the name under 100 characters")),
  kind: z.enum(["CUSTOMER", "SUPPLIER"]).default("CUSTOMER"),
  phone: z.string().trim().max(30, "Phone number is too long").default(""),
  address: z.string().trim().max(200, "Keep the address under 200 characters").default(""),
  notes: z.string().trim().max(500, "Keep notes under 500 characters").default(""),
  /** Amount brought forward and which way it goes. */
  openingAmount: z.string().trim().default(""),
  openingSide: z.enum(["THEY_OWE", "WE_OWE"]).default("THEY_OWE"),
});
export type PartyInput = z.input<typeof partySchema>;

function parsePartyInput(raw: unknown) {
  const r = partySchema.safeParse(raw);
  if (!r.success) {
    const errors: Record<string, string> = {};
    for (const i of r.error.issues) errors[String(i.path[0])] ??= i.message;
    throw validation("Please fix the highlighted fields", errors);
  }
  const v = r.data;
  let openingNet = ZERO;
  if (v.openingAmount !== "") {
    const a = parseMoney(v.openingAmount);
    if (a === null) throw validation("Please fix the highlighted fields", { openingAmount: "Enter a positive amount with up to 2 decimals" });
    openingNet = v.openingSide === "WE_OWE" ? a.negated() : a;
  }
  return { name: v.name, kind: v.kind, phone: v.phone, address: v.address, notes: v.notes, openingNet };
}

export async function createParty(ctx: Ctx, raw: unknown) {
  assertWrite(ctx);
  const data = parsePartyInput(raw);
  const clash = await db.party.findFirst({ where: { businessId: ctx.businessId, name: { equals: data.name, mode: "insensitive" } } });
  if (clash) throw validation("A party with this name already exists", { name: "A party with this name already exists" });
  return db.$transaction(async (tx) => {
    const p = await tx.party.create({ data: { ...data, businessId: ctx.businessId } });
    await audit(tx, ctx, { action: "CREATE", entityType: "Party", entityId: p.id, after: p });
    return p;
  });
}

export async function updateParty(ctx: Ctx, id: string, raw: unknown) {
  assertWrite(ctx);
  const before = await getParty(ctx, id);
  const data = parsePartyInput(raw);
  const clash = await db.party.findFirst({ where: { businessId: ctx.businessId, name: { equals: data.name, mode: "insensitive" }, NOT: { id } } });
  if (clash) throw validation("A party with this name already exists", { name: "A party with this name already exists" });
  return db.$transaction(async (tx) => {
    const after = await tx.party.update({ where: { id }, data });
    await audit(tx, ctx, { action: "UPDATE", entityType: "Party", entityId: id, before, after });
    return after;
  });
}

export async function setPartyActive(ctx: Ctx, id: string, active: boolean) {
  assertWrite(ctx);
  const before = await getParty(ctx, id);
  if (!active) {
    const row = await getPartyRow(ctx, id);
    if (!row.net.isZero()) throw conflict("This party still has a balance. Settle it before hiding the party.");
  }
  const after = await db.party.update({ where: { id }, data: { isActive: active } });
  await audit(db, ctx, { action: active ? "RESTORE" : "ARCHIVE", entityType: "Party", entityId: id, before, after });
  return after;
}

/** Merge `fromId` into `intoId` (for duplicate names such as "Ram Traders" and "Ram trader"). */
export async function mergeParties(ctx: Ctx, fromId: string, intoId: string) {
  assertWrite(ctx);
  if (fromId === intoId) throw validation("Choose two different parties");
  const [from, into] = await Promise.all([getParty(ctx, fromId), getParty(ctx, intoId)]);
  return db.$transaction(async (tx) => {
    const moved = await tx.transaction.updateMany({ where: { businessId: ctx.businessId, partyId: fromId }, data: { partyId: intoId } });
    await tx.party.update({ where: { id: intoId }, data: { openingNet: D(into.openingNet).plus(D(from.openingNet)) } });
    await tx.party.delete({ where: { id: fromId } });
    await audit(tx, ctx, { action: "MERGE", entityType: "Party", entityId: intoId, note: `${from.name} -> ${into.name} (${moved.count} entries)` });
    return moved.count;
  });
}

