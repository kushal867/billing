import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { makeBusiness, makeFy, setOpening, entry } from "./helpers";
import { createTransaction, updateTransaction, voidTransaction, reverseTransaction, suggestNextBillNumber } from "@/lib/services/transactions";
import { listLedger, summarizePeriod, openingBalanceFor } from "@/lib/services/ledger";
import type { Ctx } from "@/lib/auth/context";

let ctx: Ctx;
let fyId: string;

async function add(over: Record<string, unknown>) {
  const r = await createTransaction(ctx, entry(over));
  if (r.status !== "saved") throw new Error("expected saved");
  return r.transaction;
}
const bal = async (opts = {}) => (await listLedger(ctx, { pageSize: 0, ...opts })).rows.map((r) => r.balance?.toFixed(2));

beforeEach(async () => {
  ({ ctx } = await makeBusiness());
  const fy = await makeFy(ctx, 2082);
  fyId = fy.id;
  await setOpening(ctx, "1000", fyId, fy.startDate.toISOString().slice(0, 10));
});

describe("running balance (Previous + Debit - Credit)", () => {
  it("adds a debit and a credit and computes balances from the opening balance", async () => {
    await add({ dateText: "2025-08-01", billNumber: "1", debit: "500.50" });
    await add({ dateText: "2025-08-02", billNumber: "2", debit: "", credit: "200.25" });
    expect(await bal()).toEqual(["1500.50", "1300.25"]);
  });

  it("uses a deterministic tie-breaker for same-date entries and is independent of page size", async () => {
    for (let i = 1; i <= 7; i++) await add({ dateText: "2025-08-01", billNumber: String(i), debit: "10" });
    const full = await bal();
    expect(full).toEqual(["1010.00", "1020.00", "1030.00", "1040.00", "1050.00", "1060.00", "1070.00"]);
    const p2 = await listLedger(ctx, { pageSize: 3, page: 2 });
    expect(p2.rows.map((r) => r.balance?.toFixed(2))).toEqual(["1040.00", "1050.00", "1060.00"]);
    expect(p2.total).toBe(7);
  });

  it("keeps balances correct when filtering/searching (balance is global, not per filtered set)", async () => {
    await add({ billNumber: "A1", debit: "100", description: "rice" });
    await add({ billNumber: "A2", debit: "50", description: "oil" });
    const r = await listLedger(ctx, { q: "oil" });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].balance?.toFixed(2)).toBe("1150.00");
  });

  it("sorts by balance, debit, and bill number (numeric aware)", async () => {
    await add({ billNumber: "10", debit: "5" });
    await add({ billNumber: "9", debit: "50" });
    const byBill = await listLedger(ctx, { sort: "bill", dir: "asc" });
    expect(byBill.rows.map((r) => r.billNumber)).toEqual(["9", "10"]);
    const byDebit = await listLedger(ctx, { sort: "debit", dir: "desc" });
    expect(byDebit.rows[0].debit.toFixed(2)).toBe("50.00");
  });

  it("supports the CREDIT_PLUS convention explicitly", async () => {
    await db.business.update({ where: { id: ctx.businessId }, data: { balanceConvention: "CREDIT_PLUS" } });
    await add({ billNumber: "1", debit: "100" });
    await add({ billNumber: "2", debit: "", credit: "30" });
    expect(await bal()).toEqual(["900.00", "930.00"]);
  });

  it("handles entries entered in reverse chronological order", async () => {
    await add({ dateText: "2025-09-10", billNumber: "2", debit: "200" });
    await add({ dateText: "2025-09-01", billNumber: "1", debit: "100" });
    const rows = (await listLedger(ctx, { pageSize: 0 })).rows;
    expect(rows.map((r) => [r.date, r.balance?.toFixed(2)])).toEqual([["2025-09-01", "1100.00"], ["2025-09-10", "1300.00"]]);
  });
});

