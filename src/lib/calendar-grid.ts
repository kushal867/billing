import { adToBs, AD_MONTHS, BS_MAX_YEAR, BS_MIN_YEAR, BS_MONTHS, bsMonthDays, bsToAd, parseIso, ymdToIso, type Calendar } from "./dates";

export type GridDay = { day: number; iso: string; other: number | null };
export type MonthGrid = { year: number; month: number; label: string; leading: number; days: GridDay[]; canPrev: boolean; canNext: boolean };

const weekday = (iso: string) => {
  const p = parseIso(iso)!;
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); // 0 = Sunday
};

/** The AD/BS day-of-month shown small under each date, so both calendars can be read at once. */
function otherDay(iso: string, cal: Calendar): number | null {
  try {
    return cal === "BS" ? parseIso(iso)!.d : adToBs(iso).d;
  } catch {
    return null;
  }
}

/** Month layout for a BS or AD month. `leading` blank cells come before day 1 (weeks start on Sunday). */
export function monthGrid(cal: Calendar, year: number, month: number): MonthGrid {
  if (cal === "BS") {
    const count = bsMonthDays(year, month);
    const first = bsToAd({ y: year, m: month, d: 1 });
    const days: GridDay[] = [];
    for (let d = 1; d <= count; d++) {
      const iso = bsToAd({ y: year, m: month, d });
      days.push({ day: d, iso, other: otherDay(iso, "BS") });
    }
    return {
      year, month, label: `${BS_MONTHS[month - 1]} ${year}`, leading: weekday(first), days,
      canPrev: !(year === BS_MIN_YEAR && month === 1), canNext: !(year === BS_MAX_YEAR && month === 12),
    };
  }
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const first = ymdToIso({ y: year, m: month, d: 1 });
  const days: GridDay[] = [];
  for (let d = 1; d <= count; d++) {
    const iso = ymdToIso({ y: year, m: month, d });
    days.push({ day: d, iso, other: otherDay(iso, "AD") });
  }
  return { year, month, label: `${AD_MONTHS[month - 1]} ${year}`, leading: weekday(first), days, canPrev: year > 1944, canNext: year < 2033 };
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}
