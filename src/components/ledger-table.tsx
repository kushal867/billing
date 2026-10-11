"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, ArrowUpDown, Columns3, Pencil, Plus } from "lucide-react";
import { saveEntry, updateEntry, voidEntry } from "@/actions/entries";
import { Amt } from "@/components/amount";
import { ConfirmAction } from "@/components/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { formatDate, parseEnteredDate, type Calendar } from "@/lib/dates";
import { formatAmount, type Grouping } from "@/lib/format";
import { cn } from "@/lib/utils";

export type TableRow = {
  id: string; version: number; date: string; billNumber: string; debit: string; credit: string; balance: string | null;
  description: string; categoryId: string | null; categoryName: string | null; status: "DRAFT" | "POSTED" | "VOID";
  createdByName: string | null; updatedByName: string | null; updatedAt: string;
  flags: { duplicateBill: boolean; large: boolean; future: boolean; reversal: boolean };
};
type Field = "date" | "bill" | "description" | "debit" | "credit" | "category";
type SortKey = "date" | "bill" | "debit" | "credit" | "balance";
const COLS_KEY = "kusbill:ledgerCols";
const zero = (v: string) => !v || Number(v) === 0;

export function LedgerTable({
  rows, calendar, grouping, canWrite, categories, nextBill, sort, dir, sortHrefs, totals, quickAdd,
}: {
  rows: TableRow[]; calendar: Calendar; grouping: Grouping; canWrite: boolean; categories: Array<{ id: string; name: string }>;
  nextBill: string; sort: string; dir: string; sortHrefs: Record<SortKey, string>; totals: { count: number; debit: string; credit: string }; quickAdd: boolean;
}) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [editing, setEditing] = useState<{ id: string; field: Field } | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [hidden, setHidden] = useState<string[]>([]);
  const [menu, setMenu] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);

  useEffect(() => { try { setHidden(JSON.parse(localStorage.getItem(COLS_KEY) ?? "[]")); } catch { /* ignore */ } }, []);
  const toggleCol = (c: string) => setHidden((h) => { const n = h.includes(c) ? h.filter((x) => x !== c) : [...h, c]; try { localStorage.setItem(COLS_KEY, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const show = (c: string) => !hidden.includes(c);
  const refresh = () => startRefresh(() => router.refresh());

  const editable = (r: TableRow) => canWrite && r.status === "POSTED" && !r.flags.reversal;
  const initial = (r: TableRow, f: Field) =>
    f === "date" ? formatDate(r.date, calendar) : f === "bill" ? r.billNumber : f === "description" ? r.description : f === "category" ? r.categoryId ?? "" : f === "debit" ? (zero(r.debit) ? "" : r.debit) : zero(r.credit) ? "" : r.credit;

  const begin = (r: TableRow, f: Field) => { if (!editable(r)) return; setEditing({ id: r.id, field: f }); setDraft(initial(r, f)); };
  const cancel = () => setEditing(null);

  const commit = useCallback(async (r: TableRow, f: Field, value: string, allowDuplicate = false) => {
    if (value === initial(r, f)) return setEditing(null);
    const payload = {
      dateText: f === "date" ? value : formatDate(r.date, calendar), calendar,
      billNumber: f === "bill" ? value : r.billNumber,
      debit: f === "debit" ? value : f === "credit" && value ? "" : zero(r.debit) ? "" : r.debit,
      credit: f === "credit" ? value : f === "debit" && value ? "" : zero(r.credit) ? "" : r.credit,
      description: f === "description" ? value : r.description,
      categoryId: f === "category" ? value : r.categoryId ?? "",
      status: "POSTED", allowDuplicate,
    };
    setSaving(true);
    const res = await updateEntry(r.id, r.version, payload);
    setSaving(false);
    if (!res.ok) { toast.error(res.fieldErrors ? Object.values(res.fieldErrors)[0] : res.error); return; } // stay in edit mode, value kept
    if (res.data.status === "duplicate") {
      toast.warning(res.data.duplicates.exact.length ? "An identical entry already exists" : `Bill number ${payload.billNumber} is already used`, {
        duration: 10000, action: { label: "Save anyway", onClick: () => void commit(r, f, value, true) },
      });
      return;
    }
    setEditing(null);
    if ((f === "debit" && value && !zero(r.credit)) || (f === "credit" && value && !zero(r.debit))) toast.info(`Moved to ${f === "debit" ? "Debit" : "Credit"} column`);
    toast.success("Saved - balances updated");
    refresh();
  }, [calendar]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (e: React.KeyboardEvent<HTMLElement>, col: string) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const cells = Array.from(tableRef.current?.querySelectorAll<HTMLElement>(`[data-col="${col}"]`) ?? []);
    const i = cells.indexOf(e.currentTarget);
    const next = cells[i + (e.key === "ArrowDown" ? 1 : -1)];
    if (next) { e.preventDefault(); next.focus(); }
  };

  const cell = (r: TableRow, f: Field, children: React.ReactNode, className?: string, colName = f as string) => {
    const isEditing = editing?.id === r.id && editing.field === f;
    if (isEditing) {
      const common = {
        autoFocus: true, disabled: saving, "aria-label": `Edit ${f}`,
        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void commit(r, f, draft); } if (e.key === "Escape") cancel(); },
      };
      return (
        <td className={cn("p-1", className)}>
          {f === "category" ? (
            <Select {...common} className="h-9 min-w-36" value={draft} onChange={(e) => { setDraft(e.target.value); void commit(r, f, e.target.value); }} onBlur={cancel}>
              <option value="">Not classified</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          ) : (
            <Input {...common} className={cn("h-9 min-w-24", (f === "debit" || f === "credit") && "num text-right")} inputMode={f === "debit" || f === "credit" ? "decimal" : undefined} value={draft}
              onChange={(e) => setDraft(f === "debit" || f === "credit" ? e.target.value.replace(/[^\d.,]/g, "") : e.target.value)} onBlur={() => { if (!saving) cancel(); }} />
          )}
        </td>
      );
    }
    const can = editable(r);
    return (
      <td
        className={cn(className, can && "cursor-text hover:bg-blue-50 focus:bg-blue-50 focus:outline focus:outline-2 focus:outline-primary")}
        tabIndex={can ? 0 : undefined} data-col={colName} title={can ? "Double-click or press Enter to edit" : undefined}
        onDoubleClick={() => begin(r, f)}
        onKeyDown={can ? (e) => { if (e.key === "Enter") { e.preventDefault(); begin(r, f); } else move(e, colName); } : undefined}
      >
        {children}
      </td>
    );
  };

  const SortTh = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => {
    const Icon = sort === k ? (dir === "asc" ? ArrowUp : ArrowDown) : ArrowUpDown;
    return <th className={right ? "text-right" : undefined} aria-sort={sort === k ? (dir === "asc" ? "ascending" : "descending") : "none"}><Link href={sortHrefs[k]} className="inline-flex items-center gap-1 hover:text-foreground">{label}<Icon className="h-3 w-3 no-print" aria-hidden /></Link></th>;
  };

  return (
    <div>
      <div className="no-print flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-xs text-muted-foreground">{canWrite ? "Tip: double-click (or press Enter on) a cell to edit it. Enter saves, Esc cancels, arrow keys move." : "Read-only view."}</p>
        <div className="relative">
          <Button variant="outline" size="sm" onClick={() => setMenu((m) => !m)} aria-expanded={menu}><Columns3 className="h-4 w-4" aria-hidden /> Columns</Button>
          {menu && (
            <div className="absolute right-0 z-20 mt-1 w-48 space-y-1 rounded-md border bg-white p-2 shadow-lg">
              {[["description", "Description"], ["category", "Category & flags"], ["meta", "Who changed it"]].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"><input type="checkbox" checked={show(k)} onChange={() => toggleCol(k)} /> {l}</label>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="tbl" ref={tableRef}>
          <thead>
            <tr>
              <SortTh k="date" label="Date" /><SortTh k="bill" label="Bill No." />
              {show("description") && <th>Description</th>}
              <SortTh k="debit" label="Debit" right /><SortTh k="credit" label="Credit" right /><SortTh k="balance" label="Balance" right />
              <th className="no-print"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {quickAdd && <QuickAddRow calendar={calendar} nextBill={nextBill} showDesc={show("description")} onSaved={refresh} />}
            {rows.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-sm text-muted-foreground">No entries match these filters. Use the blue row above to add one.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className={r.status === "VOID" ? "bg-red-50/50 text-muted-foreground line-through" : r.flags.duplicateBill ? "bg-amber-50/60" : undefined}>
                {cell(r, "date", formatDate(r.date, calendar), "whitespace-nowrap num")}
                {cell(r, "bill", r.billNumber || "-", "whitespace-nowrap font-medium num")}
                {show("description") && (
                  <td className="max-w-[22rem]" data-col={editable(r) ? undefined : "description"}>
                    {editing?.id === r.id && editing.field === "description" ? (
                      <Input autoFocus disabled={saving} aria-label="Edit description" className="h-9" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => { if (!saving) cancel(); }}
                        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void commit(r, "description", draft); } if (e.key === "Escape") cancel(); }} />
                    ) : (
                      <div tabIndex={editable(r) ? 0 : undefined} data-col="description" title={editable(r) ? "Double-click or press Enter to edit" : undefined}
                        className={cn("break-words rounded", editable(r) && "cursor-text hover:bg-blue-50 focus:bg-blue-50 focus:outline focus:outline-2 focus:outline-primary")}
                        onDoubleClick={() => begin(r, "description")} onKeyDown={editable(r) ? (e) => { if (e.key === "Enter") { e.preventDefault(); begin(r, "description"); } else move(e, "description"); } : undefined}>
                        {r.description || <span className="text-muted-foreground">-</span>}
                      </div>
                    )}
                    {show("category") && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 no-underline">
                        {editing?.id === r.id && editing.field === "category" ? (
                          <Select autoFocus aria-label="Edit category" className="h-8 w-44 text-sm" value={draft} onChange={(e) => { setDraft(e.target.value); void commit(r, "category", e.target.value); }} onBlur={cancel}>
                            <option value="">Not classified</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </Select>
                        ) : (
                          <button type="button" disabled={!editable(r)} onClick={() => begin(r, "category")} className="rounded focus:outline focus:outline-2 focus:outline-primary" aria-label={`Category: ${r.categoryName ?? "none"}. Click to change`}>
                            {r.categoryName ? <Badge tone="blue">{r.categoryName}</Badge> : editable(r) ? <Badge className="border border-dashed bg-white text-muted-foreground">+ category</Badge> : null}
                          </button>
                        )}
                        {r.status === "DRAFT" && <Badge tone="amber">Draft</Badge>}
                        {r.flags.duplicateBill && <Badge tone="amber">Duplicate bill no.</Badge>}
                        {r.flags.large && <Badge tone="amber">Unusually large</Badge>}
                        {r.flags.future && <Badge tone="amber">Future date</Badge>}
                        {r.flags.reversal && <Badge tone="blue">Reversal</Badge>}
                      </div>
                    )}
                    {show("meta") && <div className="text-[11px] text-muted-foreground print:hidden">{r.createdByName ? `by ${r.createdByName}` : ""}{r.updatedByName ? ` · edited by ${r.updatedByName} ${r.updatedAt.slice(0, 10)}` : ""}</div>}
                  </td>
                )}
                {cell(r, "debit", <Amt v={r.debit} grouping={grouping} blankZero />, "r")}
                {cell(r, "credit", <Amt v={r.credit} grouping={grouping} blankZero />, "r")}
                <td className="r font-medium">{r.balance ? <Amt v={r.balance} grouping={grouping} /> : <span className="text-muted-foreground">-</span>}</td>
                <td className="no-print whitespace-nowrap text-right">
                  <Button asChild variant="ghost" size="sm"><Link href={`/entries/${r.id}`} aria-label={`${editable(r) ? "Open" : "View"} bill ${r.billNumber}`}><Pencil className="h-3.5 w-3.5" aria-hidden />{editable(r) ? "Open" : "View"}</Link></Button>
                  {editable(r) && (
                    <ConfirmAction
                      trigger={<Button variant="ghost" size="sm" className="text-expense" aria-label={`Delete bill ${r.billNumber}`}>Delete</Button>}
                      title={`Delete bill ${r.billNumber}?`} description="It will be removed from balances and reports. The deletion and your reason are kept in the history."
                      confirmLabel="Delete entry" requireReason onConfirm={(reason) => voidEntry(r.id, reason)} onDone={() => { toast.success("Entry deleted"); refresh(); }}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-muted/60 font-semibold">
              <td className="px-3 py-2" colSpan={show("description") ? 3 : 2}>Total of {totals.count} entr{totals.count === 1 ? "y" : "ies"} matching filters</td>
              <td className="r px-3 py-2">{formatAmount(totals.debit, grouping)}</td>
              <td className="r px-3 py-2">{formatAmount(totals.credit, grouping)}</td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Add an entry without leaving the ledger. Enter in any field saves; focus returns to Bill No. */
function QuickAddRow({ calendar, nextBill, showDesc, onSaved }: { calendar: Calendar; nextBill: string; showDesc: boolean; onSaved: () => void }) {
  const [v, setV] = useState({ date: "", bill: nextBill, debit: "", credit: "", description: "" });
  const [busy, setBusy] = useState(false);
  const token = useRef("");
  const billRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    token.current = crypto.randomUUID();
    try {
      const saved = JSON.parse(localStorage.getItem("kusbill:workDate") ?? "null") as { dateText: string; calendar: Calendar } | null;
      if (saved && saved.calendar === calendar && parseEnteredDate(saved.dateText, calendar).ok) { setV((x) => ({ ...x, date: saved.dateText })); return; }
    } catch { /* ignore */ }
    setV((x) => ({ ...x, date: formatDate(new Date(Date.now() + 5.75 * 3600_000).toISOString().slice(0, 10), calendar) }));
  }, [calendar]);
  useEffect(() => { setV((x) => (x.bill === "" ? { ...x, bill: nextBill } : x)); }, [nextBill]);

  const submit = async (allowDuplicate = false) => {
    setBusy(true);
    const res = await saveEntry({ dateText: v.date, calendar, billNumber: v.bill, debit: v.debit, credit: v.credit, description: v.description, status: "POSTED", clientToken: token.current, allowDuplicate });
    setBusy(false);
    if (!res.ok) { toast.error(res.fieldErrors ? Object.values(res.fieldErrors)[0] : res.error); return; }
    if (res.data.status === "duplicate") {
      toast.warning(res.data.duplicates.exact.length ? "An identical entry already exists" : `Bill number ${v.bill} is already used`, { duration: 10000, action: { label: "Save anyway", onClick: () => void submit(true) } });
      return;
    }
    try { localStorage.setItem("kusbill:workDate", JSON.stringify({ dateText: v.date, calendar })); } catch { /* ignore */ }
    toast.success(`Entry saved - bill ${res.data.billNumber}`);
    token.current = crypto.randomUUID();
    setV((x) => ({ ...x, bill: res.data.status === "saved" ? res.data.nextBill : "", debit: "", credit: "", description: "" }));
    onSaved();
    // Inputs are re-enabled on the next render; focus after that.
    setTimeout(() => { billRef.current?.focus(); billRef.current?.select(); }, 60);
  };
  const key = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } };
  const amt = (s: string) => s.replace(/[^\d.,]/g, "");

  return (
    <tr className="no-print bg-blue-50/60">
      <td className="p-1"><Input aria-label="New entry date" className="h-9 num" value={v.date} onChange={(e) => setV({ ...v, date: e.target.value })} onKeyDown={key} disabled={busy} /></td>
      <td className="p-1"><Input ref={billRef} aria-label="New entry bill number" className="h-9 num" value={v.bill} onChange={(e) => setV({ ...v, bill: e.target.value })} onKeyDown={key} onFocus={(e) => e.currentTarget.select()} disabled={busy} /></td>
      {showDesc && <td className="p-1"><Input aria-label="New entry description" className="h-9" placeholder="Description (optional)" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} onKeyDown={key} disabled={busy} /></td>}
      <td className="p-1"><Input aria-label="New entry debit" className="h-9 num text-right" inputMode="decimal" placeholder="Debit" value={v.debit} onChange={(e) => setV({ ...v, debit: amt(e.target.value) })} onKeyDown={key} disabled={busy} /></td>
      <td className="p-1"><Input aria-label="New entry credit" className="h-9 num text-right" inputMode="decimal" placeholder="Credit" value={v.credit} onChange={(e) => setV({ ...v, credit: amt(e.target.value) })} onKeyDown={key} disabled={busy} /></td>
      <td className="px-3 text-right text-xs text-muted-foreground">new</td>
      <td className="p-1 text-right"><Button size="sm" loading={busy} onClick={() => void submit()} aria-label="Add entry"><Plus className="h-4 w-4" aria-hidden /> Add</Button></td>
    </tr>
  );
}
