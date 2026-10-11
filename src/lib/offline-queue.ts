/**
 * Offline queue: entries typed while the internet is down are kept on this device and sent later.
 * Pure logic (storage is injected) so it can be tested without a browser.
 *
 * Safety: every queued entry carries its own `clientToken`; the server treats a repeated token as
 * "already saved", so a retry (or a second open tab syncing at the same time) can never create a duplicate.
 */
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

export const MAX_QUEUE = 500;
export const MAX_ATTEMPTS = 3;
export const queueKey = (userId: string) => `kusbill:offlineQueue:${userId}`;

export class OfflineQueue {
  constructor(private kv: KV, private userId: string) {}

  list(): QueueItem[] {
    try {
      const raw = this.kv.getItem(queueKey(this.userId));
      const parsed = raw ? (JSON.parse(raw) as QueueItem[]) : [];
      return Array.isArray(parsed) ? parsed.filter((i) => i && i.id && i.payload) : [];
    } catch {
      return [];
    }
  }

  private save(items: QueueItem[]) {
    try { this.kv.setItem(queueKey(this.userId), JSON.stringify(items)); } catch { /* storage full or blocked */ }
  }

  enqueue(payload: Omit<EntryPayload, "clientToken"> & { clientToken?: string }, now = Date.now()): QueueItem | null {
    const items = this.list();
    if (items.length >= MAX_QUEUE) return null;
    const token = payload.clientToken ?? newToken();
    const existing = items.find((i) => i.id === token);
    if (existing) return existing; // idempotent: queuing the same entry twice keeps one
    const item: QueueItem = { id: token, payload: { ...payload, clientToken: token }, queuedAt: now, state: "pending", attempts: 0 };
    this.save([...items, item]);
    return item;
  }

  remove(id: string) { this.save(this.list().filter((i) => i.id !== id)); }

  update(id: string, patch: Partial<QueueItem>) { this.save(this.list().map((i) => (i.id === id ? { ...i, ...patch } : i))); }

  pending() { return this.list().filter((i) => i.state === "pending"); }
  review() { return this.list().filter((i) => i.state === "review"); }
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
  for (const item of queue.pending()) {
    let res: SendResult;
    try { res = await send(item.payload); } catch { res = { kind: "network" }; }
    if (res.kind === "saved") { queue.remove(item.id); synced++; }
    else if (res.kind === "duplicate") { queue.update(item.id, { state: "review", kind: "duplicate", message: res.message }); review++; }
    else if (res.kind === "error") { queue.update(item.id, { state: "review", kind: "error", message: res.message }); review++; }
    else {
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS * 10) queue.update(item.id, { state: "review", kind: "error", message: "Could not reach the server", attempts });
      else queue.update(item.id, { attempts });
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
