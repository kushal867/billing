import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { D, ZERO, type Decimal } from "@/lib/money";
import { fromIso, toIso, todayIso } from "@/lib/dates";
import type { Client } from "./audit";
import { getAnchor, getBusiness } from "./periods";

export type Convention = "DEBIT_PLUS" | "CREDIT_PLUS";

/** Balance = Previous + sign * (Debit - Credit). DEBIT_PLUS => +1, CREDIT_PLUS => -1. */
export const signOf = (c: Convention) => (c === "DEBIT_PLUS" ? 1 : -1);

export function applyConvention(c: Convention, opening: Decimal, debit: Decimal, credit: Decimal): Decimal {
  return opening.plus(debit.minus(credit).times(signOf(c)));
}

export async function periodTotals(client: Client, businessId: string, from?: string, to?: string) {
  const agg = await client.transaction.aggregate({
    where: {
      businessId,
      status: "POSTED",
      transactionDate: { ...(from ? { gte: fromIso(from) } : {}), ...(to ? { lte: fromIso(to) } : {}) },
    },
    _sum: { debitAmount: true, creditAmount: true },
    _count: { _all: true },
  });
  return { count: agg._count._all, debit: D(agg._sum.debitAmount), credit: D(agg._sum.creditAmount) };
}

/**
 * Balance carried into a period beginning on `fromIso`: the anchor opening balance
 * plus the net effect of every POSTED transaction before that date. Never reset by
 * month or year boundaries.
 */
export async function openingBalanceFor(client: Client, businessId: string, convention: Convention, from: string): Promise<Decimal> {
  const anchor = await getAnchor(client, businessId);
  if (anchor.date && from <= anchor.date) return anchor.amount;
  const t = await periodTotals(client, businessId, anchor.date ?? undefined, shiftBack(from));
  return applyConvention(convention, anchor.amount, t.debit, t.credit);
}

function shiftBack(iso: string): string {
  return toIso(new Date(fromIso(iso).getTime() - 86_400_000));
}

export type PeriodSummary = {
  from: string;
  to: string;
  opening: Decimal;
  debit: Decimal;
  credit: Decimal;
  closing: Decimal;
  count: number;
};

export async function summarizePeriod(ctx: Pick<Ctx, "businessId">, from: string, to: string, client: Client = db): Promise<PeriodSummary> {
  const biz = await getBusiness(ctx.businessId);
  const convention = biz.balanceConvention;
  const [opening, totals] = await Promise.all([
    openingBalanceFor(client, ctx.businessId, convention, from),
    periodTotals(client, ctx.businessId, from, to),
  ]);
  return {
    from,
    to,
    opening,
    debit: totals.debit,
    credit: totals.credit,
    closing: applyConvention(convention, opening, totals.debit, totals.credit),
    count: totals.count,
  };
}

/** Per-day aggregates for POSTED transactions in range, ordered by date. */
export async function dailyAggregates(client: Client, businessId: string, from: string, to: string) {
  const rows = await client.$queryRaw<{ d: Date; n: bigint; debit: Prisma.Decimal; credit: Prisma.Decimal }[]>`
    SELECT "transactionDate" AS d, COUNT(*) AS n, COALESCE(SUM("debitAmount"),0) AS debit, COALESCE(SUM("creditAmount"),0) AS credit
    FROM "Transaction"
    WHERE "businessId" = ${businessId}::uuid AND status = 'POSTED'
      AND "transactionDate" >= ${from}::date AND "transactionDate" <= ${to}::date
    GROUP BY "transactionDate" ORDER BY "transactionDate"`;
  return rows.map((r) => ({ date: toIso(r.d), count: Number(r.n), debit: D(r.debit), credit: D(r.credit) }));
}

// ---------------------------------------------------------------------------
// Ledger listing with running balance computed over the COMPLETE history
// ---------------------------------------------------------------------------

export type LedgerSortField = "date" | "bill" | "debit" | "credit" | "balance";

