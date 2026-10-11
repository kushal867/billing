/**
 * Bikram Sambat (BS) <-> Gregorian (AD) conversion.
 *
 * Month lengths come from the verified table shipped with `nepali-date-converter`
 * (BS 2000-2090). The conversion itself is plain day-counting from a fixed, well
 * known anchor (BS 2000-01-01 == AD 1943-04-14), so there is no approximation and
 * out-of-range or impossible dates are rejected instead of being rolled over.
 */
import { dateConfigMap } from "nepali-date-converter";

export const BS_MIN_YEAR = 2000;
export const BS_MAX_YEAR = 2090;

export const BS_MONTHS = [
  "Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Aswin",
  "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra",
] as const;
export const AD_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

const MONTH_KEYS = BS_MONTHS as readonly string[];
const ANCHOR_AD_MS = Date.UTC(1943, 3, 14);
const DAY_MS = 86_400_000;

export type YMD = { y: number; m: number; d: number }; // m is 1-12

const monthDaysTable: Record<number, number[]> = {};
for (let y = BS_MIN_YEAR; y <= BS_MAX_YEAR; y++) {
  const row = (dateConfigMap as unknown as Record<string, Record<string, number>>)[String(y)];
  monthDaysTable[y] = MONTH_KEYS.map((k) => row[k]);
}

// cumulative day offset of 1 Baisakh of each BS year from the anchor
const yearStartOffset: Record<number, number> = {};
{
  let acc = 0;
  for (let y = BS_MIN_YEAR; y <= BS_MAX_YEAR + 1; y++) {
    yearStartOffset[y] = acc;
    if (y <= BS_MAX_YEAR) acc += monthDaysTable[y].reduce((a, b) => a + b, 0);
  }
}

export function bsMonthDays(y: number, m: number): number {
  if (y < BS_MIN_YEAR || y > BS_MAX_YEAR || m < 1 || m > 12) throw new RangeError(`BS month out of range: ${y}-${m}`);
  return monthDaysTable[y][m - 1];
}

export function isValidBs({ y, m, d }: YMD): boolean {
  if (![y, m, d].every(Number.isInteger)) return false;
  if (y < BS_MIN_YEAR || y > BS_MAX_YEAR || m < 1 || m > 12) return false;
  return d >= 1 && d <= bsMonthDays(y, m);
}