describe("opening balance and carry-forward", () => {
  it("carries the closing balance into the next period", async () => {
    await add({ dateText: "2025-08-01", billNumber: "1", debit: "300" });
    await add({ dateText: "2025-09-05", billNumber: "2", debit: "", credit: "100" });
    const aug = await summarizePeriod(ctx, "2025-08-01", "2025-08-31");
    const sep = await summarizePeriod(ctx, "2025-09-01", "2025-09-30");
    expect(aug.opening.toFixed(2)).toBe("1000.00");
    expect(aug.closing.toFixed(2)).toBe("1300.00");
    expect(sep.opening.toFixed(2)).toBe(aug.closing.toFixed(2));
    expect(sep.closing.toFixed(2)).toBe("1200.00");
    expect(sep.debit.toFixed(2)).toBe("0.00");
    expect(sep.credit.toFixed(2)).toBe("100.00");
  });

  it("does not reset at a financial-year boundary", async () => {
    await add({ dateText: "2026-07-01", billNumber: "1", debit: "400" });
    const next = await makeFy(ctx, 2083);
    const s = await summarizePeriod(ctx, next.startDate.toISOString().slice(0, 10), next.endDate.toISOString().slice(0, 10));
    expect(s.opening.toFixed(2)).toBe("1400.00");
  });

  it("rejects entries dated before the opening balance effective date", async () => {
    await expect(createTransaction(ctx, entry({ dateText: "2025-01-01" }))).rejects.toThrow(/before the opening balance/);
  });

  it("refuses to move the opening date after existing entries", async () => {
    await add({ dateText: "2025-08-01", billNumber: "1" });
    const fy = await db.financialYear.findUniqueOrThrow({ where: { id: fyId } });
    await expect(setOpening(ctx, "1000", fyId, "2025-09-01")).rejects.toThrow(/dated before/);
    expect(fy).toBeTruthy();
  });

  it("opening balance is a separate record, not a transaction", async () => {
    expect(await db.transaction.count({ where: { businessId: ctx.businessId } })).toBe(0);
    expect((await openingBalanceFor(db, ctx.businessId, "DEBIT_PLUS", "2025-12-01")).toFixed(2)).toBe("1000.00");
  });
});