export type LedgerFilters = {
  from?: string;
  to?: string;
  q?: string;
  type?: "all" | "debit" | "credit";
  categoryId?: string;
  partyId?: string;
  status?: "POSTED" | "DRAFT" | "VOID";
  sort?: LedgerSortField;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number; // 0 = no pagination (exports)
};

export type LedgerRow = {
  id: string;
  seq: string;
  date: string;
  enteredDateText: string;
  enteredCalendar: "BS" | "AD";
  billNumber: string;
  debit: Decimal;
  credit: Decimal;
  balance: Decimal | null;
  description: string;
  categoryId: string | null;
  categoryName: string | null;
  partyId: string | null;
  partyName: string | null;
  status: "DRAFT" | "POSTED" | "VOID";
  version: number;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: Date;
  updatedAt: Date;
  flags: { duplicateBill: boolean; large: boolean; future: boolean; reversal: boolean };
};

export type LedgerPage = {
  rows: LedgerRow[];
  total: number;
  page: number;
  pageSize: number;
  filteredDebit: Decimal;
  filteredCredit: Decimal;
};

type Raw = {
  id: string; seq: bigint; transactionDate: Date; enteredDateText: string; enteredCalendar: "BS" | "AD";
  billNumber: string; debitAmount: Prisma.Decimal; creditAmount: Prisma.Decimal; description: string;
  categoryId: string | null; categoryName: string | null; partyId: string | null; partyName: string | null; status: "DRAFT" | "POSTED" | "VOID"; version: number;
  balance: Prisma.Decimal | null; dupCount: bigint; isLarge: boolean; reversalOfId: string | null;
  createdByName: string | null; updatedByName: string | null; createdAt: Date; updatedAt: Date;
  total: bigint; sumDebit: Prisma.Decimal; sumCredit: Prisma.Decimal;
};

const SORTS: Record<LedgerSortField, (dir: Prisma.Sql) => Prisma.Sql> = {
  date: (d) => Prisma.sql`"transactionDate" ${d}, seq ${d}`,
  bill: (d) => Prisma.sql`bill_num ${d} NULLS LAST, "billNumber" ${d}, seq ${d}`,
  debit: (d) => Prisma.sql`"debitAmount" ${d}, "transactionDate" ASC, seq ASC`,
  credit: (d) => Prisma.sql`"creditAmount" ${d}, "transactionDate" ASC, seq ASC`,
  balance: (d) => Prisma.sql`balance ${d} NULLS LAST, "transactionDate" ASC, seq ASC`,
};

