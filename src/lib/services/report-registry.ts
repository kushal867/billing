import type { Business } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { notFound } from "@/lib/errors";
import { resolveRange, type RangeKey } from "@/lib/ranges";
import { toIso } from "@/lib/dates";
import type { LedgerFilters } from "./ledger";
import { ensureCurrentFinancialYear, getBusiness } from "./periods";
import { buildAnnualReport, buildDailyReport, buildLedgerReport, buildMonthlyReport, buildProfitLoss, buildTrialBalance } from "./reports";
import type { ReportDoc } from "./report-doc";

export const REPORT_SLUGS = ["ledger", "daily", "monthly", "annual", "profit-loss", "trial-balance"] as const;
export type ReportSlug = (typeof REPORT_SLUGS)[number];
export type ReportParams = Record<string, string | undefined>;

export type BuiltReport = { doc: ReportDoc; range: { key: RangeKey; from: string; to: string }; fyId?: string; biz: Business };

/** Single entry point used by both the report pages and the export API, so exports always match the screen. */
export async function buildReport(ctx: Ctx, slug: ReportSlug, sp: ReportParams): Promise<BuiltReport> {
  const biz = await getBusiness(ctx.businessId);
  const cfg = { ...biz, displayCalendar: biz.displayCalendar };
  const withDefault = (key: RangeKey) => resolveRange({ ...sp, range: sp.range ?? (sp.from && sp.to ? "custom" : key) }, cfg);
  switch (slug) {
    case "ledger": {
      const r = withDefault("all");
      const f: LedgerFilters = {
        from: r.key === "all" ? undefined : r.from,
        to: r.key === "all" ? undefined : r.to,
        q: sp.q,
        type: sp.type === "debit" || sp.type === "credit" ? sp.type : "all",
        categoryId: sp.category || undefined,
        status: sp.status === "DRAFT" || sp.status === "VOID" ? sp.status : "POSTED",
        sort: "date",
        dir: "asc",
      };
      return { doc: await buildLedgerReport(ctx, f), range: r, biz };
    }
    case "daily": {
      const r = withDefault("today");
      return { doc: await buildDailyReport(ctx, r.from, r.to), range: r, biz };
    }
    case "monthly": {
      const r = withDefault("fy");
      return { doc: await buildMonthlyReport(ctx, r.from, r.to), range: r, biz };
    }
    case "profit-loss": {
      const r = withDefault("fy");
      return { doc: await buildProfitLoss(ctx, r.from, r.to), range: r, biz };
    }
    case "trial-balance": {
      const r = withDefault("fy");
      return { doc: await buildTrialBalance(ctx, r.to), range: r, biz };
    }
    case "annual": {
      let fy = sp.fy ? await db.financialYear.findFirst({ where: { id: sp.fy, businessId: ctx.businessId } }) : null;
      if (sp.fy && !fy) throw notFound("Financial year");
      fy ??= await ensureCurrentFinancialYear(ctx);
      const doc = await buildAnnualReport(ctx, fy.id);
      return { doc, range: { key: "fy", from: toIso(fy.startDate), to: toIso(fy.endDate) }, fyId: fy.id, biz };
    }
  }
}
