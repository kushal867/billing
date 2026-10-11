import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { getBusiness, getAnchor } from "@/lib/services/periods";
import { listLedger, summarizePeriod } from "@/lib/services/ledger";
import { suggestNextBillNumber } from "@/lib/services/transactions";
import { formatDate } from "@/lib/dates";
import { EntryForm } from "@/components/entry-form";
import { PageHeader } from "@/components/ui/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Amt } from "@/components/amount";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Billpad Entry" };
export const dynamic = "force-dynamic";

export default async function NewEntryPage() {
  const ctx = await requireCtx();
  if (!canWrite(ctx.role)) redirect("/ledger");
  const biz = await getBusiness(ctx.businessId);
  const [categories, nextBill, recent, anchor, fy] = await Promise.all([
    db.category.findMany({ where: { businessId: ctx.businessId, isActive: true }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true } }),
    suggestNextBillNumber(ctx),
    listLedger(ctx, { sort: "date", dir: "desc", pageSize: 8 }),
    getAnchor(db, ctx.businessId),
    db.financialYear.count({ where: { businessId: ctx.businessId } }),
  ]);
  const summary = await summarizePeriod(ctx, "1900-01-01", "2999-12-31");
  const cal = biz.displayCalendar;
  const g = biz.numberGrouping;

  return (
    <>
      <PageHeader title="Billpad Entry" description="Enter each bill exactly as it appears on your billpad. Press Enter to save." />
      {!anchor.id && (
        <Alert tone="info" className="mb-4" title="Opening balance not set">
          Balances start from zero. If your billpad starts with a carried-forward balance, <Link className="underline" href="/settings#opening-balance">set the Opening Balance</Link> first.
        </Alert>
      )}
      {fy === 0 && <Alert tone="warning" className="mb-4">No financial year has been created yet. <Link className="underline" href="/settings#financial-years">Add one in Settings</Link>.</Alert>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardContent className="p-5">
            <EntryForm mode="create" calendar={cal} grouping={g} symbol={biz.currencySymbol} categories={categories} nextBill={nextBill} />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current balance</p>
            <p className="mt-1 text-2xl font-semibold"><span className="mr-1 text-sm font-normal text-muted-foreground">{biz.currencySymbol}</span><Amt v={summary.closing.toFixed(2)} grouping={g} /></p>
            <p className="text-xs text-muted-foreground">{biz.balanceConvention === "DEBIT_PLUS" ? "Previous + Debit - Credit" : "Previous + Credit - Debit"}</p>
          </Card>
          <Card>
            <CardHeader><CardTitle>Recent entries</CardTitle></CardHeader>
            <CardContent>
              {recent.rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No entries yet. Your first entry will appear here.</p>
              ) : (
                <ul className="divide-y text-sm">
                  {recent.rows.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <Link href={`/entries/${r.id}`} className="font-medium text-primary hover:underline">Bill {r.billNumber}</Link>
                        <p className="truncate text-xs text-muted-foreground">{formatDate(r.date, cal)}{r.description ? ` - ${r.description}` : ""}</p>
                      </div>
                      <div className="text-right">
                        <Amt v={(r.debit.isZero() ? r.credit : r.debit).toFixed(2)} grouping={g} />
                        <div><Badge>{r.debit.isZero() ? "Credit" : "Debit"}</Badge></div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
