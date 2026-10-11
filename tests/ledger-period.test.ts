import { describe, expect, it, beforeEach } from "vitest";
import { makeBusiness, makeFy, setOpening, entry, bs } from "./helpers";
import { createTransaction } from "@/lib/services/transactions";
import { listLedger } from "@/lib/services/ledger";
import { monthRange, monthsBetween, resolveLedgerPeriod } from "@/lib/services/ledger-period";
import { buildReport } from "@/lib/services/report-registry";
import { getBusiness } from "@/lib/services/periods";
import { bsMonthDays } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";

let ctx: Ctx;
let fy1: { id: string };
let fy2: { id: string };

beforeEach(async () => {
  ({ ctx } = await makeBusiness());
  fy1 = await makeFy(ctx, 2082);
  fy2 = await makeFy(ctx, 2083);
  await setOpening(ctx, "0", fy1.id, bs(2082, 4, 1));
  const add = (d: string, bill: string) => createTransaction(ctx, entry({ dateText: d, calendar: "BS", billNumber: bill, debit: "10" }));
  await add("2082-04-01", "1");   // Shrawan 2082
  await add("2082-04-31", "2");   // last day of Shrawan 2082 (31 days)
  await add("2082-05-01", "3");   // Bhadra 2082
  await add("2083-03-32", "4");   // Asar 2083 has 32 days: the very last day of FY 2082/83
  await expect(add("2083-03-33", "x")).rejects.toMatchObject({ code: "VALIDATION" }); // impossible day is rejected, not rolled over
  await add("2083-04-01", "5");   // first day of FY 2083/84
});

describe("ledger year/month filters", () => {
  it("computes exact BS month ranges", () => {
    expect(monthRange("2082-04", "BS")).toEqual({ from: bs(2082, 4, 1), to: bs(2082, 4, bsMonthDays(2082, 4)) });
    expect(monthRange("2025-02", "AD")).toEqual({ from: "2025-02-01", to: "2025-02-28" });
    expect(monthRange("2024-02", "AD")).toEqual({ from: "2024-02-01", to: "2024-02-29" });
    expect(monthRange("garbage", "BS")).toBeNull();
  });

  it("lists the 12 BS months of a financial year", () => {
    const months = monthsBetween(bs(2082, 4, 1), bs(2083, 3, bsMonthDays(2083, 3)), "BS");
    expect(months).toHaveLength(12);
    expect(months[0].label).toBe("Shrawan 2082");
    expect(months[11].label).toBe("Asar 2083");
  });

  it("filters by financial year and by month inside it, keeping balances global", async () => {
    const biz = await getBusiness(ctx.businessId);
    const y1 = await resolveLedgerPeriod(ctx.businessId, biz, { fy: fy1.id });
    const rows1 = await listLedger(ctx, { from: y1.from, to: y1.to, pageSize: 0 });
    expect(rows1.rows.map((r) => r.billNumber)).toEqual(["1", "2", "3", "4"]);
    const y2 = await resolveLedgerPeriod(ctx.businessId, biz, { fy: fy2.id });
    const rows2 = await listLedger(ctx, { from: y2.from, to: y2.to, pageSize: 0 });
    expect(rows2.rows.map((r) => [r.billNumber, r.balance?.toFixed(2)])).toEqual([["5", "50.00"]]);
    const m = await resolveLedgerPeriod(ctx.businessId, biz, { fy: fy1.id, month: "2082-04" });
    const rowsM = await listLedger(ctx, { from: m.from, to: m.to, pageSize: 0 });
    expect(rowsM.rows.map((r) => r.billNumber)).toEqual(["1", "2"]);
  });

  it("the ledger export uses the same year/month resolution as the page", async () => {
    const { doc } = await buildReport(ctx, "ledger", { fy: fy1.id, month: "2082-05" });
    expect(doc.sections[0].rows.map((r) => r.bill)).toEqual(["3"]);
    expect(doc.meta.find(([k]) => k === "Opening Balance")![1]).toBe("20.00");
    await expect(buildReport(ctx, "ledger", { fy: "00000000-0000-0000-0000-000000000000" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
