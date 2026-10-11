import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { D, ZERO, type Decimal } from "@/lib/money";
import { monthBucket, todayIso } from "@/lib/dates";
import { monthStart } from "@/lib/ranges";
import { listLedger, summarizePeriod } from "./ledger";
import { getBusiness } from "./periods";
import { monthlyRows, profitLossData, type MonthRow } from "./reports";

export type DashboardData = {
  from: string;
  to: string;
  opening: Decimal;
  debit: Decimal;
  credit: Decimal;
  current: Decimal;
  count: number;
  income: Decimal;
  expenses: Decimal;
  net: Decimal | null;
  unclassifiedCount: number;
  addedToday: number;
  addedThisMonth: number;
  recent: Awaited<ReturnType<typeof listLedger>>["rows"];
  months: Array<{ label: string; debit: number; credit: number; balance: number; income: number; expense: number }>;
};

/** Start of the Nepal-time day containing `iso` as a UTC instant. */
const nptStart = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 5.75 * 3600_000);

export async function getDashboard(ctx: Pick<Ctx, "businessId">, from: string, to: string): Promise<DashboardData> {
  const biz = await getBusiness(ctx.businessId);
  const today = todayIso();
  const [summary, pl, addedToday, addedThisMonth, recentPage, months, jl] = await Promise.all([
    summarizePeriod(ctx, from, to),
    profitLossData(ctx, from, to),
    db.transaction.count({ where: { businessId: ctx.businessId, status: "POSTED", createdAt: { gte: nptStart(today) } } }),
    db.transaction.count({ where: { businessId: ctx.businessId, status: "POSTED", createdAt: { gte: nptStart(monthStart(today, biz.displayCalendar)) } } }),
    listLedger(ctx, { sort: "date", dir: "desc", pageSize: 8 }),
    monthlyRows(ctx.businessId, biz, from, to),
    db.$queryRaw<{ d: Date; type: string; debit: unknown; credit: unknown }[]>`
      SELECT je."entryDate" AS d, a.type::text AS type, SUM(l.debit) AS debit, SUM(l.credit) AS credit
      FROM "JournalLine" l JOIN "JournalEntry" je ON je.id = l."journalEntryId" JOIN "Account" a ON a.id = l."accountId"
      WHERE je."businessId" = ${ctx.businessId}::uuid AND a.type IN ('INCOME','EXPENSE')
        AND je."entryDate" >= ${from}::date AND je."entryDate" <= ${to}::date
      GROUP BY je."entryDate", a.type`,
  ]);

  const plByMonth = new Map<string, { income: Decimal; expense: Decimal }>();
  for (const r of jl) {
    const key = monthBucket(r.d.toISOString().slice(0, 10), biz.displayCalendar).key;
    const cur = plByMonth.get(key) ?? { income: ZERO, expense: ZERO };
    if (r.type === "INCOME") cur.income = cur.income.plus(D(r.credit as string).minus(D(r.debit as string)));
    else cur.expense = cur.expense.plus(D(r.debit as string).minus(D(r.credit as string)));
    plByMonth.set(key, cur);
  }
  const chart = months.map((m: MonthRow) => ({
    label: m.label,
    debit: m.debit.toNumber(),
    credit: m.credit.toNumber(),
    balance: m.closing.toNumber(),
    income: plByMonth.get(m.key)?.income.toNumber() ?? 0,
    expense: plByMonth.get(m.key)?.expense.toNumber() ?? 0,
  }));

  return {
    from, to,
    opening: summary.opening, debit: summary.debit, credit: summary.credit, current: summary.closing, count: summary.count,
    income: pl.revenue, expenses: pl.expenses,
    net: pl.sufficient ? pl.net : null,
    unclassifiedCount: pl.unclassifiedCount,
    addedToday, addedThisMonth,
    recent: recentPage.rows,
    months: chart,
  };
}
