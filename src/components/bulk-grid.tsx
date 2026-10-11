"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ListPlus, Save } from "lucide-react";
import { previewBulk, saveBulk } from "@/actions/bulk";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DateInput } from "@/components/date-input";
import { formatDate, parseEnteredDate, type Calendar } from "@/lib/dates";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { useOffline } from "@/components/offline-provider";
import { isNetworkError } from "@/lib/offline-queue";

type Row = { date: string; bill: string; debit: string; credit: string; description: string };
type Result = { rowNumber: number; status: "ok" | "duplicate" | "error"; errors: string[]; warnings: string[] };
const COLS = ["date", "bill", "debit", "credit", "description"] as const;
const blank = (): Row => ({ date: "", bill: "", debit: "", credit: "", description: "" });
const STORE = "kusbill:bulkDraft";

export function BulkGrid({ calendar, nextBill }: { calendar: Calendar; nextBill: string }) {
  const t = useT();
  const router = useRouter();
  const offline = useOffline();
  const [pending, start] = useTransition();
  const [cal, setCal] = useState<Calendar>(calendar);
  const [pageDate, setPageDate] = useState(formatDate(new Date(Date.now() + 5.75 * 3600_000).toISOString().slice(0, 10), calendar));
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: 20 }, blank));
  const [startNo, setStartNo] = useState(nextBill);
  const [results, setResults] = useState<Record<number, Result>>({});
  const [error, setError] = useState("");
  const [includeDup, setIncludeDup] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  // Keep an unsaved page across reloads (per device).
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? "null") as { rows: Row[]; pageDate: string } | null;
      if (saved?.rows?.some((r) => r.bill || r.debit || r.credit || r.description)) { setRows(saved.rows); if (saved.pageDate) setPageDate(saved.pageDate); toast.info(t("Restored your unsaved page")); }
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(STORE, JSON.stringify({ rows, pageDate })); } catch { /* ignore */ } }, [rows, pageDate]);

  const setCell = useCallback((i: number, col: keyof Row, value: string) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [col]: value } : r)));
    setResults({});
  }, []);

  const focusCell = (i: number, c: number) => tableRef.current?.querySelector<HTMLInputElement>(`[data-cell="${i}-${c}"]`)?.focus();
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number, c: number) => {
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); if (i === rows.length - 1 && e.key === "Enter") setRows((rs) => [...rs, blank()]); setTimeout(() => focusCell(i + 1, c), 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusCell(i - 1, c); }
  };

  /** Paste rows copied from Excel/Sheets: tab-separated columns, one row per line, starting at the focused cell. */
  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, i: number, c: number) => {
    const text = e.clipboardData.getData("text");
    if (!/[\t\n]/.test(text.trim())) return; // single value: normal paste
    e.preventDefault();
    const lines = text.replace(/\r/g, "").split("\n").filter((l, idx, a) => l !== "" || idx < a.length - 1);
    setRows((rs) => {
      const next = rs.map((r) => ({ ...r }));
      lines.forEach((line, li) => {
        while (next.length <= i + li) next.push(blank());
        line.split("\t").forEach((cell, ci) => { const col = COLS[c + ci]; if (col) next[i + li][col] = cell.trim(); });
      });
      return next;
    });
    setResults({});
    toast.success(t("Pasted {n} rows", { n: lines.length }));
  };

  const fillNumbers = () => {
    const m = /^(.*?)(\d+)$/.exec(startNo.trim());
    if (!m) return toast.error(t("Type a starting bill number first"));
    let n = BigInt(m[2]);
    const width = m[2].length;
    setRows((rs) => rs.map((r) => {
      if (r.bill || !(r.debit || r.credit || r.description)) return r;
      const bill = `${m[1]}${n.toString().padStart(width, "0")}`;
      n += 1n;
      return { ...r, bill };
    }));
    setResults({});
  };

  const payload = () => ({ rows, defaultDate: pageDate, calendar: cal });
  const active = rows.filter((r) => r.bill || r.debit || r.credit || r.description).length;

  const check = () => start(async () => {
    if (!parseEnteredDate(pageDate, cal).ok) { setError(t("Enter a valid page date first")); return; }
    let r: Awaited<ReturnType<typeof previewBulk>>;
    try { r = await previewBulk(payload()); } catch (e) { if (isNetworkError(e)) { setError(t("You are offline")); return; } throw e; }
    if (!r.ok) { setError(r.error); return; }
    setError("");
    setResults(Object.fromEntries(r.data.map((x) => [x.rowNumber, x])));
    const bad = r.data.filter((x) => x.status === "error").length;
    if (bad === 0) toast.success(t("All rows look good"));
  });

  const saveAll = () => start(async () => {
    let r: Awaited<ReturnType<typeof saveBulk>>;
    try {
      r = await saveBulk(payload(), includeDup);
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      // Offline: keep every typed row on this device, in order. Each is validated by the server when it syncs.
      const toQueue = rows.filter((x) => x.bill || x.debit || x.credit || x.description);
      let ok = true;
      for (const x of toQueue) ok = offline.enqueue({ dateText: x.date.trim() || pageDate, calendar: cal, billNumber: x.bill, debit: x.debit, credit: x.credit, description: x.description, status: "POSTED" }) && ok;
      if (!ok) { toast.error(t("This device has no room left.")); return; }
      try { localStorage.removeItem(STORE); } catch { /* ignore */ }
      setRows(Array.from({ length: 20 }, blank)); setResults({});
      toast.success(t("Saved on this device - will sync when online"));
      return;
    }
    if (!r.ok) {
      setError(r.error);
      // Show which rows are wrong so they can be fixed in place.
      const p = await previewBulk(payload());
      if (p.ok) setResults(Object.fromEntries(p.data.map((x) => [x.rowNumber, x])));
      return;
    }
    try { localStorage.removeItem(STORE); } catch { /* ignore */ }
    toast.success(t("{n} entries saved", { n: r.data.imported }));
    router.push("/ledger");
    router.refresh();
  });

  const list = Object.values(results);
  const errCount = list.filter((x) => x.status === "error").length;
  const dupCount = list.filter((x) => x.status === "duplicate").length;
  const okCount = list.filter((x) => x.status === "ok").length;
  const checked = list.length > 0;
  const canSave = checked && errCount === 0 && (dupCount === 0 || includeDup) && okCount + (includeDup ? dupCount : 0) > 0;

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-4 rounded-lg border bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]">
        <Field label={t("Date for rows without their own date")} htmlFor="bulk-date">
          <DateInput id="bulk-date" value={pageDate} calendar={cal} onChange={(v) => { setPageDate(v); setResults({}); }} onCalendarChange={setCal} />
        </Field>
        <Field label={t("Number rows starting from")} htmlFor="bulk-start">
          <div className="flex gap-2"><Input id="bulk-start" className="num" value={startNo} onChange={(e) => setStartNo(e.target.value)} /><Button type="button" variant="outline" onClick={fillNumbers}>{t("Fill")}</Button></div>
        </Field>
        <div className="flex items-end"><Button type="button" variant="outline" onClick={() => setRows((rs) => [...rs, ...Array.from({ length: 10 }, blank)])}><ListPlus className="h-4 w-4" aria-hidden /> {t("Add 10 rows")}</Button></div>
      </div>
      <p className="text-xs text-muted-foreground">{t("Tip: paste rows copied from Excel into the first cell.")}</p>

      <div className="overflow-x-auto rounded-lg border bg-white">
        <table className="tbl" ref={tableRef}>
          <thead><tr><th className="w-12">{t("Row")}</th><th className="min-w-36">{t("Date")}</th><th className="min-w-28">{t("Bill No.")}</th><th className="min-w-32 text-right">{t("Debit")}</th><th className="min-w-32 text-right">{t("Credit")}</th><th className="min-w-56">{t("Description")}</th><th className="min-w-40" /></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const res = results[i + 1];
              const empty = !r.bill && !r.debit && !r.credit && !r.description;
              return (
                <tr key={i} className={cn(res?.status === "error" && "bg-red-50", res?.status === "duplicate" && "bg-amber-50", empty && "opacity-80")}>
                  <td className="num text-muted-foreground">{i + 1}</td>
                  {COLS.map((col, c) => (
                    <td key={col} className="p-1">
                      <Input
                        data-cell={`${i}-${c}`} aria-label={`${t("Row")} ${i + 1} ${t(col === "date" ? "Date" : col === "bill" ? "Bill No." : col === "debit" ? "Debit" : col === "credit" ? "Credit" : "Description")}`}
                        className={cn("h-9", (col === "debit" || col === "credit") && "num text-right", col !== "description" && "num")} inputMode={col === "debit" || col === "credit" ? "decimal" : undefined}
                        placeholder={col === "date" ? pageDate : undefined} value={r[col]} disabled={pending}
                        onChange={(e) => setCell(i, col, col === "debit" || col === "credit" ? e.target.value.replace(/[^\d.,]/g, "") : e.target.value)}
                        onKeyDown={(e) => onKey(e, i, c)} onPaste={(e) => onPaste(e, i, c)} onFocus={(e) => e.currentTarget.select()}
                      />
                    </td>
                  ))}
                  <td className="text-xs">
                    {res?.status === "ok" && <Badge tone="green">{t("OK")}</Badge>}
                    {res?.status === "duplicate" && <Badge tone="amber">{t("Duplicate")}</Badge>}
                    {res?.errors.map((m, k) => <div key={k} className="text-expense">{t(m)}</div>)}
                    {res?.warnings.map((m, k) => <div key={k} className="text-warn">{t(m)}</div>)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {checked && errCount > 0 && <Alert tone="warning">{t("Fix the errors below, nothing is saved until every row is valid.")}</Alert>}
      {checked && dupCount > 0 && (
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeDup} onChange={(e) => setIncludeDup(e.target.checked)} /> {t("Duplicates will be saved too")} ({dupCount})</label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" size="lg" onClick={check} loading={pending} disabled={active === 0}><CheckCircle2 className="h-4 w-4" aria-hidden /> {t("Check all rows")}</Button>
        <Button type="button" size="lg" onClick={saveAll} loading={pending} disabled={!canSave}><Save className="h-4 w-4" aria-hidden /> {t("Save all")} {active > 0 && `(${active})`}</Button>
        {!checked && <span className="text-sm text-muted-foreground">{t("Nothing has been saved yet.")}</span>}
      </div>
    </div>
  );
}
