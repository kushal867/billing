import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, Search } from "lucide-react";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { getBusiness } from "@/lib/services/periods";
import { listLedger, summarizePeriod, type LedgerSortField } from "@/lib/services/ledger";
import { monthsBetween, resolveLedgerPeriod } from "@/lib/services/ledger-period";
import { formatDate } from "@/lib/dates";
import { conventionText } from "@/lib/services/reports";
import { Amt } from "@/components/amount";
import { DateRangeSelector } from "@/components/date-range-selector";
import { ExportControls } from "@/components/export-controls";
import { Pagination } from "@/components/pagination";
import { SummaryCard } from "@/components/summary-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
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

  const [data, summary, categories, years] = await Promise.all([
    listLedger(ctx, { ...filters, sort, dir, page, pageSize: 50 }),
    summarizePeriod(ctx, range.from, range.to),
    db.category.findMany({ where: { businessId: ctx.businessId }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.financialYear.findMany({ where: { businessId: ctx.businessId }, orderBy: { startDate: "desc" } }),
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
        title="Ledger"
        description={`Every entry with its running balance. ${conventionText(biz.balanceConvention)}.`}
        actions={<>{write && <Button asChild><Link href="/entries/new">Add Entry</Link></Button>}<ExportControls report="ledger" query={exportQuery} /></>}
      />

      <div className="hidden print:block">
        <h1 className="text-lg font-semibold">{biz.name} - Ledger</h1>
        <p className="mb-3 text-sm">{range.all ? "All dates" : `${formatDate(range.from, cal)} to ${formatDate(range.to, cal)} ${cal}`}</p>
      </div>

      <div className="space-y-4">
        <DateRangeSelector basePath="/ledger" current={{ key: range.key, from: range.from, to: range.to }} calendar={cal} extra={{ q: sp.q, type: keep.type, status: keep.status, category: sp.category }} presets={["all", "today", "month", "fy", "lastfy"]} />

        <form method="get" action="/ledger" className="no-print grid gap-3 rounded-lg border bg-white p-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr_auto]">
          {keep.range && <input type="hidden" name="range" value={keep.range} />}
          {keep.from && <input type="hidden" name="from" value={keep.from} />}
          {keep.to && <input type="hidden" name="to" value={keep.to} />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input name="q" defaultValue={sp.q} placeholder="Search bill number or description" aria-label="Search" className="pl-9" />
          </div>
          <Select name="fy" defaultValue={sp.fy ?? ""} aria-label="Financial year"><option value="">Any financial year</option>{years.map((y) => <option key={y.id} value={y.id}>FY {y.label}</option>)}</Select>
          <Select name="month" defaultValue={sp.month ?? ""} aria-label="Month" disabled={!selectedYear}><option value="">{selectedYear ? "Whole year" : "Pick a year, then Filter"}</option>{monthOptions.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</Select>
          <Select name="type" defaultValue={type} aria-label="Entry type"><option value="all">Debit and credit</option><option value="debit">Debit only</option><option value="credit">Credit only</option></Select>
          <Select name="category" defaultValue={sp.category ?? ""} aria-label="Category"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
          <Select name="status" defaultValue={status} aria-label="Status"><option value="POSTED">Saved entries</option><option value="DRAFT">Drafts</option><option value="VOID">Deleted</option></Select>
          <Button type="submit" variant="secondary">Filter</Button>
        </form>

        {status === "POSTED" && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="Opening Balance" value={summary.opening.toFixed(2)} grouping={g} />
            <SummaryCard label="Total Debit" value={summary.debit.toFixed(2)} grouping={g} />
            <SummaryCard label="Total Credit" value={summary.credit.toFixed(2)} grouping={g} />
            <SummaryCard label="Closing Balance" value={summary.closing.toFixed(2)} grouping={g} note={`${summary.count} entries in period`} />
          </div>
        )}

        <Card className="overflow-hidden print-area">
          {data.rows.length === 0 ? (
            <EmptyState title={status === "DRAFT" ? "No drafts" : status === "VOID" ? "No deleted entries" : sp.q ? "No entries match your search" : "No entries in this period"} action={write && status === "POSTED" ? <Button asChild><Link href="/entries/new">Add Entry</Link></Button> : undefined}>
              {sp.q ? "Try a different bill number or word, or clear the filters." : "Entries you add from your billpad will appear here with their running balance."}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    {SORTABLE.slice(0, 2).map((s) => <SortTh key={s.key} s={s} sort={sort} dir={dir} href={sortHref(s.key)} />)}
                    <th>Description</th>
                    {SORTABLE.slice(2).map((s) => <SortTh key={s.key} s={s} sort={sort} dir={dir} href={sortHref(s.key)} />)}
                    <th className="no-print"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.id} className={r.status === "VOID" ? "bg-red-50/50 text-muted-foreground line-through" : r.flags.duplicateBill ? "bg-amber-50/60" : undefined}>
                      <td className="whitespace-nowrap num">{formatDate(r.date, cal)}</td>
                      <td className="whitespace-nowrap font-medium num">{r.billNumber || "-"}</td>
                      <td className="max-w-[22rem]">
                        <div className="break-words">{r.description || <span className="text-muted-foreground">-</span>}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 no-underline">
                          {r.categoryName && <Badge tone="blue">{r.categoryName}</Badge>}
                          {r.status === "DRAFT" && <Badge tone="amber">Draft</Badge>}
                          {r.flags.duplicateBill && <Badge tone="amber">Duplicate bill no.</Badge>}
                          {r.flags.large && <Badge tone="amber">Unusually large</Badge>}
                          {r.flags.future && <Badge tone="amber">Future date</Badge>}
                          {r.flags.reversal && <Badge tone="blue">Reversal</Badge>}
                          <span className="text-[11px] text-muted-foreground print:hidden">
                            {r.createdByName ? `by ${r.createdByName}` : ""}{r.updatedByName ? ` · edited by ${r.updatedByName} ${r.updatedAt.toISOString().slice(0, 10)}` : ""}
                          </span>
                        </div>
                      </td>
                      <td className="r"><Amt v={r.debit.toFixed(2)} grouping={g} blankZero /></td>
                      <td className="r"><Amt v={r.credit.toFixed(2)} grouping={g} blankZero /></td>
                      <td className="r font-medium">{r.balance ? <Amt v={r.balance.toFixed(2)} grouping={g} /> : <span className="text-muted-foreground">-</span>}</td>
                      <td className="no-print text-right">
                        <Button asChild variant="ghost" size="sm"><Link href={`/entries/${r.id}`} aria-label={`${write && r.status !== "VOID" ? "Edit" : "View"} bill ${r.billNumber}`}><Pencil className="h-3.5 w-3.5" aria-hidden />{write && r.status !== "VOID" ? "Edit" : "View"}</Link></Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted/60 font-semibold">
                    <td className="px-3 py-2" colSpan={3}>Total of {data.total} entr{data.total === 1 ? "y" : "ies"} matching filters</td>
                    <td className="r px-3 py-2"><Amt v={data.filteredDebit.toFixed(2)} grouping={g} /></td>
                    <td className="r px-3 py-2"><Amt v={data.filteredCredit.toFixed(2)} grouping={g} /></td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <Pagination page={page} pageSize={50} total={data.total} basePath="/ledger" params={{ ...keep, sort: sp.sort, dir: sp.dir }} />
        </Card>
        <p className="no-print text-xs text-muted-foreground">Balances are the running balance over the complete ledger, so they stay correct when you search, filter, sort or change pages.</p>
      </div>
    </>
  );
}

function SortTh({ s, sort, dir, href }: { s: { key: LedgerSortField; label: string; right?: boolean }; sort: string; dir: string; href: string }) {
  const Icon = sort === s.key ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
  return (
    <th className={s.right ? "text-right" : undefined} aria-sort={sort === s.key ? (dir === "asc" ? "ascending" : "descending") : "none"}>
      <Link href={href} className="inline-flex items-center gap-1 hover:text-foreground">{s.label}<Icon className="h-3 w-3 no-print" aria-hidden /></Link>
    </th>
  );
}
