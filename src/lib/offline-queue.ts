/**
 * Offline queue: entries typed while the internet is down are kept on this device and sent later.
 * Storage and encryption are injected so the logic can be tested without a browser.
 *
 * Safety:
 *  - Entries are stored ENCRYPTED (see offline-crypto.ts). Old unencrypted queues are upgraded on first use.
 *  - Every queued entry carries its own `clientToken`; the server treats a repeated token as "already
 *    saved", so a retry (or a second open tab syncing at the same time) can never create a duplicate.
 *  - All reads/writes are serialised (Web Locks across tabs when available), so two tabs cannot overwrite each other.
 */
import type { Cipher } from "./offline-crypto";

export type EntryPayload = {
  dateText: string;
  calendar: "BS" | "AD";
  billNumber: string;
  debit: string;
  credit: string;
  description: string;
  categoryId?: string;
  status: "POSTED" | "DRAFT";
  clientToken: string;
  allowDuplicate?: boolean;
};

export type QueueItem = {
  id: string;
  payload: EntryPayload;
  queuedAt: number;
  state: "pending" | "review";
  attempts: number;
  kind?: "duplicate" | "error";
  message?: string;
};

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
export type Locker = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export const MAX_QUEUE = 500;
export const MAX_ATTEMPTS = 3;
export const queueKey = (userId: string) => `kusbill:offlineQueue:${userId}`;

const chains = new Map<string, Promise<unknown>>();
/** In-process fallback lock; the browser version uses navigator.locks so tabs queue up too. */
const memoryLock: Locker = (name, fn) => {
  const prev = chains.get(name) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(name, next.catch(() => undefined));
  return next;
};
export const browserLock: Locker = (name, fn) =>
  typeof navigator !== "undefined" && navigator.locks ? navigator.locks.request(name, fn) : memoryLock(name, fn);

export class OfflineQueue {
  constructor(private kv: KV, private userId: string, private cipher: Cipher | null = null, private lock: Locker = memoryLock) {}

  private async read(): Promise<QueueItem[]> {
    const raw = this.kv.getItem(queueKey(this.userId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      // Legacy (version 1) queues were stored as a plain array. They are re-encrypted on the next write.
      const items = Array.isArray(parsed) ? parsed : this.cipher ? (JSON.parse(await this.cipher.decrypt(raw)) as QueueItem[]) : [];
      return Array.isArray(items) ? items.filter((i) => i && i.id && i.payload) : [];
    } catch {
      return []; // unreadable (e.g. key lost): treat as empty rather than crash
    }
  }

  private async write(items: QueueItem[]): Promise<boolean> {
    try {
      const json = JSON.stringify(items);
      if (!this.cipher) { this.kv.setItem(queueKey(this.userId), json); return true; }
      this.kv.setItem(queueKey(this.userId), await this.cipher.encrypt(json));
      return true;
    } catch {
      return false; // storage full/blocked, or encryption unavailable
    }
  }

  private mutate<T>(fn: (items: QueueItem[]) => { items?: QueueItem[]; result: T }): Promise<T> {
    return this.lock(queueKey(this.userId), async () => {
      const cur = await this.read();
      const { items, result } = fn(cur);
      if (items) await this.write(items);
      return result;
    });
  }

  list(): Promise<QueueItem[]> { return this.lock(queueKey(this.userId), () => this.read()); }

  /** Upgrades a legacy plaintext queue to encrypted storage. Safe to call every time. */
  upgrade(): Promise<void> {
    return this.lock(queueKey(this.userId), async () => {
      const raw = this.kv.getItem(queueKey(this.userId));
      if (!raw || !this.cipher) return;
      try { if (Array.isArray(JSON.parse(raw))) await this.write(await this.read()); } catch { /* ignore */ }
    });
  }

  /** Returns the queued item, or null if the queue is full or storage failed. */
  enqueue(payload: Omit<EntryPayload, "clientToken"> & { clientToken?: string }, now = Date.now()): Promise<QueueItem | null> {
    const token = payload.clientToken ?? newToken();
    return this.lock(queueKey(this.userId), async () => {
      const items = await this.read();
      const existing = items.find((i) => i.id === token);
      if (existing) return existing; // idempotent: queuing the same entry twice keeps one
      if (items.length >= MAX_QUEUE) return null;
      const item: QueueItem = { id: token, payload: { ...payload, clientToken: token }, queuedAt: now, state: "pending", attempts: 0 };
      return (await this.write([...items, item])) ? item : null;
    });
  }

  remove(id: string) { return this.mutate((items) => ({ items: items.filter((i) => i.id !== id), result: undefined })); }
  update(id: string, patch: Partial<QueueItem>) { return this.mutate((items) => ({ items: items.map((i) => (i.id === id ? { ...i, ...patch } : i)), result: undefined })); }
  async pending() { return (await this.list()).filter((i) => i.state === "pending"); }
  async review() { return (await this.list()).filter((i) => i.state === "review"); }
}

export const newToken = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type SendResult =
  | { kind: "saved" }
  | { kind: "duplicate"; message: string }
  | { kind: "error"; message: string }
  | { kind: "network" };

/** Sends pending items in the order they were typed. Stops at the first network failure. */
export async function syncQueue(queue: OfflineQueue, send: (p: EntryPayload) => Promise<SendResult>): Promise<{ synced: number; review: number; stoppedOffline: boolean }> {
  let synced = 0;
  let review = 0;
  for (const item of await queue.pending()) {
    let res: SendResult;
    try { res = await send(item.payload); } catch { res = { kind: "network" }; }
    if (res.kind === "saved") { await queue.remove(item.id); synced++; }
    else if (res.kind === "duplicate") { await queue.update(item.id, { state: "review", kind: "duplicate", message: res.message }); review++; }
    else if (res.kind === "error") { await queue.update(item.id, { state: "review", kind: "error", message: res.message }); review++; }
    else {
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS * 10) await queue.update(item.id, { state: "review", kind: "error", message: "Could not reach the server", attempts });
      else await queue.update(item.id, { attempts });
      return { synced, review, stoppedOffline: true };
    }
  }
  return { synced, review, stoppedOffline: false };
}

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(msg);
}

/** "A-0099" -> "A-0100", "12" -> "13"; text without trailing digits gives "". */
export function incrementBill(bill: string): string {
  const m = /^(.*?)(\d+)$/.exec(bill.trim());
  if (!m) return "";
  return `${m[1]}${(BigInt(m[2]) + 1n).toString().padStart(m[2].length, "0")}`;
}
