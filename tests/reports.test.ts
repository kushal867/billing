import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { makeBusiness, makeFy, setOpening, entry, bs } from "./helpers";
import { createTransaction, updateTransaction, voidTransaction } from "@/lib/services/transactions";
import { buildAnnualReport, buildDailyReport, buildLedgerReport, buildMonthlyReport, buildProfitLoss, buildTrialBalance, profitLossData } from "@/lib/services/reports";
import { createManualJournal } from "@/lib/services/accounting";
import { D } from "@/lib/money";
import type { Ctx } from "@/lib/auth/context";

let ctx: Ctx;
let fy1: { id: string };
let fy2: { id: string };

const add = async (over: Record<string, unknown>) => {
  const r = await createTransaction(ctx, entry(over));
  if (r.status !== "saved") throw new Error("not saved");
  return r.transaction;
};
const cat = async (name: string) => (await db.category.findFirstOrThrow({ where: { businessId: ctx.businessId, name } })).id;

beforeEach(async () => {
  ({ ctx } = await makeBusiness());
  const a = await makeFy(ctx, 2082);
  fy1 = a;
  fy2 = await makeFy(ctx, 2083);
  await setOpening(ctx, "5000", a.id, bs(2082, 4, 1));
});

describe("financial-year filtering and annual/monthly totals", () => {
  it("separates FY 2082/83 from FY 2083/84 and carries the balance forward", async () => {
    await add({ dateText: "2082-04-01", calendar: "BS", billNumber: "1", debit: "1000" });
    await add({ dateText: "2083-03-30", calendar: "BS", billNumber: "2", debit: "", credit: "300" }); // last days of FY1
    await add({ dateText: "2083-04-01", calendar: "BS", billNumber: "3", debit: "50" }); // first day of FY2
    const a1 = await buildAnnualReport(ctx, fy1.id);
    const a2 = await buildAnnualReport(ctx, fy2.id);
    const meta = (d: typeof a1, k: string) => d.meta.find(([x]) => x === k)![1];
    expect(meta(a1, "Opening Balance")).toBe("5000.00");
    expect(meta(a1, "Total Debit")).toBe("1000.00");
    expect(meta(a1, "Total Credit")).toBe("300.00");
    expect(meta(a1, "Closing Balance")).toBe("5700.00");
    expect(meta(a1, "Entries")).toBe("2");
    expect(meta(a2, "Opening Balance")).toBe("5700.00");
    expect(meta(a2, "Closing Balance")).toBe("5750.00");
    expect(meta(a2, "Entries")).toBe("1");
    const recon = a1.sections[2].rows.find((r) => r.item.startsWith("Ledger rows"))!;
    expect(recon.value).toBe("OK");
  });

  it("monthly report buckets by BS month and totals match the annual report", async () => {
    await add({ dateText: "2082-04-10", calendar: "BS", billNumber: "1", debit: "100" });
    await add({ dateText: "2082-04-20", calendar: "BS", billNumber: "2", debit: "", credit: "40" });
    await add({ dateText: "2082-06-05", calendar: "BS", billNumber: "3", debit: "10" });
    const fy = await db.financialYear.findUniqueOrThrow({ where: { id: fy1.id } });
    const from = fy.startDate.toISOString().slice(0, 10);
    const to = fy.endDate.toISOString().slice(0, 10);
    const monthly = await buildMonthlyReport(ctx, from, to);
    const rows = monthly.sections[0].rows;
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({ month: "Shrawan 2082", count: "2", opening: "5000.00", debit: "100.00", credit: "40.00", closing: "5060.00" });
    expect(rows[1]).toMatchObject({ month: "Bhadra 2082", count: "0", opening: "5060.00", closing: "5060.00" });
    expect(rows[2]).toMatchObject({ month: "Aswin 2082", count: "1", opening: "5060.00", closing: "5070.00" });
    expect(monthly.sections[0].totals).toMatchObject({ debit: "110.00", credit: "40.00" });
    expect(rows[11].closing).toBe("5070.00");
  });

  it("daily report shows opening/closing for a single day", async () => {
    await add({ dateText: "2025-08-05", billNumber: "1", debit: "100" });
    await add({ dateText: "2025-08-05", billNumber: "2", debit: "", credit: "25" });
    const r = await buildDailyReport(ctx, "2025-08-05");
    expect(r.sections[0].rows[0]).toMatchObject({ count: "2", opening: "5000.00", debit: "100.00", credit: "25.00", closing: "5075.00" });
    expect(r.sections[1].rows).toHaveLength(2);
    const empty = await buildDailyReport(ctx, "2025-08-06");
    expect(empty.sections[0].rows[0]).toMatchObject({ count: "0", opening: "5075.00", closing: "5075.00" });
  });

  it("ledger report reflects the active filters", async () => {
    await add({ dateText: "2025-08-05", billNumber: "1", debit: "100", description: "rice" });
    await add({ dateText: "2025-08-06", billNumber: "2", debit: "70", description: "oil" });
    const doc = await buildLedgerReport(ctx, { q: "oil" });
    expect(doc.sections[0].rows).toHaveLength(1);
    expect(doc.sections[0].rows[0].balance).toBe("5170.00");
    expect(doc.sections[0].totals).toMatchObject({ debit: "70.00" });
  });
});

