import { describe, expect, it } from "vitest";
import { OfflineQueue, syncQueue, incrementBill, isNetworkError, MAX_QUEUE, queueKey, type EntryPayload, type KV, type SendResult } from "@/lib/offline-queue";
import { createCipher } from "@/lib/offline-crypto";

class MemoryKV implements KV {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}
const newKey = () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
const cipherWith = (key: Promise<CryptoKey>) => createCipher(() => key);
const p = (bill: string, extra: Partial<EntryPayload> = {}) => ({ dateText: "2082-04-10", calendar: "BS" as const, billNumber: bill, debit: "10", credit: "", description: "", status: "POSTED" as const, ...extra });
const mk = (kv = new MemoryKV(), user = "u", key = newKey()) => ({ kv, key, q: new OfflineQueue(kv, user, cipherWith(key)) });
const bills = async (q: OfflineQueue) => (await q.list()).map((i) => i.payload.billNumber);

describe("offline queue behaviour", () => {
  it("keeps entries in order, per user, and survives a reload", async () => {
    const { kv, key, q } = mk();
    await q.enqueue(p("1")); await q.enqueue(p("2"));
    expect(await bills(new OfflineQueue(kv, "u", cipherWith(key)))).toEqual(["1", "2"]);
    expect(await new OfflineQueue(kv, "u2", cipherWith(key)).list()).toEqual([]);
  });

  it("gives every entry a unique idempotency token and ignores re-queuing the same one", async () => {
    const { q } = mk();
    const a = (await q.enqueue(p("1")))!; const b = (await q.enqueue(p("1")))!;
    expect(a.id).not.toBe(b.id);
    expect((await q.enqueue(p("1", { clientToken: a.id })))!.id).toBe(a.id);
    expect(await q.list()).toHaveLength(2);
  });

  it("syncs in order, removes what was saved and sends each token exactly once", async () => {
    const { q } = mk();
    for (const b of ["1", "2", "3"]) await q.enqueue(p(b));
    const sent: string[] = [];
    const r = await syncQueue(q, async (pl) => { sent.push(pl.billNumber); return { kind: "saved" }; });
    expect(sent).toEqual(["1", "2", "3"]);
    expect(r).toEqual({ synced: 3, review: 0, stoppedOffline: false });
    expect(await q.list()).toEqual([]);
    expect((await syncQueue(q, async () => ({ kind: "saved" }))).synced).toBe(0);
  });

  it("stops at the first network failure and keeps the rest pending, in order", async () => {
    const { q } = mk();
    for (const b of ["1", "2", "3"]) await q.enqueue(p(b));
    let calls = 0;
    const r = await syncQueue(q, async (): Promise<SendResult> => (++calls === 1 ? { kind: "saved" } : { kind: "network" }));
    expect(r).toMatchObject({ synced: 1, stoppedOffline: true });
    expect((await q.pending()).map((i) => i.payload.billNumber)).toEqual(["2", "3"]);
    expect(calls).toBe(2);
    expect((await syncQueue(q, async () => ({ kind: "saved" }))).synced).toBe(2);
    expect(await q.list()).toEqual([]);
  });

  it("moves rejected entries to review without blocking the ones after them", async () => {
    const { q } = mk();
    for (const b of ["1", "2", "3"]) await q.enqueue(p(b));
    const r = await syncQueue(q, async (pl): Promise<SendResult> => pl.billNumber === "1" ? { kind: "duplicate", message: "dup" } : pl.billNumber === "2" ? { kind: "error", message: "bad" } : { kind: "saved" });
    expect(r).toEqual({ synced: 1, review: 2, stoppedOffline: false });
    expect((await q.review()).map((i) => [i.payload.billNumber, i.kind])).toEqual([["1", "duplicate"], ["2", "error"]]);
    expect(await q.pending()).toEqual([]);
  });

  it("treats a thrown error as a network failure and never loses the entry", async () => {
    const { q } = mk();
    await q.enqueue(p("1"));
    expect((await syncQueue(q, async () => { throw new TypeError("Failed to fetch"); })).stoppedOffline).toBe(true);
    expect(await q.pending()).toHaveLength(1);
  });

  it("caps the queue and tolerates corrupt storage", async () => {
    const { kv, q } = mk();
    for (let i = 0; i < MAX_QUEUE; i++) await q.enqueue(p(String(i)));
    expect(await q.enqueue(p("overflow"))).toBeNull();
    kv.setItem(queueKey("bad"), "{not json");
    expect(await new OfflineQueue(kv, "bad", cipherWith(newKey())).list()).toEqual([]);
  });

  it("two tabs / simultaneous calls cannot overwrite each other", async () => {
    const { kv, key } = mk();
    const tabs = [new OfflineQueue(kv, "u", cipherWith(key)), new OfflineQueue(kv, "u", cipherWith(key))];
    await Promise.all(Array.from({ length: 30 }, (_, i) => tabs[i % 2].enqueue(p(`c${i}`))));
    expect(await tabs[0].list()).toHaveLength(30);
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

describe("encryption at rest", () => {
  it("never stores entry details in readable form", async () => {
    const { kv, q } = mk();
    await q.enqueue(p("SECRET-BILL-777", { debit: "123456.78", description: "Customer: Sita Sharma" }));
    const stored = kv.getItem(queueKey("u"))!;
    for (const needle of ["SECRET-BILL-777", "123456.78", "Sita", "Customer", "2082-04-10", "debit"]) expect(stored).not.toContain(needle);
    expect(JSON.parse(stored)).toMatchObject({ v: 2 });
  });

  it("uses a fresh random IV for every write", async () => {
    const { kv, q } = mk();
    await q.enqueue(p("1"));
    const iv1 = JSON.parse(kv.getItem(queueKey("u"))!).iv;
    await q.enqueue(p("2"));
    expect(JSON.parse(kv.getItem(queueKey("u"))!).iv).not.toBe(iv1);
  });

  it("cannot be read with a different key, and tampering is detected rather than trusted", async () => {
    const { kv, q } = mk();
    await q.enqueue(p("1"));
    expect(await new OfflineQueue(kv, "u", cipherWith(newKey())).list()).toEqual([]); // wrong device key
    const o = JSON.parse(kv.getItem(queueKey("u"))!);
    const bytes = Uint8Array.from(atob(o.d), (c) => c.charCodeAt(0)); bytes[0] ^= 1;
    kv.setItem(queueKey("u"), JSON.stringify({ ...o, d: btoa(String.fromCharCode(...bytes)) }));
    expect(await q.list()).toEqual([]); // GCM authentication fails -> treated as unreadable, not parsed
  });

  it("upgrades a legacy plaintext queue to encrypted storage without losing entries", async () => {
    const kv = new MemoryKV();
    const legacy = [{ id: "t1", payload: { ...p("77"), clientToken: "t1" }, queuedAt: 1, state: "pending", attempts: 0 }];
    kv.setItem(queueKey("u"), JSON.stringify(legacy));
    const q = new OfflineQueue(kv, "u", cipherWith(newKey()));
    expect(await bills(q)).toEqual(["77"]); // readable before upgrade
    await q.upgrade();
    expect(kv.getItem(queueKey("u"))).not.toContain("77");
    expect(await bills(q)).toEqual(["77"]);
  });

  it("reports failure instead of silently dropping an entry when encryption fails", async () => {
    const broken = { encrypt: async () => { throw new Error("no crypto"); }, decrypt: async () => "[]" };
    const q = new OfflineQueue(new MemoryKV(), "u", broken);
    expect(await q.enqueue(p("1"))).toBeNull();
  });
});
