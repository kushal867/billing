import { addDays, financialYearRange, financialYearStartFor, todayIso, adToBs, bsToAd, parseIso, type Calendar } from "./dates";

export type RangeKey = "all" | "today" | "month" | "last30" | "fy" | "lastfy" | "custom";
export const RANGE_LABELS: Record<RangeKey, string> = {
  all: "All time",
  today: "Today",
  month: "This month",
  last30: "Last 30 days",
  fy: "This financial year",
  lastfy: "Last financial year",
  custom: "Custom range",
};

export type FyConfig = { fyCalendar: Calendar; fyStartMonth: number; fyStartDay: number; displayCalendar: Calendar };

export function monthStart(iso: string, cal: Calendar): string {
  if (cal === "BS") {
    try {
      const b = adToBs(iso);
      return bsToAd({ y: b.y, m: b.m, d: 1 });
    } catch {
      /* fall through */
    }
  }
  const p = parseIso(iso)!;
  return `${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-01`;
}

export function resolveRange(
  sp: { range?: string; from?: string; to?: string },
  cfg: FyConfig,
  today: string = todayIso(),
): { key: RangeKey; from: string; to: string } {
  const isIso = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && parseIso(s) !== null;
  const key = (sp.range as RangeKey) in RANGE_LABELS ? (sp.range as RangeKey) : isIso(sp.from) && isIso(sp.to) ? "custom" : "fy";
  const fyStart = financialYearStartFor(today, cfg.fyCalendar, cfg.fyStartMonth, cfg.fyStartDay);
  switch (key) {
    case "all":
      return { key, from: "1900-01-01", to: "2999-12-31" };
    case "today":
      return { key, from: today, to: today };
    case "month":
      return { key, from: monthStart(today, cfg.displayCalendar), to: today };
    case "last30":
      return { key, from: addDays(today, -29), to: today };
    case "lastfy": {
      const r = financialYearRange(cfg.fyCalendar, cfg.fyStartMonth, cfg.fyStartDay, fyStart - 1);
      return { key, from: r.start, to: r.end };
    }
    case "custom":
      if (isIso(sp.from) && isIso(sp.to) && sp.from! <= sp.to!) return { key, from: sp.from!, to: sp.to! };
    // fall through to this financial year when custom dates are missing/invalid
    default: {
      const r = financialYearRange(cfg.fyCalendar, cfg.fyStartMonth, cfg.fyStartDay, fyStart);
      return { key: "fy", from: r.start, to: r.end };
    }
  }
}
