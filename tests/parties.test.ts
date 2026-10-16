import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { makeBusiness, makeFy, setOpening, entry } from "./helpers";
import { createTransaction, updateTransaction, voidTransaction } from "@/lib/services/transactions";
import { ageOutstanding, createParty, getPartyRow, listParties, mergeParties, partyNames, setPartyActive, totalsOf, updateParty } from "@/lib/services/parties";
import { listLedger } from "@/lib/services/ledger";
import { buildOutstandingReport, buildPartyStatementReport } from "@/lib/services/reports";
import { D } from "@/lib/money";
import type { Ctx } from "@/lib/auth/context";

let ctx: Ctx;
async function add(over: Record<string, unknown>) {
  const r = await createTransaction(ctx, entry(over));
  if (r.status !== "saved") throw new Error("expected saved");
  return r.transaction;
}
beforeEach(async () => {
  ({ ctx } = await makeBusiness());
  const fy = await makeFy(ctx, 2082);
  await setOpening(ctx, "0", fy.id, fy.startDate.toISOString().slice(0, 10));
});

describe("parties", () => {
  it("creates the party from the typed name, ignoring case and spacing", async () => {
    await add({ billNumber: "1", debit: "100", partyName: "Ram Traders" });
    await add({ billNumber: "2", debit: "50", partyName: "  ram   traders " });
    expect(await db.party.count({ where: { businessId: ctx.businessId } })).toBe(1);
    expect(await partyNames(ctx)).toEqual(["Ram Traders"]);
    const rows = await listParties(ctx);
    expect(rows[0].net.toFixed(2)).toBe("150.00");
    expect(rows[0].entries).toBe(2);
  });

  it("gives each party its own balance and counts debits as owed, credits as paid", async () => {
    await add({ billNumber: "1", dateText: "2025-08-01", debit: "1000", partyName: "A" });
    await add({ billNumber: "2", dateText: "2025-08-02", debit: "", credit: "400", partyName: "A" });
    await add({ billNumber: "3", dateText: "2025-08-02", debit: "", credit: "900", partyName: "Supplier S" });
    const rows = Object.fromEntries((await listParties(ctx)).map((r) => [r.name, r.net.toFixed(2)]));
    expect(rows).toEqual({ A: "600.00", "Supplier S": "-900.00" });
    const t = totalsOf(await listParties(ctx));
    expect([t.receivable.toFixed(2), t.payable.toFixed(2), t.owingCount, t.owedCount]).toEqual(["600.00", "900.00", 1, 1]);
  });

  it("includes the brought-forward balance and ignores drafts and deleted entries", async () => {
    const p = await createParty(ctx, { name: "Old Customer", openingAmount: "500", openingSide: "THEY_OWE" });
    await add({ billNumber: "1", debit: "100", partyName: "Old Customer" });
    const gone = await add({ billNumber: "2", debit: "9999", partyName: "Old Customer" });
    await voidTransaction(ctx, gone.id, "typo");
    await createTransaction(ctx, entry({ billNumber: "3", debit: "7777", partyName: "Old Customer", status: "DRAFT" }));
    expect((await getPartyRow(ctx, p.id)).net.toFixed(2)).toBe("600.00");
  });

  it("keeps the party when an entry is edited without a party field, and clears it when asked", async () => {
    const t = await add({ billNumber: "1", debit: "100", partyName: "Keep Me" });
    const { partyName: _drop, ...rest } = entry({ billNumber: "1", debit: "120" }) as Record<string, unknown>;
    void _drop;
    await updateTransaction(ctx, t.id, rest, t.version);
    expect((await db.transaction.findUnique({ where: { id: t.id } }))!.partyId).not.toBeNull();
    const t2 = await db.transaction.findUniqueOrThrow({ where: { id: t.id } });
    await updateTransaction(ctx, t.id, entry({ billNumber: "1", debit: "120", partyName: "" }), t2.version);
    expect((await db.transaction.findUnique({ where: { id: t.id } }))!.partyId).toBeNull();
  });

  it("filters the ledger by party and shows the party name", async () => {
    const a = await add({ billNumber: "1", debit: "10", partyName: "A" });
    await add({ billNumber: "2", debit: "20", partyName: "B" });
    const page = await listLedger(ctx, { partyId: a.partyId!, pageSize: 0 });
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].partyName).toBe("A");
    // running balance still comes from the whole ledger
    expect(page.rows[0].balance?.toFixed(2)).toBe("10.00");
    expect((await listLedger(ctx, { q: "B", pageSize: 0 })).rows.some((r) => r.partyName === "B")).toBe(true);
  });

  it("builds a statement with a brought-forward line and running balance", async () => {
    const p = await createParty(ctx, { name: "S", openingAmount: "100", openingSide: "THEY_OWE" });
    await add({ billNumber: "1", dateText: "2025-08-01", debit: "200", partyName: "S" });
    await add({ billNumber: "2", dateText: "2025-08-05", debit: "", credit: "50", partyName: "S" });
    const doc = await buildPartyStatementReport(ctx, p.id, "1900-01-01", "2999-12-31");
    const rows = doc.sections[0].rows;
    expect(rows.map((r) => r.balance)).toEqual(["100.00", "300.00", "250.00"]);
    expect(rows[0].description).toBe("Balance brought forward");
    expect(doc.meta.find((m) => m[0] === "Closing Balance")![1]).toBe("250.00");
    const later = await buildPartyStatementReport(ctx, p.id, "2025-08-03", "2999-12-31");
    expect(later.meta.find((m) => m[0] === "Opening Balance")![1]).toBe("300.00");
  });

  it("lists who owes and whom you owe in the outstanding report", async () => {
    await add({ billNumber: "1", debit: "300", partyName: "Debtor" });
    await add({ billNumber: "2", debit: "", credit: "80", partyName: "Creditor" });
    const doc = await buildOutstandingReport(ctx);
    expect(doc.sections[0].rows.map((r) => [r.name, r.net])).toEqual([["Debtor", "300.00"]]);
    expect(doc.sections[1].rows.map((r) => [r.name, r.net])).toEqual([["Creditor", "80.00"]]);
  });

  it("rejects duplicate names and hiding a party that still has a balance", async () => {
    const p = await createParty(ctx, { name: "Dup" });
    await expect(createParty(ctx, { name: "dup" })).rejects.toThrow(/already exists/);
    const q = await createParty(ctx, { name: "Other" });
    await expect(updateParty(ctx, q.id, { name: "DUP" })).rejects.toThrow(/already exists/);
    await add({ billNumber: "1", debit: "5", partyName: "Dup" });
    await expect(setPartyActive(ctx, p.id, false)).rejects.toThrow(/balance/);
  });

  it("merges two parties", async () => {
    await add({ billNumber: "1", debit: "10", partyName: "Ram Trader" });
    await add({ billNumber: "2", debit: "20", partyName: "Ram Traders" });
    const [a, b] = await Promise.all([db.party.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "Ram Trader" } }), db.party.findFirstOrThrow({ where: { businessId: ctx.businessId, name: "Ram Traders" } })]);
    expect(await mergeParties(ctx, a.id, b.id)).toBe(1);
    const rows = await listParties(ctx);
    expect(rows.map((r) => [r.name, r.net.toFixed(2)])).toEqual([["Ram Traders", "30.00"]]);
  });

  it("does not leak parties between businesses", async () => {
    await add({ billNumber: "1", debit: "10", partyName: "Mine" });
    const other = await makeBusiness();
    expect(await listParties(other.ctx)).toEqual([]);
    const mine = (await listParties(ctx))[0];
    await expect(getPartyRow(other.ctx, mine.id)).rejects.toThrow(/not found/i);
  });

  it("does not let a viewer create parties", async () => {
    const v = await makeBusiness("VIEWER");
    await expect(createParty(v.ctx, { name: "X" })).rejects.toThrow();
  });
});

describe("ageing (oldest bill settled first)", () => {
  const L = (date: string, debit: string, credit = "0") => ({ date, debit: D(debit), credit: D(credit) });
  it("buckets what is still unpaid by age", () => {
    const today = "2026-01-01";
    const r = ageOutstanding(D(0), [L("2025-12-20", "100"), L("2025-11-01", "200"), L("2025-08-01", "300"), L("2025-12-25", "0", "350")], today);
    // 350 paid: settles the oldest (Aug 300) fully and 50 of Nov
    expect(r.buckets["90+"].toFixed(2)).toBe("0.00");
    expect(r.buckets["61-90"].toFixed(2)).toBe("150.00");
    expect(r.buckets["0-30"].toFixed(2)).toBe("100.00");
    expect(r.oldestDays).toBe(61);
  });
  it("treats a brought-forward balance as the oldest debt", () => {
    const r = ageOutstanding(D(500), [L("2025-12-30", "10"), L("2025-12-31", "0", "200")], "2026-01-01");
    expect(r.buckets["90+"].toFixed(2)).toBe("300.00");
    expect(r.buckets["0-30"].toFixed(2)).toBe("10.00");
  });
});
