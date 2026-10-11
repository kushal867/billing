import { describe, expect, it, beforeEach } from "vitest";
import { makeBusiness, makeFy, setOpening, entry, bs } from "./helpers";
import { createTransaction, reverseTransaction } from "@/lib/services/transactions";
import { findGaps, getAlerts } from "@/lib/services/alerts";
import { listLedger } from "@/lib/services/ledger";
import { todayIso, addDays } from "@/lib/dates";
import type { Ctx } from "@/lib/auth/context";

let ctx: Ctx;
const T = todayIso();
const add = (o: Record<string, unknown>) => createTransaction(ctx, entry({ dateText: addDays(T, -1), calendar: "AD", ...o }));
const kinds = async (today = T) => (await getAlerts(ctx, today)).map((a) => a.kind);

beforeEach(async () => {
  ({ ctx } = await makeBusiness());
  const fy = await makeFy(ctx, 2082);
  await setOpening(ctx, "0", fy.id, bs(2082, 4, 1));
});

describe("gap detection", () => {
  it("finds missing ranges, ignores duplicates and huge jumps (series restarts)", () => {
    expect(findGaps([1, 2, 3, 7, 8, 10])).toEqual([[4, 6], [9, 9]]);
    expect(findGaps([5, 5, 5])).toEqual([]);
    expect(findGaps([1, 2, 1000])).toEqual([]);
    expect(findGaps([])).toEqual([]);
    expect(findGaps([3, 1, 2])).toEqual([]);
  });
});

describe("alerts", () => {
  it("is quiet for a clean ledger", async () => {
    for (let i = 1; i <= 3; i++) await add({ billNumber: String(i), debit: "10" });
    expect(await kinds()).not.toContain("missing-bills");
    expect(await kinds()).not.toContain("duplicate-bills");
  });

  it("reports missing bill numbers with the exact ranges", async () => {
    for (const n of [101, 102, 105, 106, 110]) await add({ billNumber: String(n), debit: "10" });
    const a = (await getAlerts(ctx, T)).find((x) => x.kind === "missing-bills")!;
    expect(a.count).toBe(5);
    expect(a.items).toEqual(["103-104", "107-109"]);
    expect(a.severity).toBe("warn");
  });

  it("reports duplicate bill numbers but not a reversal and its original", async () => {
    const r = await add({ billNumber: "50", debit: "10" });
    if (r.status !== "saved") throw new Error();
    await reverseTransaction(ctx, r.transaction.id, "mistake", T);
    expect(await kinds()).not.toContain("duplicate-bills");
    await add({ billNumber: "60", debit: "10" });
    await createTransaction(ctx, entry({ dateText: addDays(T, -1), calendar: "AD", billNumber: "60", debit: "99", allowDuplicate: true }));
    const dup = (await getAlerts(ctx, T)).find((x) => x.kind === "duplicate-bills")!;
    expect(dup.items).toEqual(["60 (x2)"]);
    const rows = (await listLedger(ctx, { pageSize: 0 })).rows;
    expect(rows.filter((x) => x.flags.duplicateBill).map((x) => x.billNumber)).toEqual(["60", "60"]);
  });

  it("flags unusually large recent amounts, drafts and future-dated entries", async () => {
    for (let i = 1; i <= 25; i++) await add({ billNumber: `A${i}`, debit: "100" });
    await add({ billNumber: "BIG", debit: "9999999" });
    await createTransaction(ctx, entry({ dateText: addDays(T, 5), calendar: "AD", billNumber: "FUT", debit: "1" }));
    await createTransaction(ctx, entry({ dateText: T, calendar: "AD", billNumber: "", debit: "5", status: "DRAFT" }));
    const k = await kinds();
    expect(k).toEqual(expect.arrayContaining(["large", "future", "drafts"]));
    const large = (await getAlerts(ctx, T)).find((x) => x.kind === "large")!;
    expect(large.items[0]).toContain("BIG");
  });

  it("reminds when nothing has been recorded for days, and about uncategorised entries", async () => {
    await add({ billNumber: "1", debit: "1" });
    expect(await kinds()).not.toContain("stale");
    expect(await kinds(addDays(T, 10))).toContain("stale");
    expect(await kinds()).toContain("uncategorised");
  });

  it("alert ids are stable and change when the content changes", async () => {
    await add({ billNumber: "1", debit: "1" }); await add({ billNumber: "4", debit: "1" });
    const a1 = (await getAlerts(ctx, T)).find((x) => x.kind === "missing-bills")!;
    expect((await getAlerts(ctx, T)).find((x) => x.kind === "missing-bills")!.id).toBe(a1.id);
    await add({ billNumber: "9", debit: "1" });
    expect((await getAlerts(ctx, T)).find((x) => x.kind === "missing-bills")!.id).not.toBe(a1.id);
  });

  it("never mixes businesses", async () => {
    for (const n of [1, 5]) await add({ billNumber: String(n), debit: "1" });
    const other = await makeBusiness();
    expect(await getAlerts(other.ctx, T)).toEqual([]);
  });
});
