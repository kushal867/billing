import { requireCtx } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { buildReport, type ReportSlug } from "@/lib/services/report-registry";
import { DateRangeSelector } from "@/components/date-range-selector";
import { ExportControls } from "@/components/export-controls";
import { ReportView } from "@/components/report-view";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/states";
import { Alert } from "@/components/ui/alert";
import { AppError } from "@/lib/errors";
import { getT } from "@/lib/i18n/server";

export async function ReportPage({ slug, title, description, sp, fySelector }: { slug: ReportSlug; title: string; description: string; sp: Record<string, string | undefined>; fySelector?: boolean }) {
  const ctx = await requireCtx();
  const { t, lang } = await getT();
  let built;
  try {
    built = await buildReport(ctx, slug, sp, lang);
  } catch (e) {
    if (e instanceof AppError) return (<><PageHeader title={t(title)} /><Alert tone="error">{t(e.message)}</Alert></>);
    throw e;
  }
  const { doc, range, biz, fyId } = built;
  const years = fySelector ? await db.financialYear.findMany({ where: { businessId: ctx.businessId }, orderBy: { startDate: "desc" } }) : [];
  const query = fySelector ? { fy: fyId } : { range: range.key, from: range.key === "custom" ? range.from : undefined, to: range.key === "custom" ? range.to : undefined, rows: slug === "billpad" ? sp.rows : undefined };

  return (
    <>
      <PageHeader title={t(title)} description={t(description)} actions={<ExportControls report={slug} query={query} />} />
      <div className="space-y-4">
        {fySelector ? (
          <form method="get" className="no-print flex flex-wrap items-end gap-3 rounded-lg border bg-white p-3">
            <div className="space-y-1.5">
              <label htmlFor="fy" className="text-sm font-medium">{t("Financial year")}</label>
              <Select id="fy" name="fy" defaultValue={fyId} className="min-w-56">{years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}</Select>
            </div>
            <Button type="submit" variant="outline">{t("Show report")}</Button>
          </form>
        ) : (
          <>
            <DateRangeSelector basePath={`/reports/${slug}`} current={range} calendar={biz.displayCalendar} extra={{ rows: slug === "billpad" ? sp.rows : undefined }} />
            {slug === "billpad" && (
              <form method="get" className="no-print flex flex-wrap items-end gap-3 rounded-lg border bg-white p-3">
                <input type="hidden" name="range" value={range.key} />
                {range.key === "custom" && <><input type="hidden" name="from" value={range.from} /><input type="hidden" name="to" value={range.to} /></>}
                <div className="space-y-1.5"><label htmlFor="rows" className="text-sm font-medium">{t("Rows per page")}</label>
                  <Select id="rows" name="rows" defaultValue={sp.rows ?? "25"} className="w-32">{[10, 15, 20, 25, 30, 40].map((n) => <option key={n} value={n}>{n}</option>)}</Select></div>
                <Button type="submit" variant="outline">{t("Show report")}</Button>
              </form>
            )}
          </>
        )}
        <ReportView doc={doc} />
      </div>
    </>
  );
}
