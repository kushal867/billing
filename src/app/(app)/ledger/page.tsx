import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { getBusiness } from "@/lib/services/periods";
import { listLedger, summarizePeriod, type LedgerSortField } from "@/lib/services/ledger";
import { monthsBetween, resolveLedgerPeriod } from "@/lib/services/ledger-period";
import { formatDate } from "@/lib/dates";
import { conventionText } from "@/lib/services/reports";
import { LedgerTable } from "@/components/ledger-table";
import { getT } from "@/lib/i18n/server";
import { LiveSearch } from "@/components/live-search";
import { suggestNextBillNumber } from "@/lib/services/transactions";
import { DateRangeSelector } from "@/components/date-range-selector";
import { ExportControls } from "@/components/export-controls";
import { Pagination } from "@/components/pagination";
import { SummaryCard } from "@/components/summary-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/input";
import { EmptyState, PageHeader } from "@/components/ui/states";

export const metadata: Metadata = { title: "Ledger" };
export const dynamic = "force-dynamic";

type SP = Record<string, string | undefined>;
const SORTABLE: Array<{ key: LedgerSortField; label: string; right?: boolean }> = [
  { key: "date", label: "Date" },
  { key: "bill", label: "Bill No." },
  { key: "debit", label: "Debit", right: true },
  { key: "credit", label: "Credit", right: true },
  { key: "balance", label: "Balance", right: true },
];