describe("profit & loss from categorised accounts", () => {
  it("reports insufficient data when nothing is classified, instead of treating balance as profit", async () => {
    await add({ billNumber: "1", debit: "999" });
    const doc = await buildProfitLoss(ctx, "2025-08-01", "2025-08-31");
    expect(doc.sections).toHaveLength(0);
    expect(doc.warnings[0]).toMatch(/Insufficient data/);
    expect((await profitLossData(ctx, "2025-08-01", "2025-08-31")).sufficient).toBe(false);
  });

  it("computes revenue, expenses and net profit from classified entries only", async () => {
    await add({ billNumber: "1", debit: "10000", categoryId: await cat("Sales") });
    await add({ billNumber: "2", debit: "", credit: "2500.50", categoryId: await cat("Purchases") });
    await add({ billNumber: "3", debit: "", credit: "500", categoryId: await cat("Rent") });
    await add({ billNumber: "4", debit: "777" }); // unclassified: must not count
    const pl = await profitLossData(ctx, "2025-08-01", "2025-08-31");
    expect(pl.revenue.toFixed(2)).toBe("10000.00");
    expect(pl.expenses.toFixed(2)).toBe("3000.50");
    expect(pl.net.toFixed(2)).toBe("6999.50");
    expect(pl.unclassifiedCount).toBe(1);
    const doc = await buildProfitLoss(ctx, "2025-08-01", "2025-08-31");
    expect(doc.warnings.join(" ")).toMatch(/has no category and is NOT included/);
    expect(doc.sections[2].totals).toMatchObject({ name: "Net Profit", amount: "6999.50" });
  });

  it("shows a net loss and tracks edits and deletions", async () => {
    const sale = await add({ billNumber: "1", debit: "100", categoryId: await cat("Sales") });
    await add({ billNumber: "2", credit: "", debit: "400", categoryId: await cat("Purchases") });
    expect((await profitLossData(ctx, "2025-08-01", "2025-08-31")).net.toFixed(2)).toBe("-300.00");
    await updateTransaction(ctx, sale.id, entry({ billNumber: "1", debit: "900", categoryId: await cat("Sales") }), sale.version);
    expect((await profitLossData(ctx, "2025-08-01", "2025-08-31")).net.toFixed(2)).toBe("500.00");
    await voidTransaction(ctx, sale.id, "cancelled sale");
    expect((await profitLossData(ctx, "2025-08-01", "2025-08-31")).revenue.toFixed(2)).toBe("0.00");
  });

  it("filters P&L by the selected date range", async () => {
    await add({ dateText: "2025-08-01", billNumber: "1", debit: "100", categoryId: await cat("Sales") });
    await add({ dateText: "2025-09-01", billNumber: "2", debit: "300", categoryId: await cat("Sales") });
    expect((await profitLossData(ctx, "2025-09-01", "2025-09-30")).revenue.toFixed(2)).toBe("300.00");
  });
});

describe("double-entry accounting", () => {
  it("rejects unbalanced journal entries and accepts balanced ones; trial balance balances", async () => {
    const accts = await db.account.findMany({ where: { businessId: ctx.businessId } });
    const by = (code: string) => accts.find((a) => a.code === code)!.id;
    await expect(
      createManualJournal(ctx, { date: "2025-08-01", memo: "bad", lines: [{ accountId: by("1000"), debit: D(100), credit: D(0) }, { accountId: by("4000"), debit: D(0), credit: D(90) }] }),
    ).rejects.toThrow(/does not balance/);
    await createManualJournal(ctx, { date: "2025-08-01", memo: "ok", lines: [{ accountId: by("1000"), debit: D(100), credit: D(0) }, { accountId: by("4000"), debit: D(0), credit: D(100) }] });
    await add({ billNumber: "1", debit: "50", categoryId: await cat("Purchases") });
    const tb = await buildTrialBalance(ctx, "2025-12-31");
    expect(tb.sections[0].totals!.debit).toBe(tb.sections[0].totals!.credit);
    expect(tb.meta.find(([k]) => k === "Imbalance")![1]).toBe("0.00");
  });

  it("database itself refuses an unbalanced journal even if the application is bypassed", async () => {
    const accts = await db.account.findMany({ where: { businessId: ctx.businessId } });
    await expect(
      db.journalEntry.create({
        data: {
          businessId: ctx.businessId, entryDate: new Date("2025-08-01"), createdBy: ctx.userId,
          lines: { create: [{ accountId: accts[0].id, debit: 100, credit: 0 }, { accountId: accts[1].id, debit: 0, credit: 1 }] },
        },
      }),
    ).rejects.toThrow(/not balanced/);
  });

  it("explains instead of faking a trial balance when no accounting data exists", async () => {
    const tb = await buildTrialBalance(ctx, "2025-12-31");
    expect(tb.sections).toHaveLength(0);
    expect(tb.warnings[0]).toMatch(/No accounting entries/);
  });
});
