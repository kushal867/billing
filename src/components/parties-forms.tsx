"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Archive, HandCoins, Plus, Undo2 } from "lucide-react";
import { addParty, archiveParty, editParty, mergeParty, recordPartyPayment } from "@/actions/parties";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { CurrencyInput } from "@/components/currency-input";
import { DateInput } from "@/components/date-input";
import { formatDate, parseEnteredDate, todayIso, type Calendar } from "@/lib/dates";
import { useT } from "@/lib/i18n/client";
import type { ActionResult } from "@/lib/action";

type Fe = Record<string, string>;
function useAct() {
  const t = useT();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [fe, setFe] = useState<Fe>({});
  const go = (fn: () => Promise<ActionResult<unknown>>, ok: string, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { setError(""); setFe({}); toast.success(t(ok)); after?.(); } else { setError(r.error); setFe(r.fieldErrors ?? {}); toast.error(r.error); }
    });
  return { pending, error, fe, go };
}

export type PartyInit = { name: string; kind: "CUSTOMER" | "SUPPLIER"; phone: string; address: string; notes: string; openingAmount: string; openingSide: "THEY_OWE" | "WE_OWE" };
const BLANK: PartyInit = { name: "", kind: "CUSTOMER", phone: "", address: "", notes: "", openingAmount: "", openingSide: "THEY_OWE" };

export function PartyForm({ id, initial = BLANK, symbol, onDone }: { id?: string; initial?: PartyInit; symbol: string; onDone?: () => void }) {
  const t = useT();
  const router = useRouter();
  const { pending, error, fe, go } = useAct();
  const [v, setV] = useState<PartyInit>(initial);
  const set = <K extends keyof PartyInit>(k: K, val: PartyInit[K]) => setV((p) => ({ ...p, [k]: val }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (id) go(() => editParty(id, v), "Party saved", () => { router.refresh(); onDone?.(); });
    else go(async () => { const r = await addParty(v); if (r.ok) { setV(BLANK); router.push(`/parties/${r.data.id}`); } return r; }, "Party added");
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("Name")} htmlFor="p-name" error={fe.name}><Input id="p-name" value={v.name} maxLength={100} onChange={(e) => set("name", e.target.value)} autoComplete="off" invalid={!!fe.name} /></Field>
        <Field label={t("Type")} htmlFor="p-kind"><Select id="p-kind" value={v.kind} onChange={(e) => set("kind", e.target.value as PartyInit["kind"])}><option value="CUSTOMER">{t("Customer")}</option><option value="SUPPLIER">{t("Supplier")}</option></Select></Field>
        <Field label={t("Phone")} htmlFor="p-phone" error={fe.phone}><Input id="p-phone" inputMode="tel" value={v.phone} maxLength={30} onChange={(e) => set("phone", e.target.value)} autoComplete="off" /></Field>
        <Field label={t("Address")} htmlFor="p-address" error={fe.address}><Input id="p-address" value={v.address} maxLength={200} onChange={(e) => set("address", e.target.value)} autoComplete="off" /></Field>
        <Field label={t("Balance brought forward")} htmlFor="openingAmount" error={fe.openingAmount} hint={t("Optional. What was already owed before you started using KusBill.")}>
          <CurrencyInput id="openingAmount" symbol={symbol} value={v.openingAmount} onValueChange={(x) => set("openingAmount", x)} invalid={!!fe.openingAmount} />
        </Field>
        <Field label={t("Who owes it?")} htmlFor="p-side"><Select id="p-side" value={v.openingSide} onChange={(e) => set("openingSide", e.target.value as PartyInit["openingSide"])}><option value="THEY_OWE">{t("They owe me")}</option><option value="WE_OWE">{t("I owe them")}</option></Select></Field>
        <Field label={t("Notes")} htmlFor="p-notes" error={fe.notes} className="sm:col-span-2"><Input id="p-notes" value={v.notes} maxLength={500} onChange={(e) => set("notes", e.target.value)} autoComplete="off" /></Field>
      </div>
      <Button type="submit" loading={pending}><Plus className="h-4 w-4" aria-hidden /> {id ? t("Save changes") : t("Add party")}</Button>
    </form>
  );
}