export default async function LedgerPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const { t } = await getT();
  const ctx = await requireCtx();
  const biz = await getBusiness(ctx.businessId);
  const cal = biz.displayCalendar;
  const g = biz.numberGrouping;
  const range = await resolveLedgerPeriod(ctx.businessId, biz, sp);
  const sort = (SORTABLE.some((s) => s.key === sp.sort) ? sp.sort : biz.defaultSortField) as LedgerSortField;
  const dir = sp.dir === "desc" || sp.dir === "asc" ? sp.dir : (biz.defaultSortDir as "asc" | "desc");
  const status = sp.status === "DRAFT" || sp.status === "VOID" ? sp.status : "POSTED";
  const type = sp.type === "debit" || sp.type === "credit" ? sp.type : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const filters = { from: range.all ? undefined : range.from, to: range.all ? undefined : range.to, q: sp.q, type, categoryId: sp.category || undefined, status } as const;

  const [data, summary, categories, years, nextBill] = await Promise.all([
    listLedger(ctx, { ...filters, sort, dir, page, pageSize: 50 }),
    summarizePeriod(ctx, range.from, range.to),
    db.category.findMany({ where: { businessId: ctx.businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.financialYear.findMany({ where: { businessId: ctx.businessId }, orderBy: { startDate: "desc" } }),
    suggestNextBillNumber(ctx),
  ]);
  const selectedYear = years.find((y) => y.id === sp.fy);
  const monthOptions = selectedYear ? monthsBetween(selectedYear.startDate.toISOString().slice(0, 10), selectedYear.endDate.toISOString().slice(0, 10), cal) : [];
  const write = canWrite(ctx.role);
  const usingPicker = !!(sp.fy || sp.month);
  const keep: SP = { range: usingPicker ? undefined : range.all ? "all" : range.key, from: range.key === "custom" && !usingPicker ? range.from : undefined, to: range.key === "custom" && !usingPicker ? range.to : undefined, fy: sp.fy, month: sp.month, q: sp.q, type: type === "all" ? undefined : type, status: status === "POSTED" ? undefined : status, category: sp.category };
  const sortHref = (key: LedgerSortField) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) q.set(k, v);
    q.set("sort", key);
    q.set("dir", sort === key && dir === "asc" ? "desc" : "asc");
    return `/ledger?${q.toString()}`;
  };
  const exportQuery = { range: keep.range, from: keep.from, to: keep.to, fy: sp.fy, month: sp.month, q: sp.q, type: keep.type, status: keep.status, category: sp.category };

  return (
    <>
      <PageHeader
        title={t("Ledger")}
        description={`${t("Every entry with its running balance.")} ${t(conventionText(biz.balanceConvention))}.`}
        actions={<>{write && <Button asChild><Link href="/entries/new">{t("Add Entry")}</Link></Button>}{write && <Button asChild variant="outline"><Link href="/entries/bulk">{t("Bulk Entry")}</Link></Button>}<ExportControls report="ledger" query={exportQuery} /></>}
      />

      <div className="hidden print:block">
        <h1 className="text-lg font-semibold">{biz.name} - {t("Ledger")}</h1>
        <p className="mb-3 text-sm">{range.all ? t("All dates") : `${formatDate(range.from, cal)} to ${formatDate(range.to, cal)} ${cal}`}</p>
      </div>

      <div className="space-y-4">
        <DateRangeSelector basePath="/ledger" current={{ key: range.key, from: range.from, to: range.to }} calendar={cal} extra={{ q: sp.q, type: keep.type, status: keep.status, category: sp.category }} presets={["all", "today", "month", "fy", "lastfy"]} />

        <form method="get" action="/ledger" className="no-print grid gap-3 rounded-lg border bg-white p-3 sm:grid-cols-2 lg:grid-cols-4">
          {keep.range && <input type="hidden" name="range" value={keep.range} />}
          {keep.from && <input type="hidden" name="from" value={keep.from} />}
          {keep.to && <input type="hidden" name="to" value={keep.to} />}
          <LiveSearch />
          <Select name="fy" defaultValue={sp.fy ?? ""} aria-label={t("Financial year")}><option value="">{t("Any financial year")}</option>{years.map((y) => <option key={y.id} value={y.id}>{t("FY")} {y.label}</option>)}</Select>
          <Select name="month" defaultValue={sp.month ?? ""} aria-label={t("Month")} disabled={!selectedYear}><option value="">{selectedYear ? t("Whole year") : t("Pick a year, then Filter")}</option>{monthOptions.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select>
          <Select name="type" defaultValue={type} aria-label={t("Entry type")}><option value="all">{t("Debit and credit")}</option><option value="debit">{t("Debit only")}</option><option value="credit">{t("Credit only")}</option></Select>
          <Select name="category" defaultValue={sp.category ?? ""} aria-label={t("Category")}><option value="">{t("All categories")}</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select name="status" defaultValue={status} aria-label={t("Status")}><option value="POSTED">{t("Saved entries")}</option><option value="DRAFT">{t("Drafts")}</option><option value="VOID">{t("Deleted")}</option></Select>
          <Button type="submit" variant="secondary">{t("Filter")}</Button>
        </form>

        {status === "POSTED" && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label={t("Opening Balance")} value={summary.opening.toFixed(2)} grouping={g} />
            <SummaryCard label={t("Total Debit")} value={summary.debit.toFixed(2)} grouping={g} />
            <SummaryCard label={t("Total Credit")} value={summary.credit.toFixed(2)} grouping={g} />
            <SummaryCard label={t("Closing Balance")} value={summary.closing.toFixed(2)} grouping={g} note={t("{n} entries in period", { n: summary.count })} />
          </div>
        )}

        <Card className="overflow-hidden print-area">
          {data.rows.length === 0 && !(write && status === "POSTED") ? (
            <EmptyState title={status === "DRAFT" ? t("No drafts") : status === "VOID" ? t("No deleted entries") : sp.q ? t("No entries match your search") : t("No entries in this period")} action={write && status === "POSTED" ? <Button asChild><Link href="/entries/new">{t("Add Entry")}</Link></Button> : undefined}>
              {sp.q ? t("Try a different bill number or word, or clear the filters.") : t("Entries you add from your billpad will appear here with their running balance.")}
            </EmptyState>
          ) : (
            <LedgerTable
              rows={data.rows.map((r) => ({
                id: r.id, version: r.version, date: r.date, billNumber: r.billNumber, debit: r.debit.toFixed(2), credit: r.credit.toFixed(2), balance: r.balance ? r.balance.toFixed(2) : null,
                description: r.description, categoryId: r.categoryId, categoryName: r.categoryName, partyId: r.partyId, partyName: r.partyName, status: r.status, createdByName: r.createdByName, updatedByName: r.updatedByName,
                updatedAt: r.updatedAt.toISOString(), flags: r.flags,
              }))}
              calendar={cal} grouping={g} canWrite={write} categories={categories} nextBill={nextBill} sort={sort} dir={dir}
              sortHrefs={{ date: sortHref("date"), bill: sortHref("bill"), debit: sortHref("debit"), credit: sortHref("credit"), balance: sortHref("balance") }}
              totals={{ count: data.total, debit: data.filteredDebit.toFixed(2), credit: data.filteredCredit.toFixed(2) }} quickAdd={write && status === "POSTED"}
            />
          )}
          <Pagination page={page} pageSize={50} total={data.total} basePath="/ledger" params={{ ...keep, sort: sp.sort, dir: sp.dir }} />
        </Card>
        <p className="no-print text-xs text-muted-foreground">{t("Balances are the running balance over the complete ledger, so they stay correct when you search, filter, sort or change pages.")}</p>
      </div>
    </>
  );
}
