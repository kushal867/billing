import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { makeBusiness, makeFy, setOpening, entry, bs } from "./helpers";
import { createTransaction } from "@/lib/services/transactions";
import { listLedger } from "@/lib/services/ledger";
import { OfflineQueue, syncQueue, type KV, type SendResult } from "@/lib/offline-queue";
import { createCipher } from "@/lib/offline-crypto";
import type { Ctx } from "@/lib/auth/context";

class MemoryKV implements KV { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }
const queue = () => { const key = crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); return new OfflineQueue(new MemoryKV(), "u", createCipher(() => key)); };
let ctx: Ctx;
beforeEach(async () => {
  ({ ctx } = await makeBusiness());
  const fy = await makeFy(ctx, 2082);
  await setOpening(ctx, "0", fy.id, bs(2082, 4, 1));
});

/** The same sender the app uses, but calling the service directly. */
const send = (ctxx: Ctx) => async (p: Record<string, unknown>): Promise<SendResult> => {
  const r = await createTransaction(ctxx, p);
  return r.status === "duplicate" ? { kind: "duplicate", message: "dup" } : { kind: "saved" };
};

describe("offline sync against the real server rules", () => {
  it("entries typed offline sync in order, keeping same-date order and exact balances", async () => {
    const q = queue();
    for (let i = 1; i <= 5; i++) await q.enqueue({ dateText: "2082-04-10", calendar: "BS", billNumber: String(i), debit: "10", credit: "", description: "", status: "POSTED" });
    expect((await syncQueue(q, send(ctx))).synced).toBe(5);
    const rows = (await listLedger(ctx, { pageSize: 0 })).rows;
    expect(rows.map((r) => [r.billNumber, r.balance?.toFixed(2)])).toEqual([["1", "10.00"], ["2", "20.00"], ["3", "30.00"], ["4", "40.00"], ["5", "50.00"]]);
  });

  it("a retried or double-synced entry is saved exactly once", async () => {
    const q = queue();
    const item = (await q.enqueue({ dateText: "2082-04-10", calendar: "BS", billNumber: "9", debit: "5", credit: "", description: "", status: "POSTED" }))!;
    // Simulate: the request reached the server but the response was lost, so the client retries; and a 2nd tab syncs too.
    await Promise.all([createTransaction(ctx, item.payload), createTransaction(ctx, item.payload)]);
    await createTransaction(ctx, item.payload);
    expect(await db.transaction.count({ where: { businessId: ctx.businessId } })).toBe(1);
    expect((await syncQueue(q, send(ctx))).synced).toBe(1); // sync after the fact is still a clean no-op
    expect(await db.transaction.count({ where: { businessId: ctx.businessId } })).toBe(1);
  });

  it("an offline entry that is invalid or duplicate is held for review, not silently dropped or saved twice", async () => {
    await createTransaction(ctx, entry({ dateText: "2082-04-10", calendar: "BS", billNumber: "7", debit: "50" }));
    const q = queue();
    await q.enqueue({ dateText: "2082-04-10", calendar: "BS", billNumber: "7", debit: "99", credit: "", description: "", status: "POSTED" });
    await q.enqueue({ dateText: "2082-04-10", calendar: "BS", billNumber: "8", debit: "1", credit: "", description: "", status: "POSTED" });
    const sender = async (p: Record<string, unknown>): Promise<SendResult> => {
      try { return await send(ctx)(p); } catch (e) { return { kind: "error", message: (e as Error).message }; }
    };
    const r = await syncQueue(q, sender);
    expect(r).toMatchObject({ synced: 1, review: 1 });
    expect((await q.review())[0].kind).toBe("duplicate");
    expect(await db.transaction.count({ where: { businessId: ctx.businessId } })).toBe(2);
  });
});
