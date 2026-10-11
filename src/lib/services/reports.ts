import type { Business } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { notFound, validation } from "@/lib/errors";
import { D, ZERO, type Decimal } from "@/lib/money";
import { addDays, formatDate, fromIso, monthBucket, toIso, todayIso, type Calendar } from "@/lib/dates";
import { applyConvention, dailyAggregates, listLedger, openingBalanceFor, summarizePeriod, type LedgerFilters } from "./ledger";
import { accountTotals } from "./accounting";
import { getBusiness } from "./periods";
import type { ReportDoc, Section } from "./report-doc";

export const conventionText = (c: Business["balanceConvention"]) =>
  c === "DEBIT_PLUS" ? "Balance = Previous Balance + Debit - Credit" : "Balance = Previous Balance + Credit - Debit";

const m = (v: Decimal) => v.toFixed(2);

function baseDoc(biz: Business, slug: string, title: string, subtitle: string): ReportDoc {
  return {
    slug,
    title,
    subtitle,
    business: { name: biz.name, address: biz.address, phone: biz.phone, email: biz.email, pan: biz.panNumber, header: biz.reportHeader, footer: biz.reportFooter },
    grouping: biz.numberGrouping,
    currencySymbol: biz.currencySymbol,
    generatedAt: new Date(Date.now() + 5.75 * 3600_000).toISOString().replace("T", " ").slice(0, 16) + " NPT",
    meta: [],
    sections: [],
    notes: [],
    warnings: [],
  };
}

function rangeLabel(from: string, to: string, cal: Calendar) {
  const other: Calendar = cal === "BS" ? "AD" : "BS";
  return `${formatDate(from, cal)} to ${formatDate(to, cal)} ${cal}  (${formatDate(from, other)} to ${formatDate(to, other)} ${other})`;
}

function checkRange(from: string, to: string) {
  if (from > to) throw validation("The start date must be on or before the end date");
}

/** Every report's period header lines. */
function periodMeta(doc: ReportDoc, biz: Business, s: { opening: Decimal; closing: Decimal; debit: Decimal; credit: Decimal; count: number }) {
  doc.meta.push(
    ["Opening Balance", m(s.opening)],
    ["Total Debit", m(s.debit)],
    ["Total Credit", m(s.credit)],
    ["Closing Balance", m(s.closing)],
    ["Entries", String(s.count)],
    ["Balance rule", conventionText(biz.balanceConvention)],
  );
}


// ---------------------------------------------------------------------------
// Ledger statement (also used for ledger exports; reflects active filters)
// ---------------------------------------------------------------------------
export async function buildLedgerReport(ctx: Pick<Ctx, "businessId">, f: LedgerFilters): Promise<ReportDoc> {
  const biz = await getBusiness(ctx.businessId);
  const cal = biz.displayCalendar;
  const page = await listLedger(ctx, { ...f, pageSize: 0 });
  const from = f.from ?? page.rows[0]?.date ?? todayIso();
  const to = f.to ?? page.rows[page.rows.length - 1]?.date ?? todayIso();
  const doc = baseDoc(biz, "ledger", "Ledger Statement", f.from || f.to ? rangeLabel(from, to, cal) : "All recorded entries");
  const summary = await summarizePeriod(ctx, f.from ?? "1900-01-01", f.to ?? "2999-12-31");
  const opening = f.from ? summary.opening : await openingBalanceFor(db, ctx.businessId, biz.balanceConvention, "1900-01-01");
  periodMeta(doc, biz, { ...summary, opening, closing: applyConvention(biz.balanceConvention, opening, summary.debit, summary.credit) });
  const filters: string[] = [];
  if (f.q) filters.push(`search "${f.q}"`);
  if (f.type && f.type !== "all") filters.push(`${f.type} entries only`);
  if (f.categoryId) filters.push("category filter");
  if (f.status && f.status !== "POSTED") filters.push(`status ${f.status}`);
  if (filters.length) {
    doc.meta.push(["Filters", filters.join(", ")]);
    doc.notes.push("Balances are the running balance over the complete ledger; filters only hide rows.");
  }
  doc.sections.push({
    columns: [
      { key: "date", label: "Date" },
      { key: "bill", label: "Bill No." },
      { key: "description", label: "Description" },
      { key: "debit", label: "Debit", align: "right", type: "money" },
      { key: "credit", label: "Credit", align: "right", type: "money" },
      { key: "balance", label: "Balance", align: "right", type: "money" },
    ],
    rows: page.rows.map((r) => ({
      date: formatDate(r.date, cal),
      bill: r.billNumber,
      description: r.description,
      debit: r.debit.isZero() ? "" : m(r.debit),
      credit: r.credit.isZero() ? "" : m(r.credit),
      balance: r.balance ? m(r.balance) : "",
    })),
    totals: { date: "Total", bill: "", description: "", debit: m(page.filteredDebit), credit: m(page.filteredCredit), balance: "" },
    emptyMessage: "No entries match these filters.",
  });
  return doc;
}

