import { describe, expect, it } from "vitest";
import { monthGrid, shiftMonth } from "@/lib/calendar-grid";
import { bsToAd, bsMonthDays } from "@/lib/dates";

describe("calendar grid", () => {
  it("BS 2082 Baisakh starts on Monday (AD 2025-04-14) and has the right number of days", () => {
    const g = monthGrid("BS", 2082, 1);
    expect(g.leading).toBe(1);
    expect(g.days).toHaveLength(bsMonthDays(2082, 1));
    expect(g.days[0]).toMatchObject({ day: 1, iso: "2025-04-14", other: 14 });
    expect(g.label).toBe("Baisakh 2082");
  });
  it("shows the AD day-of-month under BS days and the BS day under AD days", () => {
    const bs = monthGrid("BS", 2082, 1).days[17];
    expect(bs.iso).toBe(bsToAd({ y: 2082, m: 1, d: 18 }));
    expect(bs.other).toBe(Number(bs.iso.slice(8)));
    const ad = monthGrid("AD", 2025, 4).days[13]; // 14 April 2025 = BS 2082-01-01
    expect(ad.iso).toBe("2025-04-14");
    expect(ad.other).toBe(1);
  });
  it("AD months: leap February, weekday of the 1st", () => {
    expect(monthGrid("AD", 2024, 2).days).toHaveLength(29);
    expect(monthGrid("AD", 2025, 2).days).toHaveLength(28);
    expect(monthGrid("AD", 2025, 4).leading).toBe(2); // 1 April 2025 was a Tuesday
  });
  it("every BS month grid is consistent for all supported years", () => {
    for (let y = 2000; y <= 2090; y++) for (let m = 1; m <= 12; m++) {
      const g = monthGrid("BS", y, m);
      expect(g.days).toHaveLength(bsMonthDays(y, m));
      expect(g.leading).toBeGreaterThanOrEqual(0);
      expect(g.leading).toBeLessThanOrEqual(6);
    }
  });
  it("month navigation wraps across years and flags the table edges", () => {
    expect(shiftMonth(2082, 12, 1)).toEqual({ year: 2083, month: 1 });
    expect(shiftMonth(2082, 1, -1)).toEqual({ year: 2081, month: 12 });
    expect(shiftMonth(2082, 6, 12)).toEqual({ year: 2083, month: 6 });
    expect(monthGrid("BS", 2000, 1).canPrev).toBe(false);
    expect(monthGrid("BS", 2090, 12).canNext).toBe(false);
  });
});
