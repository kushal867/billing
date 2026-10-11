import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, FileBarChart, PlusCircle } from "lucide-react";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { getBusiness } from "@/lib/services/periods";
import { getDashboard } from "@/lib/services/dashboard";
import { resolveRange } from "@/lib/ranges";
import { formatDate } from "@/lib/dates";
import { DateRangeSelector } from "@/components/date-range-selector";
import { DashboardCharts } from "@/components/dashboard-charts";
import { SummaryCard } from "@/components/summary-card";
import { Amt } from "@/components/amount";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireCtx();
  const biz = await getBusiness(ctx.businessId);
  const cal = biz.displayCalendar;
  const g = biz.numberGrouping;
  const range = resolveRange(sp, { ...biz, displayCalendar: cal });
  const d = await getDashboard(ctx, range.from, range.to);
  const write = canWrite(ctx.role);
  const empty = d.count === 0 && d.recent.length === 0;

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${biz.name} - figures for ${formatDate(range.from, cal)} to ${formatDate(range.to, cal)} ${cal}`}
        actions={
          <>
            {write && <Button asChild><Link href="/entries/new"><PlusCircle className="h-4 w-4" aria-hidden /> Add Entry</Link></Button>}
            <Button asChild variant="outline"><Link href="/ledger"><BookOpen className="h-4 w-4" aria-hidden /> View Ledger</Link></Button>
            <Button asChild variant="outline"><Link href="/reports"><FileBarChart className="h-4 w-4" aria-hidden /> Generate Report</Link></Button>
          </>
        }
      />
      <div className="space-y-5">
        <DateRangeSelector basePath="/dashboard" current={range} calendar={cal} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Opening Balance" value={d.opening.toFixed(2)} grouping={g} note="Carried forward to the start of this period" />
          <SummaryCard label="Total Debit" value={d.debit.toFixed(2)} grouping={g} />
          <SummaryCard label="Total Credit" value={d.credit.toFixed(2)} grouping={g} />
          <SummaryCard label="Current Balance" value={d.current.toFixed(2)} grouping={g} tone="sign" note={`As of ${formatDate(range.to, cal)}`} />
          <SummaryCard label="Total Income" value={d.income.toFixed(2)} grouping={g} tone="income" note="Classified entries only" />
          <SummaryCard label="Total Expenses" value={d.expenses.toFixed(2)} grouping={g} tone="expense" note="Classified entries only" />
          {d.net ? (
            <SummaryCard
              label={d.net.isNegative() ? "Net Loss" : "Net Profit"}
              value={d.net.toFixed(2)}
              grouping={g}
              tone="sign"
              note={d.unclassifiedCount ? `${d.unclassifiedCount} ${d.unclassifiedCount === 1 ? "entry has" : "entries have"} no category and ${d.unclassifiedCount === 1 ? "is" : "are"} not included` : "Income minus expenses"}
            />
          ) : (
            <SummaryCard label="Net Profit / Loss" grouping={g} text="Insufficient data" note={<>Give entries an income or expense category. <Link className="underline" href="/reports/profit-loss">Why?</Link></>} />
          )}
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Entries added</p>
            <p className="mt-1 text-2xl font-semibold num">{d.addedToday} <span className="text-sm font-normal text-muted-foreground">today</span></p>
            <p className="text-sm text-muted-foreground num">{d.addedThisMonth} this month</p>
          </Card>
        </div>

        {empty ? (
          <Card>
            <EmptyState title="No entries yet" action={write ? <Button asChild><Link href="/entries/new">Add your first entry</Link></Button> : undefined}>
              Open your billpad and enter the date, bill number and amount. Balances, charts and reports will fill in automatically.
            </EmptyState>
          </Card>
        ) : (
          <DashboardCharts data={d.months} grouping={g} hasClassified={d.months.some((m) => m.income || m.expense)} />
        )}

        <Card>
          <CardHeader><CardTitle>Recent transactions</CardTitle></CardHeader>
          <CardContent>
            {d.recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No transactions recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Bill No.</th><th>Description</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead>
                  <tbody>
                    {d.recent.map((r) => (
                      <tr key={r.id}>
                        <td className="num whitespace-nowrap">{formatDate(r.date, cal)}</td>
                        <td><Link className="font-medium text-primary hover:underline" href={`/entries/${r.id}`}>{r.billNumber}</Link>{r.flags.duplicateBill && <Badge tone="amber" className="ml-2">Duplicate</Badge>}</td>
                        <td className="max-w-xs truncate">{r.description}</td>
                        <td className="r"><Amt v={r.debit.toFixed(2)} grouping={g} blankZero /></td>
                        <td className="r"><Amt v={r.credit.toFixed(2)} grouping={g} blankZero /></td>
                        <td className="r font-medium">{r.balance && <Amt v={r.balance.toFixed(2)} grouping={g} />}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
