import type { Business } from "@prisma/client";
import { db } from "@/lib/db";
import { notFound } from "@/lib/errors";
import { addDays, adToBs, bsToAd, bsMonthDays, monthBucket, parseIso, toIso, type Calendar } from "@/lib/dates";
import { resolveRange, type RangeKey } from "@/lib/ranges";

export type LedgerPeriod = { key: RangeKey; from: string; to: string; all: boolean; fyId?: string; month?: string };
export type MonthOption = { key: string; label: string };

/** Inclusive AD range of a "YYYY-MM" month key in the given display calendar. */
export function monthRange(key: string, cal: Calendar): { from: string; to: string } | null {
  const p = /^(\d{4})-(\d{2})$/.exec(key);
  if (!p) return null;
  const y = Number(p[1]);
  const m = Number(p[2]);
  try {
    if (cal === "BS") return { from: bsToAd({ y, m, d: 1 }), to: bsToAd({ y, m, d: bsMonthDays(y, m) }) };
    if (m < 1 || m > 12) return null;
    const first = `${p[1]}-${p[2]}-01`;
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    return { from: first, to: last };
  } catch {
    return null;
  }
}

/** Months (in the display calendar) that overlap a date range, in order. */
export function monthsBetween(from: string, to: string, cal: Calendar): MonthOption[] {
  const seen = new Map<string, MonthOption & { sort: number }>();
  for (let d = from, guard = 0; d <= to && guard < 800; d = addDays(d, 1), guard++) {
    const b = monthBucket(d, cal);
    if (!seen.has(b.key)) seen.set(b.key, { key: b.key, label: b.label, sort: b.sort });
  }
  return [...seen.values()].sort((a, b) => a.sort - b.sort).map(({ key, label }) => ({ key, label }));
}

/**
 * Resolves the ledger's period from URL params. A chosen financial year and/or month
 * takes priority over the preset/custom range. Used by BOTH the page and the export
 * route so a printed/exported ledger always matches what is on screen.
 */
export async function resolveLedgerPeriod(businessId: string, biz: Business, sp: Record<string, string | undefined>): Promise<LedgerPeriod> {
  const cal = biz.displayCalendar;
  if (sp.fy || sp.month) {
    let from = "1900-01-01";
    let to = "2999-12-31";
    if (sp.fy) {
      const fy = await db.financialYear.findFirst({ where: { id: sp.fy, businessId } });
      if (!fy) throw notFound("Financial year");
      from = toIso(fy.startDate);
      to = toIso(fy.endDate);
    }
    if (sp.month) {
      const r = monthRange(sp.month, cal);
      if (r) {
        const f = r.from > from ? r.from : from;
        const t = r.to < to ? r.to : to;
        if (f <= t) { from = f; to = t; }
      }
    }
    return { key: "custom", from, to, all: false, fyId: sp.fy, month: sp.month };
  }
  const r = resolveRange({ ...sp, range: sp.range ?? (sp.from ? "custom" : "all") }, { ...biz, displayCalendar: cal });
  return { ...r, all: r.key === "all" };
}

export { adToBs, parseIso };