export function PaymentForm({ partyId, calendar, symbol, owes }: { partyId: string; calendar: Calendar; symbol: string; owes: boolean }) {
  const t = useT();
  const router = useRouter();
  const { pending, error, fe, go } = useAct();
  const [direction, setDirection] = useState<"RECEIVED" | "PAID">(owes ? "RECEIVED" : "PAID");
  const [amount, setAmount] = useState("");
  const [dateText, setDateText] = useState(formatDate(todayIso(), calendar));
  const [cal, setCal] = useState<Calendar>(calendar);
  const [bill, setBill] = useState("");
  const [note, setNote] = useState("");
  const token = useRef(crypto.randomUUID());
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!parseEnteredDate(dateText, cal).ok) { toast.error(t("Enter the date")); return; }
    go(() => recordPartyPayment(partyId, { dateText, calendar: cal, amount: amount.replace(/,/g, ""), billNumber: bill, note, direction, clientToken: token.current }), "Payment recorded", () => {
      token.current = crypto.randomUUID(); setAmount(""); setBill(""); setNote(""); router.refresh();
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label={t("Type")} htmlFor="pay-dir"><Select id="pay-dir" value={direction} onChange={(e) => setDirection(e.target.value as "RECEIVED" | "PAID")}><option value="RECEIVED">{t("Payment received from them")}</option><option value="PAID">{t("Payment made to them")}</option></Select></Field>
        <Field label={t("Amount")} htmlFor="pay-amount" error={fe.amount ?? fe.credit ?? fe.debit}><CurrencyInput id="pay-amount" symbol={symbol} value={amount} onValueChange={setAmount} invalid={!!(fe.amount ?? fe.credit ?? fe.debit)} /></Field>
        <Field label={t("Date")} htmlFor="pay-date" error={fe.dateText}><DateInput id="pay-date" value={dateText} calendar={cal} onChange={setDateText} onCalendarChange={setCal} invalid={!!fe.dateText} /></Field>
        <Field label={t("Receipt or bill number")} htmlFor="pay-bill" hint={t("Optional. Use the bill this payment settles.")}><Input id="pay-bill" value={bill} maxLength={40} onChange={(e) => setBill(e.target.value)} autoComplete="off" /></Field>
        <Field label={t("Note")} htmlFor="pay-note" className="sm:col-span-2"><Input id="pay-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} autoComplete="off" /></Field>
      </div>
      <Button type="submit" loading={pending}><HandCoins className="h-4 w-4" aria-hidden /> {t("Record payment")}</Button>
    </form>
  );
}

export function PartyAdmin({ id, name, isActive, others }: { id: string; name: string; isActive: boolean; others: Array<{ id: string; name: string }> }) {
  const t = useT();
  const router = useRouter();
  const { pending, error, go } = useAct();
  const [target, setTarget] = useState("");
  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" loading={pending} onClick={() => go(() => archiveParty(id, !isActive), isActive ? "Party hidden" : "Party restored", () => router.refresh())}>
          {isActive ? <><Archive className="h-4 w-4" aria-hidden /> {t("Hide this party")}</> : <><Undo2 className="h-4 w-4" aria-hidden /> {t("Show this party again")}</>}
        </Button>
        <span className="text-xs text-muted-foreground">{t("Hidden parties keep all their entries. Only fully settled parties can be hidden.")}</span>
      </div>
      {others.length > 0 && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm font-medium">{t("Same person typed two ways?")}</p>
          <p className="text-xs text-muted-foreground">{t("Move every entry of {name} into another party, then remove {name}.", { name })}</p>
          <div className="flex flex-wrap gap-2">
            <Select aria-label={t("Merge into")} value={target} onChange={(e) => setTarget(e.target.value)} className="w-64"><option value="">{t("Choose the party to keep")}</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>
            <Button variant="outline" disabled={!target || pending} onClick={() => { if (window.confirm(t("Merge {name} into the chosen party? This cannot be undone.", { name }))) go(() => mergeParty(id, target), "Parties merged", () => router.push(`/parties/${target}`)); }}>{t("Merge")}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
