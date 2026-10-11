import { describe, expect, it } from "vitest";
import NepaliDate from "nepali-date-converter";
import {
  adToBs, bsToAd, isValidBs, parseEnteredDate, financialYearRange, financialYearStartFor,
  bsMonthDays, formatDate, monthBucket, BS_MIN_YEAR, BS_MAX_YEAR,
} from "@/lib/dates";

describe("BS <-> AD conversion", () => {
  it("matches well-known New Year dates", () => {
    expect(bsToAd({ y: 2080, m: 1, d: 1 })).toBe("2023-04-14");
    expect(bsToAd({ y: 2081, m: 1, d: 1 })).toBe("2024-04-13");
    expect(bsToAd({ y: 2082, m: 1, d: 1 })).toBe("2025-04-14");
    expect(bsToAd({ y: 2083, m: 1, d: 1 })).toBe("2026-04-14");
    expect(bsToAd({ y: 2000, m: 1, d: 1 })).toBe("1943-04-14");
  });

  it("converts AD to BS", () => {
    expect(adToBs("2025-04-14")).toEqual({ y: 2082, m: 1, d: 1 });
    expect(adToBs("2025-04-13")).toEqual({ y: 2081, m: 12, d: 31 });
    expect(adToBs("2024-02-29")).toEqual({ y: 2080, m: 11, d: 17 }); // AD leap day
  });

  it("round-trips every day from BS 2000 to 2090 and agrees with the reference library", () => {
    let count = 0;
    for (let y = BS_MIN_YEAR; y <= BS_MAX_YEAR; y++) {
      for (let m = 1; m <= 12; m++) {
        const days = bsMonthDays(y, m);
        for (const d of [1, 2, days - 1, days]) {
          const ad = bsToAd({ y, m, d });
          expect(adToBs(ad)).toEqual({ y, m, d });
          const lib = new NepaliDate(y, m - 1, d).toJsDate().toISOString().slice(0, 10);
          expect(ad).toBe(lib);
          count++;
        }
      }
    }
    expect(count).toBeGreaterThan(4000);
  });

  it("is continuous: consecutive AD days map to consecutive BS days across month/year boundaries", () => {
    let prev = adToBs("2024-01-01");
    for (let i = 1; i < 800; i++) {
      const iso = new Date(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10);
      const cur = adToBs(iso);
      const sameMonth = cur.y === prev.y && cur.m === prev.m && cur.d === prev.d + 1;
      const nextMonth = cur.d === 1 && ((cur.y === prev.y && cur.m === prev.m + 1) || (cur.y === prev.y + 1 && cur.m === 1 && prev.m === 12));
      expect(sameMonth || nextMonth).toBe(true);
      if (nextMonth) expect(prev.d).toBe(bsMonthDays(prev.y, prev.m));
      prev = cur;
    }
  });

  it("rejects impossible or ambiguous input instead of rolling over", () => {
    expect(isValidBs({ y: 2082, m: 1, d: 32 })).toBe(false);
    expect(parseEnteredDate("2082-01-33", "BS").ok).toBe(false);
    expect(parseEnteredDate("2082-13-01", "BS").ok).toBe(false);
    expect(parseEnteredDate("1990-01-01", "BS").ok).toBe(false);
    expect(parseEnteredDate("2025-02-30", "AD").ok).toBe(false);
    expect(parseEnteredDate("14/04/2025", "AD").ok).toBe(false);
    expect(() => bsToAd({ y: 2091, m: 1, d: 1 })).toThrow();
    expect(() => adToBs("1900-01-01")).toThrow();
  });

  it("parses typed dates in either calendar", () => {
    expect(parseEnteredDate("2082-05-14", "BS")).toEqual({ ok: true, iso: bsToAd({ y: 2082, m: 5, d: 14 }) });
    expect(parseEnteredDate("2082/05/14", "BS").ok).toBe(true);
    expect(parseEnteredDate("2024-02-29", "AD")).toEqual({ ok: true, iso: "2024-02-29" });
    expect(parseEnteredDate("2023-02-29", "AD").ok).toBe(false);
  });

  it("formats according to preference", () => {
    expect(formatDate("2025-04-14", "BS")).toBe("2082-01-01");
    expect(formatDate("2025-04-14", "AD")).toBe("2025-04-14");
    expect(monthBucket("2025-04-14", "BS").label).toBe("Baisakh 2082");
  });
});

describe("financial years", () => {
  it("Nepal FY starts Shrawan 1 BS and ends the day before next Shrawan 1", () => {
    const fy = financialYearRange("BS", 4, 1, 2082);
    expect(fy.start).toBe(bsToAd({ y: 2082, m: 4, d: 1 }));
    expect(fy.end).toBe(adToBs(fy.end) && bsToAd({ y: 2083, m: 3, d: bsMonthDays(2083, 3) }));
    expect(fy.label).toBe("2082/83 BS");
  });
  it("supports a January-start Gregorian FY and a mid-year AD FY", () => {
    expect(financialYearRange("AD", 1, 1, 2025)).toMatchObject({ start: "2025-01-01", end: "2025-12-31" });
    expect(financialYearRange("AD", 7, 16, 2024)).toMatchObject({ start: "2024-07-16", end: "2025-07-15" });
  });
  it("locates the FY containing a date, including boundary days", () => {
    const start = bsToAd({ y: 2082, m: 4, d: 1 });
    const dayBefore = bsToAd({ y: 2082, m: 3, d: bsMonthDays(2082, 3) });
    expect(financialYearStartFor(start, "BS", 4, 1)).toBe(2082);
    expect(financialYearStartFor(dayBefore, "BS", 4, 1)).toBe(2081);
    expect(financialYearStartFor("2025-12-31", "AD", 1, 1)).toBe(2025);
    expect(financialYearStartFor("2025-07-15", "AD", 7, 16)).toBe(2024);
  });
});