// ---------------------------------------------------------------------------
// Billpad-style statement: ruled pages like the physical pad, with page totals
// ---------------------------------------------------------------------------
export const BILLPAD_ROW_OPTIONS = [10, 15, 20, 25, 30, 40] as const;

export async function buildBillpadReport(ctx: Pick<Ctx, "businessId">, from: string, to: string, rowsPerPage = 25): Promise<ReportDoc> {
  checkRange(from, to);
  const perPage = Math.min(60, Math.max(5, Math.floor(rowsPerPage) || 25));
  const biz = await getBusiness(ctx.businessId);
  const cal = biz.displayCalendar;
  const doc = baseDoc(biz, "billpad", "Billpad-style Statement", rangeLabel(from, to, cal));
  doc.pageBreaks = true;
  const [summary, ledger] = await Promise.all([summarizePeriod(ctx, from, to), listLedger(ctx, { from, to, pageSize: 0 })]);
  periodMeta(doc, biz, summary);

  const cols: Section["columns"] = [
    { key: "date", label: "Date" },
    { key: "bill", label: "Bill No." },
    { key: "debit", label: "Debit", align: "right", type: "money" },
    { key: "credit", label: "Credit", align: "right", type: "money" },
    { key: "balance", label: "Balance", align: "right", type: "money" },
  ];
  const rows = ledger.rows;
  const pageCount = Math.max(1, Math.ceil(rows.length / perPage));
  let carried = summary.opening;
  for (let p = 0; p < pageCount; p++) {
    const chunk = rows.slice(p * perPage, (p + 1) * perPage);
    let dr = ZERO;
    let cr = ZERO;
    // The first row of every page shows the balance brought forward, exactly like turning a pad page.
    const body: Section["rows"] = [{ date: p === 0 ? "Opening Balance" : "Brought forward", bill: "", debit: "", credit: "", balance: m(carried) }];
    for (const r of chunk) {
      dr = dr.plus(r.debit);
      cr = cr.plus(r.credit);
      body.push({ date: formatDate(r.date, cal), bill: r.billNumber, debit: r.debit.isZero() ? "" : m(r.debit), credit: r.credit.isZero() ? "" : m(r.credit), balance: r.balance ? m(r.balance) : "" });
    }
    const end = applyConvention(biz.balanceConvention, carried, dr, cr);
    const last = p === pageCount - 1;
    doc.sections.push({
      heading: `Page ${p + 1}`,
      columns: cols,
      rows: body,
      totals: { date: last ? "Closing Balance" : "Carried forward", bill: "", debit: m(dr), credit: m(cr), balance: m(end) },
      emptyMessage: "No entries in this period.",
    });
    carried = end;
  }
  doc.notes.push(`Page totals cover the entries on that page. ${rows.length} entries on ${pageCount} page${pageCount === 1 ? "" : "s"} of up to ${perPage} rows.`);
  return doc;
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------
export async function buildDailyReport(ctx: Pick<Ctx, "businessId">, from: string, to: string = from): Promise<ReportDoc> {
  checkRange(from, to);
  const biz = await getBusiness(ctx.businessId);
  const cal = biz.displayCalendar;
  const doc = baseDoc(biz, "daily", "Daily Report", rangeLabel(from, to, cal));
  const [summary, days] = await Promise.all([summarizePeriod(ctx, from, to), dailyAggregates(db, ctx.businessId, from, to)]);
  periodMeta(doc, biz, summary);
  let running = summary.opening;
  const rows: Section["rows"] = [];
  const byDate = new Map(days.map((d) => [d.date, d]));
  const dates = from === to && !byDate.has(from) ? [from] : days.map((d) => d.date);
  for (const date of dates) {
    const d = byDate.get(date) ?? { count: 0, debit: ZERO, credit: ZERO };
    const closing = applyConvention(biz.balanceConvention, running, d.debit, d.credit);
    rows.push({ date: formatDate(date, cal), count: String(d.count), opening: m(running), debit: m(d.debit), credit: m(d.credit), closing: m(closing) });
    running = closing;
  }
  doc.sections.push({
    heading: "Day by day",
    columns: [
      { key: "date", label: "Date" },
      { key: "count", label: "Transactions", align: "right", type: "int" },
      { key: "opening", label: "Opening Balance", align: "right", type: "money" },
      { key: "debit", label: "Total Debit", align: "right", type: "money" },
      { key: "credit", label: "Total Credit", align: "right", type: "money" },
      { key: "closing", label: "Closing Balance", align: "right", type: "money" },
    ],
    rows,
    totals: { date: "Total", count: String(summary.count), opening: "", debit: m(summary.debit), credit: m(summary.credit), closing: "" },
    emptyMessage: "No transactions were recorded in this period.",
  });
  if (from === to) {
    const day = await listLedger(ctx, { from, to, pageSize: 0 });
    doc.sections.push({
      heading: "Transactions",
      columns: [
        { key: "bill", label: "Bill No." },
        { key: "description", label: "Description" },
        { key: "debit", label: "Debit", align: "right", type: "money" },
        { key: "credit", label: "Credit", align: "right", type: "money" },
        { key: "balance", label: "Balance", align: "right", type: "money" },
      ],
      rows: day.rows.map((r) => ({ bill: r.billNumber, description: r.description, debit: r.debit.isZero() ? "" : m(r.debit), credit: r.credit.isZero() ? "" : m(r.credit), balance: r.balance ? m(r.balance) : "" })),
      emptyMessage: "No transactions on this date.",
    });
  } else {
    doc.notes.push("Days with no transactions are not listed.");
  }
  return doc;
}

// ---------------------------------------------------------------------------
// Monthly
// ---------------------------------------------------------------------------
export type MonthRow = { key: string; label: string; count: number; opening: Decimal; debit: Decimal; credit: Decimal; closing: Decimal };

export async function monthlyRows(businessId: string, biz: Business, from: string, to: string): Promise<MonthRow[]> {
  const cal = biz.displayCalendar;
  const [opening, days] = await Promise.all([openingBalanceFor(db, businessId, biz.balanceConvention, from), dailyAggregates(db, businessId, from, to)]);
  // Enumerate every month bucket that overlaps the range, even if empty.
  const buckets = new Map<string, MonthRow & { sort: number }>();
  for (let d = from, guard = 0; d <= to && guard < 4000; d = addDays(d, 1), guard++) {
    const b = monthBucket(d, cal);
    if (!buckets.has(b.key)) buckets.set(b.key, { key: b.key, label: b.label, sort: b.sort, count: 0, opening: ZERO, debit: ZERO, credit: ZERO, closing: ZERO });
  }
  for (const day of days) {
    const b = buckets.get(monthBucket(day.date, cal).key)!;
    b.count += day.count;
    b.debit = b.debit.plus(day.debit);
    b.credit = b.credit.plus(day.credit);
  }
  let running = opening;
  return [...buckets.values()]
    .sort((a, b) => a.sort - b.sort)
    .map((b) => {
      b.opening = running;
      b.closing = applyConvention(biz.balanceConvention, running, b.debit, b.credit);
      running = b.closing;
      return b;
    });
}

const monthColumns: Section["columns"] = [
  { key: "month", label: "Month" },
  { key: "count", label: "Transactions", align: "right", type: "int" },
  { key: "opening", label: "Opening Balance", align: "right", type: "money" },
  { key: "debit", label: "Total Debit", align: "right", type: "money" },
  { key: "credit", label: "Total Credit", align: "right", type: "money" },
  { key: "closing", label: "Closing Balance", align: "right", type: "money" },
];

export async function buildMonthlyReport(ctx: Pick<Ctx, "businessId">, from: string, to: string): Promise<ReportDoc> {
  checkRange(from, to);
  const biz = await getBusiness(ctx.businessId);
  const doc = baseDoc(biz, "monthly", "Monthly Report", rangeLabel(from, to, biz.displayCalendar));
  const [summary, rows] = await Promise.all([summarizePeriod(ctx, from, to), monthlyRows(ctx.businessId, biz, from, to)]);
  periodMeta(doc, biz, summary);
  doc.sections.push({
    heading: "Month by month",
    columns: monthColumns,
    rows: rows.map((r) => ({ month: r.label, count: String(r.count), opening: m(r.opening), debit: m(r.debit), credit: m(r.credit), closing: m(r.closing) })),
    totals: { month: "Total", count: String(summary.count), opening: "", debit: m(summary.debit), credit: m(summary.credit), closing: "" },
  });
  doc.notes.push("The first and last month may be partial if the range does not start or end on a month boundary.");
  return doc;
}

// ---------------------------------------------------------------------------
// Annual ledger report for a financial year
// ---------------------------------------------------------------------------
export async function buildAnnualReport(ctx: Pick<Ctx, "businessId">, financialYearId: string): Promise<ReportDoc> {
  const fy = await db.financialYear.findFirst({ where: { id: financialYearId, businessId: ctx.businessId }, include: { openingBalance: true } });
  if (!fy) throw notFound("Financial year");
  const biz = await getBusiness(ctx.businessId);
  const cal = biz.displayCalendar;
  const from = toIso(fy.startDate);
  const to = toIso(fy.endDate);
  const doc = baseDoc(biz, "annual", `Annual Ledger Report - FY ${fy.label}`, rangeLabel(from, to, cal));
  const [summary, ledger, months, drafts, voided, unclassified] = await Promise.all([
    summarizePeriod(ctx, from, to),
    listLedger(ctx, { from, to, pageSize: 0 }),
    monthlyRows(ctx.businessId, biz, from, to),
    db.transaction.count({ where: { businessId: ctx.businessId, status: "DRAFT", transactionDate: { gte: fy.startDate, lte: fy.endDate } } }),
    db.transaction.count({ where: { businessId: ctx.businessId, status: "VOID", transactionDate: { gte: fy.startDate, lte: fy.endDate } } }),
    db.transaction.count({ where: { businessId: ctx.businessId, status: "POSTED", categoryId: null, transactionDate: { gte: fy.startDate, lte: fy.endDate } } }),
  ]);
  periodMeta(doc, biz, summary);

  doc.sections.push({
    heading: "Transactions",
    columns: [
      { key: "date", label: "Date" },
      { key: "bill", label: "Bill No." },
      { key: "description", label: "Description" },
      { key: "debit", label: "Debit", align: "right", type: "money" },
      { key: "credit", label: "Credit", align: "right", type: "money" },
      { key: "balance", label: "Balance", align: "right", type: "money" },
    ],
    rows: [
      { date: formatDate(from, cal), bill: "", description: "Opening balance (carried forward)", debit: "", credit: "", balance: m(summary.opening) },
      ...ledger.rows.map((r) => ({
        date: formatDate(r.date, cal),
        bill: r.billNumber,
        description: r.description,
        debit: r.debit.isZero() ? "" : m(r.debit),
        credit: r.credit.isZero() ? "" : m(r.credit),
        balance: r.balance ? m(r.balance) : "",
      })),
    ],
    totals: { date: "Total", bill: "", description: `Closing balance ${formatRaw(m(summary.closing), biz)}`, debit: m(summary.debit), credit: m(summary.credit), balance: m(summary.closing) },
  });
  doc.sections.push({
    heading: "Monthly summary",
    columns: monthColumns,
    rows: months.map((r) => ({ month: r.label, count: String(r.count), opening: m(r.opening), debit: m(r.debit), credit: m(r.credit), closing: m(r.closing) })),
    totals: { month: "Total", count: String(summary.count), opening: "", debit: m(summary.debit), credit: m(summary.credit), closing: "" },
  });

  const lastBalance = ledger.rows.length ? ledger.rows[ledger.rows.length - 1].balance : summary.opening;
  const monthDebit = months.reduce((a, r) => a.plus(r.debit), ZERO);
  const monthCredit = months.reduce((a, r) => a.plus(r.credit), ZERO);
  const recorded = fy.openingBalance ? D(fy.openingBalance.amount) : null;
  const checks: Array<[string, string]> = [
    ["Opening balance carried forward", m(summary.opening)],
    ["Opening balance recorded for this year", recorded ? m(recorded) : "not set"],
  ];
  const carryDiff = recorded ? recorded.minus(summary.opening) : null;
  if (carryDiff) checks.push(["Difference (recorded - carried forward)", m(carryDiff)]);
  checks.push(
    ["Total debit", m(summary.debit)],
    ["Total credit", m(summary.credit)],
    ["Closing balance (opening + debit - credit)", m(summary.closing)],
    ["Closing balance per last ledger row", m(lastBalance ?? summary.closing)],
    ["Ledger rows total = monthly totals", monthDebit.eq(summary.debit) && monthCredit.eq(summary.credit) && (lastBalance ?? summary.closing).eq(summary.closing) ? "OK" : "MISMATCH"],
    ["Draft entries (excluded)", String(drafts)],
    ["Deleted entries (excluded)", String(voided)],
    ["Entries without a category", String(unclassified)],
  );
  doc.sections.push({
    heading: "Reconciliation summary",
    columns: [{ key: "item", label: "Item" }, { key: "value", label: "Value", align: "right" }],
    rows: checks.map(([item, value]) => ({ item, value: /^-?\d+\.\d\d$/.test(value) ? formatRaw(value, biz) : value })),
  });
  if (carryDiff && !carryDiff.isZero())
    doc.warnings.push(`The opening balance recorded for this year differs from the balance carried forward from earlier years by ${formatRaw(m(carryDiff.abs()), biz)}. The carried-forward figure is used for all calculations.`);
  if (drafts) doc.warnings.push(`${drafts} draft entr${drafts === 1 ? "y is" : "ies are"} not included in these figures.`);
  return doc;
}

function formatRaw(v: string, biz: Business) {
  // Reconciliation is a text table, so format money here.
  const [i, f] = v.replace("-", "").split(".");
  const g = biz.numberGrouping === "INDIAN" && i.length > 3 ? `${i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${i.slice(-3)}` : i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${v.startsWith("-") ? "-" : ""}${g}.${f}`;
}

// ---------------------------------------------------------------------------
// Profit & Loss (from classified accounting data only)
// ---------------------------------------------------------------------------
export type ProfitLossData = {
  sufficient: boolean;
  revenue: Decimal;
  expenses: Decimal;
  net: Decimal;
  income: Array<{ code: string; name: string; amount: Decimal }>;
  expense: Array<{ code: string; name: string; amount: Decimal }>;
  unclassifiedCount: number;
  unclassifiedDebit: Decimal;
  unclassifiedCredit: Decimal;
};

export async function profitLossData(ctx: Pick<Ctx, "businessId">, from: string, to: string): Promise<ProfitLossData> {
  const [totals, un] = await Promise.all([
    accountTotals(db, ctx.businessId, { from, to }),
    db.transaction.aggregate({
      where: { businessId: ctx.businessId, status: "POSTED", categoryId: null, transactionDate: { gte: fromIso(from), lte: fromIso(to) } },
      _count: { _all: true },
      _sum: { debitAmount: true, creditAmount: true },
    }),
  ]);
  const income = totals.filter((t) => t.type === "INCOME").map((t) => ({ code: t.code, name: t.name, amount: t.credit.minus(t.debit) }));
  const expense = totals.filter((t) => t.type === "EXPENSE").map((t) => ({ code: t.code, name: t.name, amount: t.debit.minus(t.credit) }));
  const revenue = income.reduce((a, r) => a.plus(r.amount), ZERO);
  const expenses = expense.reduce((a, r) => a.plus(r.amount), ZERO);
  return {
    sufficient: income.length + expense.length > 0,
    revenue,
    expenses,
    net: revenue.minus(expenses),
    income,
    expense,
    unclassifiedCount: un._count._all,
    unclassifiedDebit: D(un._sum.debitAmount),
    unclassifiedCredit: D(un._sum.creditAmount),
  };
}

export async function buildProfitLoss(ctx: Pick<Ctx, "businessId">, from: string, to: string): Promise<ReportDoc> {
  checkRange(from, to);
  const biz = await getBusiness(ctx.businessId);
  const doc = baseDoc(biz, "profit-loss", "Profit & Loss Statement", rangeLabel(from, to, biz.displayCalendar));
  const pl = await profitLossData(ctx, from, to);
  if (!pl.sufficient) {
    doc.warnings.push("Insufficient data: no entries in this period have been classified as income or expense.");
    doc.notes.push(
      "A billpad entry only records a debit or credit amount. Whether it is income or an expense depends on what the entry represents. To calculate profit or loss, choose a Category (for example Sales, Purchases, Rent) on each entry, or post a journal entry in Accounts.",
    );
    return doc;
  }
  const cols: Section["columns"] = [{ key: "code", label: "Code" }, { key: "name", label: "Account" }, { key: "amount", label: "Amount", align: "right", type: "money" }];
  doc.sections.push({ heading: "Revenue", columns: cols, rows: pl.income.map((r) => ({ code: r.code, name: r.name, amount: m(r.amount) })), totals: { code: "", name: "Total Revenue", amount: m(pl.revenue) }, emptyMessage: "No revenue recorded." });
  doc.sections.push({ heading: "Expenses", columns: cols, rows: pl.expense.map((r) => ({ code: r.code, name: r.name, amount: m(r.amount) })), totals: { code: "", name: "Total Expenses", amount: m(pl.expenses) }, emptyMessage: "No expenses recorded." });
  doc.sections.push({
    heading: "Result",
    columns: [{ key: "name", label: "" }, { key: "amount", label: "Amount", align: "right", type: "money" }],
    rows: [
      { name: "Total Revenue", amount: m(pl.revenue) },
      { name: "Total Expenses", amount: m(pl.expenses) },
    ],
    totals: { name: pl.net.isNegative() ? "Net Loss" : "Net Profit", amount: m(pl.net) },
  });
  doc.meta.push(["Total Revenue", m(pl.revenue)], ["Total Expenses", m(pl.expenses)], [pl.net.isNegative() ? "Net Loss" : "Net Profit", m(pl.net)]);
  if (pl.unclassifiedCount) {
    const n = pl.unclassifiedCount;
    doc.warnings.push(
      `${n} billpad entr${n === 1 ? "y" : "ies"} in this period (debit ${formatRaw(m(pl.unclassifiedDebit), biz)}, credit ${formatRaw(m(pl.unclassifiedCredit), biz)}) ${n === 1 ? "has" : "have"} no category and ${n === 1 ? "is" : "are"} NOT included. This result is incomplete until ${n === 1 ? "it is" : "they are"} classified.`,
    );
  }
  doc.notes.push("Revenue and expenses come only from entries classified with an income or expense category, and from manual journal entries.");
  return doc;
}

// ---------------------------------------------------------------------------
// Trial balance
// ---------------------------------------------------------------------------
export async function buildTrialBalance(ctx: Pick<Ctx, "businessId">, asOf: string): Promise<ReportDoc> {
  const biz = await getBusiness(ctx.businessId);
  const doc = baseDoc(biz, "trial-balance", "Trial Balance", `As of ${formatDate(asOf, biz.displayCalendar)} ${biz.displayCalendar}`);
  const totals = await accountTotals(db, ctx.businessId, { to: asOf });
  if (!totals.length) {
    doc.warnings.push("No accounting entries exist yet, so there is no trial balance to show.");
    doc.notes.push("A trial balance needs classified accounting data. Assign categories to billpad entries or post journal entries under Accounts. The Ledger's running balance is a different report and is not a trial balance.");
    return doc;
  }
  let dr = ZERO;
  let cr = ZERO;
  const rows = totals.map((t) => {
    const net = t.debit.minus(t.credit);
    const debit = net.gt(0) ? net : ZERO;
    const credit = net.lt(0) ? net.abs() : ZERO;
    dr = dr.plus(debit);
    cr = cr.plus(credit);
    return { code: t.code, name: t.name, type: t.type.charAt(0) + t.type.slice(1).toLowerCase(), debit: debit.isZero() ? "" : m(debit), credit: credit.isZero() ? "" : m(credit) };
  });
  doc.sections.push({
    columns: [
      { key: "code", label: "Code" },
      { key: "name", label: "Account" },
      { key: "type", label: "Type" },
      { key: "debit", label: "Debit", align: "right", type: "money" },
      { key: "credit", label: "Credit", align: "right", type: "money" },
    ],
    rows,
    totals: { code: "", name: "Total", type: "", debit: m(dr), credit: m(cr) },
  });
  const diff = dr.minus(cr);
  doc.meta.push(["Total Debit", m(dr)], ["Total Credit", m(cr)], ["Imbalance", m(diff)]);
  if (!diff.isZero()) doc.warnings.push(`The trial balance is out by ${m(diff.abs())}.`);
  else doc.notes.push("Total debits equal total credits.");
  return doc;
}
