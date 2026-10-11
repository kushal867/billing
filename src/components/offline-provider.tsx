"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { CloudOff, RefreshCw } from "lucide-react";
import { saveEntry } from "@/actions/entries";
import { Button } from "@/components/ui/button";
import { OfflineQueue, isNetworkError, syncQueue, type EntryPayload, type QueueItem, type SendResult } from "@/lib/offline-queue";
import { useT } from "@/lib/i18n/client";

type Ctx = {
  /** Number of entries waiting on this device. */
  pending: number;
  /** Queue an entry typed while offline. Returns false if the queue is full. */
  enqueue: (p: Omit<EntryPayload, "clientToken"> & { clientToken?: string }) => boolean;
  online: boolean;
};
const OfflineContext = createContext<Ctx>({ pending: 0, enqueue: () => false, online: true });
export const useOffline = () => useContext(OfflineContext);

async function sendOne(p: EntryPayload): Promise<SendResult> {
  try {
    const res = await saveEntry(p);
    if (!res.ok) return res.code === "INTERNAL" ? { kind: "network" } : { kind: "error", message: res.fieldErrors ? Object.values(res.fieldErrors)[0] : res.error };
    if (res.data.status === "duplicate") return { kind: "duplicate", message: "This bill number is already used" };
    return { kind: "saved" };
  } catch (e) {
    if (isNetworkError(e)) return { kind: "network" };
    throw e;
  }
}

/** Keeps entries typed while offline on this device and sends them, in order, when the internet returns. */
export function OfflineProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const t = useT();
  const queue = useMemo(() => (typeof window === "undefined" ? null : new OfflineQueue(window.localStorage, userId)), [userId]);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false);

  const reload = useCallback(() => { if (queue) setItems(queue.list()); }, [queue]);

  const sync = useCallback(async (manual = false) => {
    if (!queue || busy.current || queue.pending().length === 0) return;
    busy.current = true;
    setSyncing(true);
    try {
      const r = await syncQueue(queue, sendOne);
      reload();
      if (r.synced > 0) { toast.success(t("All saved entries have been synced") + (r.synced > 1 ? ` (${r.synced})` : "")); window.dispatchEvent(new Event("kusbill:synced")); }
      if (r.stoppedOffline && manual) toast.error(t("You are offline"));
    } finally { busy.current = false; setSyncing(false); }
  }, [queue, reload, t]);

  const enqueue = useCallback<Ctx["enqueue"]>((p) => {
    if (!queue) return false;
    const item = queue.enqueue(p);
    reload();
    return !!item;
  }, [queue, reload]);

  useEffect(() => {
    setOnline(navigator.onLine);
    try { localStorage.setItem("kusbill:lastUser", userId); } catch { /* ignore */ }
    reload();
    const goOnline = () => { setOnline(true); void sync(); };
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    window.addEventListener("storage", reload); // another tab (or the offline page) changed the queue
    void sync();
    const timer = setInterval(() => void sync(), 60_000);
    // Register the offline-support service worker (production builds only).
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); window.removeEventListener("storage", reload); clearInterval(timer); };
  }, [userId, reload, sync]);

  const pending = items.filter((i) => i.state === "pending").length;
  const review = items.filter((i) => i.state === "review");
  const value = useMemo(() => ({ pending, enqueue, online }), [pending, enqueue, online]);

  return (
    <OfflineContext.Provider value={value}>
      {(!online || pending > 0 || review.length > 0) && (
        <div className="no-print sticky top-0 z-40 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950" role="status">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
            <CloudOff className="h-4 w-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              {!online && <p className="font-medium">{t("You are offline")}</p>}
              {!online && <p className="text-xs">{t("Entries are saved on this device and will be sent when the internet is back.")}</p>}
              {pending > 0 && <p className={online ? "font-medium" : "text-xs"}>{t("{n} waiting to sync", { n: pending })}</p>}
            </div>
            {pending > 0 && <Button size="sm" variant="outline" onClick={() => void sync(true)} loading={syncing}><RefreshCw className="h-3.5 w-3.5" aria-hidden /> {t("Sync now")}</Button>}
          </div>
          {review.length > 0 && (
            <ul className="mx-auto mt-2 max-w-7xl space-y-1">
              {review.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2 rounded bg-white/70 px-2 py-1 text-xs">
                  <span className="font-medium">{t("Needs attention")}:</span>
                  <span className="num">{i.payload.dateText} · {i.payload.billNumber || "-"} · {i.payload.debit || i.payload.credit}</span>
                  <span className="text-expense">{t(i.message ?? "")}</span>
                  <span className="ml-auto flex gap-1">
                    {i.kind === "duplicate" && <Button size="sm" variant="outline" className="h-7" onClick={() => { queue?.update(i.id, { state: "pending", payload: { ...i.payload, allowDuplicate: true }, kind: undefined, message: undefined }); reload(); void sync(true); }}>{t("Save anyway")}</Button>}
                    {i.kind === "error" && <Button size="sm" variant="outline" className="h-7" onClick={() => { queue?.update(i.id, { state: "pending", attempts: 0, kind: undefined, message: undefined }); reload(); void sync(true); }}>{t("Retry")}</Button>}
                    <Button size="sm" variant="ghost" className="h-7" onClick={() => { queue?.remove(i.id); reload(); }}>{t("Discard")}</Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {children}
    </OfflineContext.Provider>
  );
}
