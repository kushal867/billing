import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { makeBusiness, makeFy, setOpening, entry, bs } from "./helpers";
import { createTransaction } from "@/lib/services/transactions";
import { previewBulk, saveBulk, type BulkRow } from "@/lib/services/bulk";
import { listLedger } from "@/lib/services/ledger";
import type { Ctx } from "@/lib/auth/context";

let ctx: Ctx;
const row = (o: Partial<BulkRow> = {}): BulkRow => ({ date: "", bill: "", debit: "", credit: "", description: "", ...o });
const input = (rows: BulkRow[]) => ({ rows, defaultDate: "2082-04-10", calendar: "BS" as const });

beforeEach(async () => {
  ({ ctx } = await makeBusiness());
  const fy = await makeFy(ctx, 2082);
  await setOpening(ctx, "1000", fy.id, bs(2082, 4, 1));
});

describe("bulk entry", () => {
  it("saves a whole page at once in row order, using the page date for rows without a date", async () => {
    const summary = await saveBulk(ctx, input([
      row({ bill: "1", debit: "100" }),
      row(), // blank rows are ignored
      row({ bill: "2", credit: "30.50", date: "2082-04-12", description: "oil" }),
      row({ bill: "3", debit: "1,000.25" }),
    ]), false);
    expect(summary).toMatchObject({ total: 3, imported: 3, failed: 0 });
    const rows = (await listLedger(ctx, { pageSize: 0 })).rows;
    expect(rows.map((r) => [r.billNumber, r.date, r.balance?.toFixed(2)])).toEqual([
      ["1", bs(2082, 4, 10), "1100.00"], ["3", bs(2082, 4, 10), "2100.25"], ["2", bs(2082, 4, 12), "2069.75"],
    ]);
    const job = await db.importJob.findFirstOrThrow({ where: { businessId: ctx.businessId } });
    expect(job).toMatchObject({ kind: "BULK", importedRows: 3 });
    expect(await db.auditLog.count({ where: { businessId: ctx.businessId, action: "BULK_ENTRY" } })).toBe(1);
  });

  it("is all-or-nothing: one bad row means nothing is saved, and errors carry the grid row number", async () => {
    const rows = input([row({ bill: "1", debit: "100" }), row({ bill: "2", debit: "abc" }), row({ bill: "", debit: "5" }), row({ bill: "4", debit: "1", credit: "1" })]);
    await expect(saveBulk(ctx, rows, false)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await db.transaction.count({ where: { businessId: ctx.businessId } })).toBe(0);
    const prev = await previewBulk(ctx, rows);
    expect(prev.map((p) => [p.rowNumber, p.status])).toEqual([[1, "ok"], [2, "error"], [3, "error"], [4, "error"]]);
    expect(prev[1].errors.join()).toMatch(/Debit "abc"/);
  });

  it("detects duplicates against existing entries and within the page, saving them only when confirmed", async () => {
    await createTransaction(ctx, entry({ dateText: "2082-04-10", calendar: "BS", billNumber: "7", debit: "50" }));
    const page = input([row({ bill: "7", debit: "50" }), row({ bill: "8", debit: "9" }), row({ bill: "8", debit: "9" })]);
    const prev = await previewBulk(ctx, page);
    expect(prev.map((p) => p.status)).toEqual(["duplicate", "ok", "duplicate"]);
    const skipped = await saveBulk(ctx, page, false);
    expect(skipped).toMatchObject({ imported: 1, skipped: 2 });
    const withDup = await saveBulk(ctx, page, true);
    expect(withDup.imported).toBe(3);
  });

  it("rejects dates before the opening balance, impossible dates and empty pages; enforces role and tenant", async () => {
    await expect(saveBulk(ctx, { rows: [row({ bill: "1", debit: "1", date: "2081-01-01" })], defaultDate: "2082-04-10", calendar: "BS" }, false)).rejects.toThrow(/before the opening balance|row/);
    await expect(saveBulk(ctx, { rows: [row({ bill: "1", debit: "1", date: "2082-01-40" })], defaultDate: "2082-04-10", calendar: "BS" }, false)).rejects.toThrow();
    await expect(saveBulk(ctx, input([row(), row()]), false)).rejects.toMatchObject({ code: "VALIDATION" });
    const viewer = await makeBusiness("VIEWER");
    await expect(saveBulk(viewer.ctx, input([row({ bill: "1", debit: "1" })]), false)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const other = await makeBusiness();
    expect((await listLedger(other.ctx, { pageSize: 0 })).rows).toHaveLength(0);
  });

  it("caps the page size", async () => {
    const many = Array.from({ length: 301 }, (_, i) => row({ bill: String(i), debit: "1" }));
    await expect(saveBulk(ctx, input(many), false)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