describe("historical edits", () => {
  it("recalculates all subsequent balances when an old entry is edited", async () => {
    const t1 = await add({ dateText: "2025-08-01", billNumber: "1", debit: "100" });
    await add({ dateText: "2025-08-02", billNumber: "2", debit: "50" });
    await add({ dateText: "2025-08-03", billNumber: "3", debit: "", credit: "20" });
    expect(await bal()).toEqual(["1100.00", "1150.00", "1130.00"]);
    const r = await updateTransaction(ctx, t1.id, entry({ dateText: "2025-08-01", billNumber: "1", debit: "400" }), t1.version);
    expect(r.status).toBe("saved");
    expect(await bal()).toEqual(["1400.00", "1450.00", "1430.00"]);
  });

  it("recalculates when an entry is inserted in the middle by date", async () => {
    await add({ dateText: "2025-08-01", billNumber: "1", debit: "100" });
    await add({ dateText: "2025-08-10", billNumber: "3", debit: "100" });
    await add({ dateText: "2025-08-05", billNumber: "2", debit: "", credit: "50" });
    expect(await bal()).toEqual(["1100.00", "1050.00", "1150.00"]);
  });

  it("voiding removes an entry from balances but keeps it in the audit trail", async () => {
    const t = await add({ billNumber: "1", debit: "100" });
    await add({ dateText: "2025-08-02", billNumber: "2", debit: "10" });
    await voidTransaction(ctx, t.id, "entered by mistake");
    expect(await bal()).toEqual(["1010.00"]);
    const logs = await db.auditLog.findMany({ where: { entityId: t.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["CREATE", "VOID"]);
    expect(logs[1].note).toBe("entered by mistake");
    expect(await db.transaction.count({ where: { id: t.id } })).toBe(1);
  });

  it("reverses an entry with an offsetting row and blocks double reversal", async () => {
    const t = await add({ dateText: "2025-08-01", billNumber: "7", debit: "250" });
    await reverseTransaction(ctx, t.id, "wrong customer", "2025-08-02");
    expect(await bal()).toEqual(["1250.00", "1000.00"]);
    await expect(reverseTransaction(ctx, t.id, "again", "2025-08-03")).rejects.toThrow(/already been reversed/);
  });

  it("rejects stale edits (optimistic concurrency)", async () => {
    const t = await add({ billNumber: "1" });
    await updateTransaction(ctx, t.id, entry({ billNumber: "1", debit: "101" }), t.version);
    await expect(updateTransaction(ctx, t.id, entry({ billNumber: "1", debit: "102" }), t.version)).rejects.toThrow(/changed by someone else/);
  });
});

describe("validation and duplicates", () => {
  it("rejects zero, missing, negative and 3-decimal amounts and both-sided entries", async () => {
    for (const bad of [
      { debit: "0", credit: "" }, { debit: "", credit: "" }, { debit: "-5" }, { debit: "10.123" },
      { debit: "abc" }, { debit: "5", credit: "5" },
    ]) {
      await expect(createTransaction(ctx, entry(bad))).rejects.toMatchObject({ code: "VALIDATION" });
    }
  });
  it("requires date and bill number", async () => {
    await expect(createTransaction(ctx, entry({ billNumber: "" }))).rejects.toMatchObject({ fieldErrors: { billNumber: expect.any(String) } });
    await expect(createTransaction(ctx, entry({ dateText: "" }))).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(createTransaction(ctx, entry({ dateText: "2025-02-30" }))).rejects.toMatchObject({ fieldErrors: { dateText: expect.any(String) } });
  });

  it("warns on duplicate bill numbers and blocks exact duplicates until confirmed", async () => {
    await add({ billNumber: "55", debit: "100", dateText: "2025-08-01" });
    const sameBill = await createTransaction(ctx, entry({ billNumber: "55", debit: "999", dateText: "2025-08-03" }));
    expect(sameBill).toMatchObject({ status: "duplicate", duplicates: { exact: [], sameBill: [expect.anything()] } });
    const exact = await createTransaction(ctx, entry({ billNumber: "55", debit: "100", dateText: "2025-08-01" }));
    expect(exact).toMatchObject({ status: "duplicate", duplicates: { exact: [expect.anything()] } });
    const forced = await createTransaction(ctx, entry({ billNumber: "55", debit: "999", dateText: "2025-08-03", allowDuplicate: true }));
    expect(forced.status).toBe("saved");
    const flagged = (await listLedger(ctx, { pageSize: 0 })).rows.filter((r) => r.flags.duplicateBill);
    expect(flagged).toHaveLength(2);
  });

  it("is idempotent for a repeated client token (double-click safe)", async () => {
    const e = entry({ billNumber: "1", clientToken: "tok-1" });
    const [a, b] = await Promise.all([createTransaction(ctx, e), createTransaction(ctx, e)]);
    expect(a.status).toBe("saved");
    expect(b.status).toBe("saved");
    expect(await db.transaction.count({ where: { businessId: ctx.businessId } })).toBe(1);
  });

  it("keeps drafts out of balances until they are posted", async () => {
    const d = await add({ billNumber: "", status: "DRAFT", debit: "999" });
    expect(await bal()).toEqual([]);
    expect((await summarizePeriod(ctx, "2025-08-01", "2025-08-31")).closing.toFixed(2)).toBe("1000.00");
    await updateTransaction(ctx, d.id, entry({ billNumber: "9", debit: "999", status: "POSTED" }), d.version);
    expect(await bal()).toEqual(["1999.00"]);
  });

  it("suggests the next bill number without forcing it", async () => {
    expect(await suggestNextBillNumber(ctx)).toBe("1");
    await add({ billNumber: "A-0099" });
    expect(await suggestNextBillNumber(ctx)).toBe("A-0100");
    await add({ billNumber: "12" });
    expect(await suggestNextBillNumber(ctx)).toBe("13");
  });
});

describe("concurrency", () => {
  it("serialises simultaneous writers: totals are exact and no entry is lost", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => createTransaction(ctx, entry({ billNumber: `c${i}`, debit: "10.10" }))));
    expect(results.every((r) => r.status === "saved")).toBe(true);
    const rows = (await listLedger(ctx, { pageSize: 0 })).rows;
    expect(rows).toHaveLength(20);
    expect(rows[19].balance?.toFixed(2)).toBe("1202.00");
    const seqs = rows.map((r) => BigInt(r.seq));
    expect(new Set(seqs).size).toBe(20);
  });
});
