import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { getBusiness } from "@/lib/services/periods";
import { getParty, getPartyRow, listParties, AGE_BUCKETS } from "@/lib/services/parties";
import { buildReport } from "@/lib/services/report-registry";
import { AppError } from "@/lib/errors";
import { PartyAdmin, PartyForm, PaymentForm } from "@/components/parties-forms";
import { DateRangeSelector } from "@/components/date-range-selector";
import { ExportControls } from "@/components/export-controls";
import { ReportView } from "@/components/report-view";
import { SummaryCard } from "@/components/summary-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/states";
import { Amt } from "@/components/amount";
import { getT } from "@/lib/i18n/server";
import { notFound } from "next/navigation";

export const metadata: Metadata = { title: "Party ledger" };
export const dynamic = "force-dynamic";

export default async function PartyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { t, lang } = await getT();
  const ctx = await requireCtx();
  let party, row;
  try {
    party = await getParty(ctx, id);
    row = await getPartyRow(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const biz = await getBusiness(ctx.businessId);
  const g = biz.numberGrouping;
  const write = canWrite(ctx.role);
  const { doc, range } = await buildReport(ctx, "party-statement", { ...sp, party: id }, lang);
  const others = (await listParties(ctx, { includeInactive: false })).filter((p) => p.id !== id).map((p) => ({ id: p.id, name: p.name }));
  const opening = Number(party.openingNet.toString());
  const exportQuery = { party: id, range: range.key, from: range.key === "custom" ? range.from : undefined, to: range.key === "custom" ? range.to : undefined };
  const phoneDigits = party.phone.replace(/[^\d+]/g, "");

  return (
    <>
      <PageHeader
        title={party.name}
        description={<span className="flex flex-wrap items-center gap-2">{row.kind === "SUPPLIER" ? <Badge tone="blue">{t("Supplier")}</Badge> : <Badge>{t("Customer")}</Badge>}{!party.isActive && <Badge tone="amber">{t("Hidden")}</Badge>}{party.phone && <a className="text-sm underline" href={`tel:${phoneDigits}`}>{party.phone}</a>}{party.address && <span className="text-sm">{party.address}</span>}</span>}
        actions={<ExportControls report="party-statement" query={exportQuery} />}
      />
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryCard
            label={row.net.gt(0) ? t("They owe you") : row.net.lt(0) ? t("You owe them") : t("Balance")}
            value={row.net.abs().toFixed(2)} grouping={g} tone={row.net.gt(0) ? "income" : row.net.lt(0) ? "expense" : "plain"}
            note={row.net.isZero() ? t("Fully settled") : undefined}
          />
          <SummaryCard label={t("Total billed (debit)")} value={row.debit.toFixed(2)} grouping={g} note={t("{n} entries", { n: row.entries })} />
          <SummaryCard label={t("Total paid (credit)")} value={row.credit.toFixed(2)} grouping={g} note={row.lastPaymentDate ? undefined : t("No payment yet")} />
        </div>

        {row.net.gt(0) && (
          <Card className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("How long it has been unpaid")}</p>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              {AGE_BUCKETS.map((b) => (
                <div key={b}><dt className="text-muted-foreground">{b === "90+" ? t("Over 90 days") : t("{range} days", { range: b })}</dt><dd className="text-lg font-semibold"><Amt v={row.ageing[b].toFixed(2)} grouping={g} tone={b === "90+" && !row.ageing[b].isZero() ? "expense" : "plain"} /></dd></div>
              ))}
            </dl>
          </Card>
        )}

        {write && party.isActive && (
          <Card className="no-print">
            <CardHeader><CardTitle>{t("Record a payment")}</CardTitle></CardHeader>
            <CardContent><PaymentForm partyId={id} calendar={biz.displayCalendar} symbol={biz.currencySymbol} owes={!row.net.lt(0)} /></CardContent>
          </Card>
        )}

        <DateRangeSelector basePath={`/parties/${id}`} current={range} calendar={biz.displayCalendar} presets={["all", "month", "last30", "fy", "lastfy"]} />
        <ReportView doc={doc} />
        {write && <p className="no-print text-sm"><Link className="text-primary underline" href={`/entries/new`}>{t("Add a bill for this party")}</Link> - {t("type their name in the Party box.")}</p>}

        {write && (
          <>
            <Card className="no-print">
              <CardHeader><CardTitle>{t("Party details")}</CardTitle></CardHeader>
              <CardContent>
                <PartyForm id={id} symbol={biz.currencySymbol} initial={{ name: party.name, kind: party.kind, phone: party.phone, address: party.address, notes: party.notes, openingAmount: opening === 0 ? "" : Math.abs(opening).toFixed(2), openingSide: opening < 0 ? "WE_OWE" : "THEY_OWE" }} />
              </CardContent>
            </Card>
            <Card className="no-print"><CardContent className="p-4"><PartyAdmin id={id} name={party.name} isActive={party.isActive} others={others} /></CardContent></Card>
          </>
        )}
        {!write && <Alert tone="info">{t("You can view this party but not change it.")}</Alert>}
      </div>
    </>
  );
}
