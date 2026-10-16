import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { getBusiness } from "@/lib/services/periods";
import { listParties, totalsOf, type PartyFilter } from "@/lib/services/parties";
import { formatDate } from "@/lib/dates";
import { PartyForm } from "@/components/parties-forms";
import { ExportControls } from "@/components/export-controls";
import { LiveSearch } from "@/components/live-search";
import { SummaryCard } from "@/components/summary-card";
import { Amt } from "@/components/amount";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/states";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Parties" };
export const dynamic = "force-dynamic";

const FILTERS: Array<{ key: PartyFilter; label: string }> = [
  { key: "all", label: "Everyone" }, { key: "owes", label: "They owe me" }, { key: "owed", label: "I owe them" }, { key: "settled", label: "Settled" },
];

export default async function PartiesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { t } = await getT();
  const ctx = await requireCtx();
  const biz = await getBusiness(ctx.businessId);
  const g = biz.numberGrouping;
  const filter = (FILTERS.some((f) => f.key === sp.filter) ? sp.filter : "all") as PartyFilter;
  const [all, rows] = await Promise.all([listParties(ctx), listParties(ctx, { q: sp.q, filter })]);
  const totals = totalsOf(all);
  const write = canWrite(ctx.role);
  const sorted = [...rows].sort((a, b) => b.net.abs().comparedTo(a.net.abs()) || a.name.localeCompare(b.name));
  const href = (f: PartyFilter) => `/parties?${new URLSearchParams({ ...(f !== "all" ? { filter: f } : {}), ...(sp.q ? { q: sp.q } : {}) }).toString()}`;

  return (
    <>
      <PageHeader title={t("Parties")} description={t("Every customer and supplier with their own balance - who owes you and whom you owe.")} actions={<ExportControls report="outstanding" query={{}} />} />
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard label={t("You will receive")} value={totals.receivable.toFixed(2)} grouping={g} tone="income" note={t("{n} parties owe you", { n: totals.owingCount })} />
          <SummaryCard label={t("You need to pay")} value={totals.payable.toFixed(2)} grouping={g} tone="expense" note={t("{n} parties you owe", { n: totals.owedCount })} />
          <SummaryCard label={t("Parties")} text={String(all.length)} grouping={g} />
        </div>

        <form method="get" action="/parties" className="no-print flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3">
          {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
          <div className="min-w-56 flex-1"><LiveSearch /></div>
          <nav aria-label={t("Filter parties")} className="flex flex-wrap gap-1.5">
            {FILTERS.map((f) => <Link key={f.key} href={href(f.key)} aria-current={f.key === filter ? "page" : undefined} className={`rounded-full border px-3 py-1 text-sm ${f.key === filter ? "border-primary bg-primary text-white" : "bg-white hover:bg-muted"}`}>{t(f.label)}</Link>)}
          </nav>
        </form>

        <Card className="overflow-hidden">
          {sorted.length === 0 ? (
            <EmptyState title={sp.q ? t("No party matches your search") : t("No parties yet")}>
              {t("Type a customer or supplier name when you add an entry, or add one below. Each party gets their own ledger.")}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th scope="col" className="px-3 py-2">{t("Party")}</th><th scope="col" className="px-3 py-2">{t("Phone")}</th><th scope="col" className="px-3 py-2">{t("Last payment")}</th><th scope="col" className="px-3 py-2">{t("Oldest unpaid")}</th><th scope="col" className="px-3 py-2 text-right">{t("Balance")}</th>
                </tr></thead>
                <tbody className="divide-y">
                  {sorted.map((r) => (
                    <tr key={r.id} className="hover:bg-muted/30">
                      <td className="px-3 py-2"><Link href={`/parties/${r.id}`} className="font-medium text-primary hover:underline">{r.name}</Link> {r.kind === "SUPPLIER" && <Badge tone="blue">{t("Supplier")}</Badge>}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.phone || "-"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{r.lastPaymentDate ? formatDate(r.lastPaymentDate, biz.displayCalendar) : "-"}</td>
                      <td className="px-3 py-2">{r.net.gt(0) && r.oldestDays !== null ? <Badge tone={r.oldestDays > 60 ? "red" : r.oldestDays > 30 ? "amber" : "neutral"}>{t("{n} days", { n: r.oldestDays })}</Badge> : <span className="text-muted-foreground">-</span>}</td>
                      <td className="px-3 py-2 text-right">
                        {r.net.isZero() ? <span className="text-muted-foreground">{t("Settled")}</span> : <><Amt v={r.net.abs().toFixed(2)} grouping={g} tone={r.net.gt(0) ? "income" : "expense"} /> <span className="text-xs text-muted-foreground">{r.net.gt(0) ? t("owes you") : t("you owe")}</span></>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {write && (
          <Card className="no-print">
            <CardHeader><CardTitle>{t("Add a party")}</CardTitle></CardHeader>
            <CardContent><PartyForm symbol={biz.currencySymbol} /></CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
