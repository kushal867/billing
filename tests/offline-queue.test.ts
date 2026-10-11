import { describe, expect, it } from "vitest";
import { OfflineQueue, syncQueue, incrementBill, isNetworkError, MAX_QUEUE, queueKey, type EntryPayload, type KV, type SendResult } from "@/lib/offline-queue";

class MemoryKV implements KV {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const p = (bill: string, extra: Partial<EntryPayload> = {}) => ({ dateText: "2082-04-10", calendar: "BS" as const, billNumber: bill, debit: "10", credit: "", description: "", status: "POSTED" as const, ...extra });

describe("offline queue", () => {
  it("keeps entries in order, per user, and survives a reload", () => {
    const kv = new MemoryKV();
    const q = new OfflineQueue(kv, "u1");
    q.enqueue(p("1")); q.enqueue(p("2"));
    expect(new OfflineQueue(kv, "u1").list().map((i) => i.payload.billNumber)).toEqual(["1", "2"]);
    expect(new OfflineQueue(kv, "u2").list()).toEqual([]); // another user on the same device sees nothing
    expect(kv.getItem(queueKey("u1"))).toBeTruthy();
  });

  it("gives every entry a unique idempotency token and ignores re-queuing the same one", () => {
    const q = new OfflineQueue(new MemoryKV(), "u");
    const a = q.enqueue(p("1"))!; const b = q.enqueue(p("1"))!;
    expect(a.id).not.toBe(b.id);
    const again = q.enqueue(p("1", { clientToken: a.id }))!;
    expect(again.id).toBe(a.id);
    expect(q.list()).toHaveLength(2);
  });

  it("syncs in order, removes what was saved and sends each token exactly once", async () => {
    const q = new OfflineQueue(new MemoryKV(), "u");
    ["1", "2", "3"].forEach((b) => q.enqueue(p(b)));
    const sent: string[] = [];
    const r = await syncQueue(q, async (pl) => { sent.push(pl.billNumber); return { kind: "saved" }; });
    expect(sent).toEqual(["1", "2", "3"]);
    expect(r).toEqual({ synced: 3, review: 0, stoppedOffline: false });
    expect(q.list()).toEqual([]);
    expect((await syncQueue(q, async () => ({ kind: "saved" }))).synced).toBe(0);
  });

  it("stops at the first network failure and keeps the rest pending, in order", async () => {
    const q = new OfflineQueue(new MemoryKV(), "u");
    ["1", "2", "3"].forEach((b) => q.enqueue(p(b)));
    let calls = 0;
    const r = await syncQueue(q, async (): Promise<SendResult> => (++calls === 1 ? { kind: "saved" } : { kind: "network" }));
    expect(r).toMatchObject({ synced: 1, stoppedOffline: true });
    expect(q.pending().map((i) => i.payload.billNumber)).toEqual(["2", "3"]);
    expect(calls).toBe(2); // did not hammer the server after the first failure
    const again = await syncQueue(q, async () => ({ kind: "saved" }));
    expect(again.synced).toBe(2);
    expect(q.list()).toEqual([]);
  });

  it("moves rejected entries to review without blocking the ones after them", async () => {
    const q = new OfflineQueue(new MemoryKV(), "u");
    ["1", "2", "3"].forEach((b) => q.enqueue(p(b)));
    const r = await syncQueue(q, async (pl): Promise<SendResult> =>
      pl.billNumber === "1" ? { kind: "duplicate", message: "This bill number is already used" } : pl.billNumber === "2" ? { kind: "error", message: "bad" } : { kind: "saved" });
    expect(r).toEqual({ synced: 1, review: 2, stoppedOffline: false });
    expect(q.review().map((i) => [i.payload.billNumber, i.kind])).toEqual([["1", "duplicate"], ["2", "error"]]);
    expect(q.pending()).toEqual([]);
  });

  it("treats a thrown error as a network failure and never loses the entry", async () => {
    const q = new OfflineQueue(new MemoryKV(), "u");
    q.enqueue(p("1"));
    const r = await syncQueue(q, async () => { throw new TypeError("Failed to fetch"); });
    expect(r.stoppedOffline).toBe(true);
    expect(q.pending()).toHaveLength(1);
  });

  it("caps the queue and tolerates corrupt storage", () => {
    const kv = new MemoryKV();
    const q = new OfflineQueue(kv, "u");
    for (let i = 0; i < MAX_QUEUE; i++) q.enqueue(p(String(i)));
    expect(q.enqueue(p("overflow"))).toBeNull();
    kv.setItem(queueKey("bad"), "{not json");
    expect(new OfflineQueue(kv, "bad").list()).toEqual([]);
  });

  it("detects network errors and increments bill numbers for fast typing", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("Load failed"))).toBe(true);
    expect(isNetworkError(new Error("Validation failed"))).toBe(false);
    expect(incrementBill("101")).toBe("102");
    expect(incrementBill("A-0099")).toBe("A-0100");
    expect(incrementBill("abc")).toBe("");
  });
});
