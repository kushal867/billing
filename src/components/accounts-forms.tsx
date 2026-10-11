"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { addAccount, addCategory, chooseSettlement, postJournal, removeJournal, toggleAccount } from "@/actions/accounts";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { DateInput } from "@/components/date-input";
import { ConfirmAction } from "@/components/confirm-action";
import { formatDate, parseEnteredDate, todayIso, type Calendar } from "@/lib/dates";
import { formatAmount } from "@/lib/format";
import type { ActionResult } from "@/lib/action";

export type AcctOpt = { id: string; code: string; name: string; type: string; isActive: boolean };

function useAct() {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const go = (fn: () => Promise<ActionResult<unknown>>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { setError(""); toast.success(ok); after?.(); } else { setError(r.error); toast.error(r.error); }
    });
  return { pending, error, go };
}

export function SettlementPicker({ accounts, current, readOnly }: { accounts: AcctOpt[]; current: string | null; readOnly: boolean }) {
  const { pending, go } = useAct();
  return (
    <Field label="Cash / bank account used for classified entries" htmlFor="settle" hint="Income entries debit this account; expense entries credit it.">
      <Select id="settle" value={current ?? ""} disabled={readOnly || pending} onChange={(e) => go(() => chooseSettlement(e.target.value), "Settlement account updated")}>
        {!current && <option value="">Choose...</option>}
        {accounts.filter((a) => a.type === "ASSET" && a.isActive).map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
      </Select>
    </Field>
  );
}

export function AccountActiveToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const { pending, go } = useAct();
  return <Button size="sm" variant="outline" loading={pending} onClick={() => go(() => toggleAccount(id, !isActive), isActive ? "Account deactivated" : "Account activated")}>{isActive ? "Deactivate" : "Activate"}</Button>;
}

export function AddAccountForm() {
  const { pending, error, go } = useAct();
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const v = Object.fromEntries(new FormData(f)); go(() => addAccount(v), "Account added", () => f.reset()); }} className="grid gap-3 sm:grid-cols-[8rem_1fr_10rem_auto] sm:items-end">
      <Field label="Code" htmlFor="ac-code"><Input id="ac-code" name="code" required /></Field>
      <Field label="Account name" htmlFor="ac-name"><Input id="ac-name" name="name" required /></Field>
      <Field label="Type" htmlFor="ac-type"><Select id="ac-type" name="type" defaultValue="EXPENSE"><option value="ASSET">Asset</option><option value="LIABILITY">Liability</option><option value="EQUITY">Equity</option><option value="INCOME">Income</option><option value="EXPENSE">Expense</option></Select></Field>
      <Button type="submit" variant="outline" loading={pending}>Add account</Button>
      {error && <p role="alert" className="text-sm text-expense sm:col-span-4">{error}</p>}
    </form>
  );
}

export function AddCategoryForm({ accounts }: { accounts: AcctOpt[] }) {
  const { pending, error, go } = useAct();
  const [kind, setKind] = useState<"INCOME" | "EXPENSE">("EXPENSE");
  return (
    <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const v = Object.fromEntries(new FormData(f)); go(() => addCategory({ ...v, kind }), "Category added", () => f.reset()); }} className="grid gap-3 sm:grid-cols-[1fr_9rem_1fr_auto] sm:items-end">
      <Field label="Category name" htmlFor="cat-name"><Input id="cat-name" name="name" required /></Field>
      <Field label="Counts as" htmlFor="cat-kind"><Select id="cat-kind" value={kind} onChange={(e) => setKind(e.target.value as "INCOME" | "EXPENSE")}><option value="INCOME">Income</option><option value="EXPENSE">Expense</option></Select></Field>
      <Field label="Account" htmlFor="cat-acct"><Select id="cat-acct" name="accountId" key={kind} required>{accounts.filter((a) => a.type === kind && a.isActive).map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}</Select></Field>
      <Button type="submit" variant="outline" loading={pending}>Add category</Button>
      {error && <p role="alert" className="text-sm text-expense sm:col-span-4">{error}</p>}
    </form>
  );
}

type Line = { accountId: string; debit: string; credit: string };
const AMT = /^\d{1,13}(\.\d{1,2})?$/;
const num = (s: string) => (AMT.test(s.replace(/,/g, "").trim()) ? Number(s.replace(/,/g, "")) : 0);

export function JournalForm({ accounts, calendar, grouping }: { accounts: AcctOpt[]; calendar: Calendar; grouping: "INTERNATIONAL" | "INDIAN" }) {
  const { pending, error, go } = useAct();
  const [cal, setCal] = useState<Calendar>(calendar);
  const [date, setDate] = useState(formatDate(todayIso(), calendar));
  const [memo, setMemo] = useState("");
  const [ref, setRef] = useState("");
  const blank = (): Line => ({ accountId: "", debit: "", credit: "" });
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const active = accounts.filter((a) => a.isActive);

  const dr = lines.reduce((a, l) => a + num(l.debit), 0);
  const cr = lines.reduce((a, l) => a + num(l.credit), 0);
  const diff = Math.round((dr - cr) * 100) / 100;
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ready = diff === 0 && dr > 0 && lines.every((l) => l.accountId);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!parseEnteredDate(date, cal).ok) return toast.error("Enter a valid date");
        go(() => postJournal({ date, calendar: cal, memo, reference: ref, lines }), "Journal entry posted", () => { setMemo(""); setRef(""); setLines([blank(), blank()]); });
      }}
      className="space-y-4"
    >
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Date" htmlFor="j-date"><DateInput id="j-date" value={date} calendar={cal} onChange={setDate} onCalendarChange={setCal} /></Field>
        <Field label="Description" htmlFor="j-memo"><Input id="j-memo" value={memo} onChange={(e) => setMemo(e.target.value)} required /></Field>
        <Field label="Reference (optional)" htmlFor="j-ref"><Input id="j-ref" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
      </div>
      <div className="space-y-2">
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_7rem_auto] items-center gap-2">
            <Select aria-label={`Line ${i + 1} account`} value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })}>
              <option value="">Choose account...</option>{active.map((a) => <option key={a.id} value={a.id}>{a.code} - {a.name}</option>)}
            </Select>
            <Input aria-label={`Line ${i + 1} debit`} inputMode="decimal" placeholder="Debit" className="num text-right" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} />
            <Input aria-label={`Line ${i + 1} credit`} inputMode="decimal" placeholder="Credit" className="num text-right" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove line ${i + 1}`} disabled={lines.length <= 2} onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        ))}
        <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, blank()])}><Plus className="h-4 w-4" /> Add line</Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-muted p-3 text-sm">
        <span className="num">Total debit {formatAmount(dr.toFixed(2), grouping)} · Total credit {formatAmount(cr.toFixed(2), grouping)}</span>
        <span className={diff === 0 && dr > 0 ? "font-medium text-income" : "font-medium text-expense"}>{diff === 0 && dr > 0 ? "Balanced" : `Out of balance by ${formatAmount(Math.abs(diff).toFixed(2), grouping)}`}</span>
      </div>
      <Button type="submit" loading={pending} disabled={!ready}>Post journal entry</Button>
    </form>
  );
}

export function DeleteJournalButton({ id }: { id: string }) {
  return (
    <ConfirmAction
      trigger={<Button variant="ghost" size="sm" aria-label="Delete journal entry"><Trash2 className="h-4 w-4" /></Button>}
      title="Delete this journal entry?" description="This removes it from the trial balance and profit & loss. The deletion is recorded in the history."
      confirmLabel="Delete" onConfirm={() => removeJournal(id)} onDone={() => toast.success("Journal entry deleted")}
    />
  );
}
