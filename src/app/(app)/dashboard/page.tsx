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
import { getT } from "@/lib/i18n/server";
import { getSetupStatus } from "@/lib/services/onboarding";
import { SetupChecklist } from "@/components/setup-checklist";
import { getAlerts } from "@/lib/services/alerts";
import { AlertList } from "@/components/alert-list";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t } = await getT();
  const ctx = await requireCtx();
  const biz = await getBusiness(ctx.businessId);
  const cal = biz.displayCalendar;
  const g = biz.numberGrouping;
  const range = resolveRange(sp, { ...biz, displayCalendar: cal });
  const [d, setup, alerts] = await Promise.all([getDashboard(ctx, range.from, range.to), getSetupStatus(ctx.businessId), getAlerts(ctx)]);
  const write = canWrite(ctx.role);
  const empty = d.count === 0 && d.recent.length === 0;

  return (
    <>
      <PageHeader
        title={t("Dashboard")}
        description={`${biz.name} - ${t("figures for")} ${formatDate(range.from, cal)} ${t("to")} ${formatDate(range.to, cal)} ${cal}`}
        actions={
          <>
            {write && <Button asChild><Link href="/entries/new"><PlusCircle className="h-4 w-4" aria-hidden /> {t("Add Entry")}</Link></Button>}
            <Button asChild variant="outline"><Link href="/ledger"><BookOpen className="h-4 w-4" aria-hidden /> {t("View Ledger")}</Link></Button>
            <Button asChild variant="outline"><Link href="/reports"><FileBarChart className="h-4 w-4" aria-hidden /> {t("Generate Report")}</Link></Button>
          </>
        }
      />
      <div className="space-y-5">
        {!setup.complete && canWrite(ctx.role) && <SetupChecklist status={setup} />}
        <AlertList alerts={alerts} compact />
        <DateRangeSelector basePath="/dashboard" current={range} calendar={cal} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label={t("Opening Balance")} value={d.opening.toFixed(2)} grouping={g} note={t("Carried forward to the start of this period")} />
          <SummaryCard label={t("Total Debit")} value={d.debit.toFixed(2)} grouping={g} />
          <SummaryCard label={t("Total Credit")} value={d.credit.toFixed(2)} grouping={g} />
          <SummaryCard label={t("Current Balance")} value={d.current.toFixed(2)} grouping={g} tone="sign" note={`${t("As of")} ${formatDate(range.to, cal)}`} />
          <SummaryCard label={t("Total Income")} value={d.income.toFixed(2)} grouping={g} tone="income" note={t("Classified entries only")} />
          <SummaryCard label={t("Total Expenses")} value={d.expenses.toFixed(2)} grouping={g} tone="expense" note={t("Classified entries only")} />
          {d.net ? (
            <SummaryCard
              label={d.net.isNegative() ? t("Net Loss") : t("Net Profit")}
              value={d.net.toFixed(2)}
              grouping={g}
              tone="sign"
              note={d.unclassifiedCount ? (d.unclassifiedCount === 1 ? t("1 entry has no category and is not included") : t("{n} entries have no category and are not included", { n: d.unclassifiedCount })) : t("Income minus expenses")}
            />
          ) : (
            <SummaryCard label={t("Net Profit / Loss")} grouping={g} text={t("Insufficient data")} note={<>{t("Give entries an income or expense category.")} <Link className="underline" href="/reports/profit-loss">{t("Why?")}</Link></>} />
          )}
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("Entries added")}</p>
            <p className="mt-1 text-2xl font-semibold num">{d.addedToday} <span className="text-sm font-normal text-muted-foreground">{t("today")}</span></p>
            <p className="text-sm text-muted-foreground num">{d.addedThisMonth} {t("this month")}</p>
          </Card>
        </div>

        {empty ? (
          <Card>
            <EmptyState title={t("No entries yet")} action={write ? <Button asChild><Link href="/entries/new">{t("Add your first entry")}</Link></Button> : undefined}>
              {t("Open your billpad and enter the date, bill number and amount. Balances, charts and reports will fill in automatically.")}
            </EmptyState>
          </Card>
        ) : (
          <DashboardCharts data={d.months} grouping={g} hasClassified={d.months.some((m) => m.income || m.expense)} />
        )}

        <Card>
          <CardHeader><CardTitle>{t("Recent transactions")}</CardTitle></CardHeader>
          <CardContent>
            {d.recent.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{t("No transactions recorded yet.")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="tbl">
                  <thead><tr><th>{t("Date")}</th><th>{t("Bill No.")}</th><th>{t("Description")}</th><th className="text-right">{t("Debit")}</th><th className="text-right">{t("Credit")}</th><th className="text-right">{t("Balance")}</th></tr></thead>
                  <tbody>
                    {d.recent.map((r) => (
                      <tr key={r.id}>
                        <td className="num whitespace-nowrap">{formatDate(r.date, cal)}</td>
                        <td><Link className="font-medium text-primary hover:underline" href={`/entries/${r.id}`}>{r.billNumber}</Link>{r.flags.duplicateBill && <Badge tone="amber" className="ml-2">{t("Duplicate")}</Badge>}</td>
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
