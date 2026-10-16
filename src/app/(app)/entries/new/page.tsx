import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { getBusiness, getAnchor } from "@/lib/services/periods";
import { listLedger, summarizePeriod } from "@/lib/services/ledger";
import { partyNames } from "@/lib/services/parties";
import { suggestNextBillNumber } from "@/lib/services/transactions";
import { formatDate } from "@/lib/dates";
import { EntryForm } from "@/components/entry-form";
import { PageHeader } from "@/components/ui/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Amt } from "@/components/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Billpad Entry" };
export const dynamic = "force-dynamic";

export default async function NewEntryPage() {
  const ctx = await requireCtx();
  const { t } = await getT();
  if (!canWrite(ctx.role)) redirect("/ledger");
  const biz = await getBusiness(ctx.businessId);
  const [categories, nextBill, recent, anchor, fy, parties] = await Promise.all([
    db.category.findMany({ where: { businessId: ctx.businessId, isActive: true }, orderBy: [{ kind: "asc" }, { name: "asc" }], select: { id: true, name: true, kind: true } }),
    suggestNextBillNumber(ctx),
    listLedger(ctx, { sort: "date", dir: "desc", pageSize: 8 }),
    getAnchor(db, ctx.businessId),
    db.financialYear.count({ where: { businessId: ctx.businessId } }),
    partyNames(ctx),
  ]);
  const summary = await summarizePeriod(ctx, "1900-01-01", "2999-12-31");
  const cal = biz.displayCalendar;
  const g = biz.numberGrouping;

  return (
    <>
      <PageHeader title={t("Billpad Entry")} description={t("Enter each bill exactly as it appears on your billpad. Press Enter to save.")} actions={<Button asChild variant="outline"><Link href="/entries/bulk">{t("Bulk Entry")}</Link></Button>} />
      {!anchor.id && (
        <Alert tone="info" className="mb-4" title={t("Opening balance not set")}>
          {t("Balances start from zero. If your billpad starts with a carried-forward balance,")} <Link className="underline" href="/settings#opening-balance">{t("set the Opening Balance")}</Link> {t("first.")}
        </Alert>
      )}
      {fy === 0 && <Alert tone="warning" className="mb-4">{t("No financial year has been created yet.")} <Link className="underline" href="/settings#financial-years">{t("Add one in Settings")}</Link>.</Alert>}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardContent className="p-5">
            <EntryForm mode="create" calendar={cal} grouping={g} symbol={biz.currencySymbol} categories={categories} parties={parties} nextBill={nextBill} />
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("Current balance")}</p>
            <p className="mt-1 text-2xl font-semibold"><span className="mr-1 text-sm font-normal text-muted-foreground">{biz.currencySymbol}</span><Amt v={summary.closing.toFixed(2)} grouping={g} /></p>
            <p className="text-xs text-muted-foreground">{biz.balanceConvention === "DEBIT_PLUS" ? t("Previous + Debit - Credit") : t("Previous + Credit - Debit")}</p>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("Recent entries")}</CardTitle></CardHeader>
            <CardContent>
              {recent.rows.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">{t("No entries yet. Your first entry will appear here.")}</p>
              ) : (
                <ul className="divide-y text-sm">
                  {recent.rows.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <Link href={`/entries/${r.id}`} className="font-medium text-primary hover:underline">{t("Bill Number")} {r.billNumber}</Link>
                        <p className="truncate text-xs text-muted-foreground">{formatDate(r.date, cal)}{r.partyName ? ` - ${r.partyName}` : ""}{r.description ? ` - ${r.description}` : ""}</p>
                      </div>
                      <div className="text-right">
                        <Amt v={(r.debit.isZero() ? r.credit : r.debit).toFixed(2)} grouping={g} />
                        <div><Badge>{r.debit.isZero() ? t("Credit") : t("Debit")}</Badge></div>
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