export async function listLedger(ctx: Pick<Ctx, "businessId">, f: LedgerFilters = {}): Promise<LedgerPage> {
  const biz = await getBusiness(ctx.businessId);
  const anchor = await getAnchor(db, ctx.businessId);
  const sign = signOf(biz.balanceConvention);
  const status = f.status ?? "POSTED";
  const pageSize = f.pageSize === undefined ? 50 : f.pageSize;
  const page = Math.max(1, f.page ?? 1);
  const sortKey: LedgerSortField = f.sort && f.sort in SORTS ? f.sort : "date";
  const dir = (f.dir ?? "asc") === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;

  const where: Prisma.Sql[] = [Prisma.sql`b."status" = ${status}::"TransactionStatus"`];
  if (f.from) where.push(Prisma.sql`b."transactionDate" >= ${f.from}::date`);
  if (f.to) where.push(Prisma.sql`b."transactionDate" <= ${f.to}::date`);
  if (f.type === "debit") where.push(Prisma.sql`b."debitAmount" > 0`);
  if (f.type === "credit") where.push(Prisma.sql`b."creditAmount" > 0`);
  if (f.categoryId) where.push(Prisma.sql`b."categoryId" = ${f.categoryId}::uuid`);
  if (f.partyId) where.push(Prisma.sql`b."partyId" = ${f.partyId}::uuid`);
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(Prisma.sql`(b."billNumber" ILIKE ${like} OR b."description" ILIKE ${like} OR b."partyName" ILIKE ${like})`);
  }
  const limit = pageSize > 0 ? Prisma.sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}` : Prisma.empty;

  const rows = await db.$queryRaw<Raw[]>`
    WITH stats AS (
      SELECT AVG(GREATEST("debitAmount","creditAmount")) AS mean, STDDEV_POP(GREATEST("debitAmount","creditAmount")) AS sd, COUNT(*) AS n
      FROM "Transaction" WHERE "businessId" = ${ctx.businessId}::uuid AND status = 'POSTED'
    ),
    base AS (
      SELECT t.*,
        c.name AS "categoryName", pa.name AS "partyName",
        cu.name AS "createdByName", uu.name AS "updatedByName",
        ${anchor.amount}::numeric + SUM(CASE WHEN t.status = 'POSTED' THEN (t."debitAmount" - t."creditAmount") * ${sign}::int ELSE 0 END)
          OVER (ORDER BY t."transactionDate", t.seq ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance_all,
        COUNT(*) FILTER (WHERE t.status = 'POSTED' AND t."reversalOfId" IS NULL AND length(btrim(t."billNumber")) > 0) OVER (PARTITION BY t."billNumber") AS "dupCount",
        NULLIF(left(regexp_replace(t."billNumber", '\\D', '', 'g'), 15), '')::numeric AS bill_num,
        (s.n >= 20 AND GREATEST(t."debitAmount", t."creditAmount") > s.mean + 3 * s.sd) AS "isLarge"
      FROM "Transaction" t
      CROSS JOIN stats s
      LEFT JOIN "Category" c ON c.id = t."categoryId"
      LEFT JOIN "Party" pa ON pa.id = t."partyId"
      LEFT JOIN "User" cu ON cu.id = t."createdBy"
      LEFT JOIN "User" uu ON uu.id = t."updatedBy"
      WHERE t."businessId" = ${ctx.businessId}::uuid AND t.status IN ('POSTED', ${status}::"TransactionStatus")
    ),
    shaped AS (
      SELECT b.*, CASE WHEN b.status = 'POSTED' THEN b.balance_all ELSE NULL END AS balance FROM base b
    ),
    filtered AS (
      SELECT b.* FROM shaped b WHERE ${Prisma.join(where, " AND ")}
    )
    SELECT f.*, COUNT(*) OVER () AS total, COALESCE(SUM(f."debitAmount") OVER (), 0) AS "sumDebit", COALESCE(SUM(f."creditAmount") OVER (), 0) AS "sumCredit"
    FROM filtered f
    ORDER BY ${SORTS[sortKey](dir)}
    ${limit}`;

  const today = todayIso();
  const mapped: LedgerRow[] = rows.map((r) => ({
    id: r.id,
    seq: r.seq.toString(),
    date: toIso(r.transactionDate),
    enteredDateText: r.enteredDateText,
    enteredCalendar: r.enteredCalendar,
    billNumber: r.billNumber,
    debit: D(r.debitAmount),
    credit: D(r.creditAmount),
    balance: r.balance === null ? null : D(r.balance),
    description: r.description,
    categoryId: r.categoryId,
    categoryName: r.categoryName,
    partyId: r.partyId,
    partyName: r.partyName,
    status: r.status,
    version: r.version,
    createdByName: r.createdByName,
    updatedByName: r.updatedByName,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    flags: {
      duplicateBill: r.status === "POSTED" && !r.reversalOfId && Number(r.dupCount) > 1,
      large: r.status === "POSTED" && !!r.isLarge,
      future: toIso(r.transactionDate) > today,
      reversal: !!r.reversalOfId,
    },
  }));

  // Totals must come from the full filtered set even when the requested page is past the end.
  let total = rows.length ? Number(rows[0].total) : 0;
  let filteredDebit = rows.length ? D(rows[0].sumDebit) : ZERO;
  let filteredCredit = rows.length ? D(rows[0].sumCredit) : ZERO;
  if (!rows.length && page > 1) {
    const all = await listLedger(ctx, { ...f, page: 1, pageSize: 1 });
    total = all.total;
    filteredDebit = all.filteredDebit;
    filteredCredit = all.filteredCredit;
  }
  return { rows: mapped, total, page, pageSize, filteredDebit, filteredCredit };
}