export function isValidAd({ y, m, d }: YMD): boolean {
  if (![y, m, d].every(Number.isInteger)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
export const ymdToIso = ({ y, m, d }: YMD) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

export function parseIso(s: string): YMD | null {
  const mt = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
  if (!mt) return null;
  return { y: +mt[1], m: +mt[2], d: +mt[3] };
}

/** AD ISO date (YYYY-MM-DD) -> BS. Throws RangeError if outside the supported table. */
export function adToBs(iso: string): YMD {
  const p = parseIso(iso);
  if (!p || !isValidAd(p)) throw new RangeError(`Invalid AD date: ${iso}`);
  const offset = Math.round((Date.UTC(p.y, p.m - 1, p.d) - ANCHOR_AD_MS) / DAY_MS);
  if (offset < 0 || offset >= yearStartOffset[BS_MAX_YEAR + 1]) throw new RangeError(`AD date ${iso} is outside the supported BS range`);
  let y = BS_MIN_YEAR;
  while (y < BS_MAX_YEAR && yearStartOffset[y + 1] <= offset) y++;
  let rem = offset - yearStartOffset[y];
  let m = 1;
  while (rem >= monthDaysTable[y][m - 1]) {
    rem -= monthDaysTable[y][m - 1];
    m++;
  }
  return { y, m, d: rem + 1 };
}

/** BS -> AD ISO date. Throws on impossible dates (e.g. 2082-01-33). */
export function bsToAd(bs: YMD): string {
  if (!isValidBs(bs)) throw new RangeError(`Invalid BS date: ${ymdToIso(bs)}`);
  let offset = yearStartOffset[bs.y];
  for (let i = 0; i < bs.m - 1; i++) offset += monthDaysTable[bs.y][i];
  offset += bs.d - 1;
  const dt = new Date(ANCHOR_AD_MS + offset * DAY_MS);
  return ymdToIso({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
}

export type Calendar = "BS" | "AD";

/** Parse user-typed text in the given calendar into an AD ISO date. Never guesses. */
export function parseEnteredDate(text: string, calendar: Calendar): { ok: true; iso: string } | { ok: false; error: string } {
  const p = parseIso(text.replace(/[/.]/g, "-"));
  if (!p) return { ok: false, error: "Enter the date as YYYY-MM-DD" };
  if (calendar === "BS") {
    if (!isValidBs(p)) {
      return {
        ok: false,
        error:
          p.y < BS_MIN_YEAR || p.y > BS_MAX_YEAR
            ? `BS year must be between ${BS_MIN_YEAR} and ${BS_MAX_YEAR}`
            : p.m < 1 || p.m > 12
              ? "Month must be 1-12"
              : `${BS_MONTHS[p.m - 1]} ${p.y} has only ${bsMonthDays(p.y, p.m)} days`,
      };
    }
    return { ok: true, iso: bsToAd(p) };
  }
  if (!isValidAd(p)) return { ok: false, error: "That is not a real calendar date" };
  return { ok: true, iso: ymdToIso(p) };
}

export function formatDate(iso: string | Date, calendar: Calendar): string {
  const s = typeof iso === "string" ? iso.slice(0, 10) : toIso(iso);
  if (calendar === "AD") return s;
  try {
    return ymdToIso(adToBs(s));
  } catch {
    return s; // outside BS table: fall back to AD rather than guess
  }
}

/** Long form, e.g. "14 Baisakh 2082". */
export function formatDateLong(iso: string | Date, calendar: Calendar): string {
  const s = typeof iso === "string" ? iso.slice(0, 10) : toIso(iso);
  try {
    if (calendar === "BS") {
      const b = adToBs(s);
      return `${b.d} ${BS_MONTHS[b.m - 1]} ${b.y}`;
    }
  } catch {
    /* fall through */
  }
  const p = parseIso(s)!;
  return `${p.d} ${AD_MONTHS[p.m - 1]} ${p.y}`;
}

/** Dates are stored as UTC midnight (@db.Date). */
export function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function fromIso(iso: string): Date {
  const p = parseIso(iso);
  if (!p || !isValidAd(p)) throw new RangeError(`Invalid date: ${iso}`);
  return new Date(Date.UTC(p.y, p.m - 1, p.d));
}
export function todayIso(): string {
  // Nepal Standard Time (UTC+5:45) so "today" is correct for the user around midnight.
  return new Date(Date.now() + 5.75 * 3600_000).toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  return toIso(new Date(fromIso(iso).getTime() + n * DAY_MS));
}

/** Month bucket (in the display calendar) for an AD ISO date. */
export function monthBucket(iso: string, calendar: Calendar): { key: string; label: string; sort: number } {
  if (calendar === "BS") {
    try {
      const b = adToBs(iso);
      return { key: `${b.y}-${pad(b.m)}`, label: `${BS_MONTHS[b.m - 1]} ${b.y}`, sort: b.y * 100 + b.m };
    } catch {
      /* fall through to AD */
    }
  }
  const p = parseIso(iso)!;
  return { key: `${p.y}-${pad(p.m)}`, label: `${AD_MONTHS[p.m - 1].slice(0, 3)} ${p.y}`, sort: p.y * 100 + p.m };
}

/**
 * AD start/end of the financial year that starts in `startYear` of `calendar`,
 * beginning on month/day `fyStartMonth`/`fyStartDay` of that calendar.
 */
export function financialYearRange(
  calendar: Calendar,
  fyStartMonth: number,
  fyStartDay: number,
  startYear: number,
): { start: string; end: string; label: string } {
  if (calendar === "BS") {
    const start = bsToAd({ y: startYear, m: fyStartMonth, d: fyStartDay });
    const nextStart = bsToAd({ y: startYear + 1, m: fyStartMonth, d: fyStartDay });
    const label = fyStartMonth === 1 && fyStartDay === 1 ? `${startYear} BS` : `${startYear}/${pad((startYear + 1) % 100)} BS`;
    return { start, end: addDays(nextStart, -1), label };
  }
  const start = ymdToIso({ y: startYear, m: fyStartMonth, d: fyStartDay });
  const nextStart = ymdToIso({ y: startYear + 1, m: fyStartMonth, d: fyStartDay });
  const label = fyStartMonth === 1 && fyStartDay === 1 ? `${startYear}` : `${startYear}/${pad((startYear + 1) % 100)}`;
  return { start, end: addDays(nextStart, -1), label };
}

/** Which FY start-year (in `calendar`) contains the given AD date. */
export function financialYearStartFor(iso: string, calendar: Calendar, fyStartMonth: number, fyStartDay: number): number {
  const p = calendar === "BS" ? adToBs(iso) : parseIso(iso)!;
  const beforeStart = p.m < fyStartMonth || (p.m === fyStartMonth && p.d < fyStartDay);
  return beforeStart ? p.y - 1 : p.y;
}
