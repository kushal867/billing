"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { CheckCircle2 } from "lucide-react";
import { setupBusiness, setupOpening } from "@/actions/onboarding";
import { saveEntry } from "@/actions/entries";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { CurrencyInput } from "@/components/currency-input";
import { DateInput } from "@/components/date-input";
import { LanguageToggle } from "@/components/language-toggle";
import { validateEntryForm } from "@/lib/entry-form";
import { formatDate, type Calendar } from "@/lib/dates";
import { useT } from "@/lib/i18n/client";

type Props = {
  initial: { name: string; calendar: Calendar; fyStart: string; nextBill: string; isOwner: boolean; hasName: boolean; hasOpening: boolean; hasEntry: boolean };
};

/** Three short steps: business, opening balance, first entry. Every step can be skipped. */
export function OnboardingWizard({ initial }: Props) {
  const t = useT();
  const [pending, start] = useTransition();
  const [step, setStep] = useState(initial.hasName ? (initial.hasOpening ? 3 : 2) : 1);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [cal, setCal] = useState<Calendar>(initial.calendar);

  const [name, setName] = useState(/^My Business$|'s Business$/.test(initial.name) ? "" : initial.name);
  const [amount, setAmount] = useState("");
  const [obDate, setObDate] = useState(formatDate(initial.fyStart, initial.calendar));
  const [entry, setEntry] = useState({ date: formatDate(new Date(Date.now() + 5.75 * 3600_000).toISOString().slice(0, 10), initial.calendar), bill: initial.nextBill, debit: "", credit: "", description: "" });
  const [token] = useState(() => (typeof crypto !== "undefined" ? crypto.randomUUID() : String(Date.now())));
  const total = 3;

  const fail = (msg: string) => { setError(t(msg)); toast.error(t(msg)); };

  const saveName = () => start(async () => {
    if (!initial.isOwner || !name.trim()) { setError(""); setStep(2); return; }
    const r = await setupBusiness({ name, displayCalendar: cal });
    if (!r.ok) return fail(r.error);
    setError(""); setStep(2);
  });
  const saveOb = () => start(async () => {
    const r = await setupOpening({ amount, dateText: obDate, calendar: cal });
    if (!r.ok) return fail(r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.error);
    setError(""); setStep(3);
  });
  const saveFirst = () => start(async () => {
    const errs = validateEntryForm({ dateText: entry.date, calendar: cal, billNumber: entry.bill, debit: entry.debit, credit: entry.credit, description: entry.description, categoryId: "" }, "POSTED");
    const first = Object.values(errs)[0];
    if (first) return fail(first);
    const r = await saveEntry({ dateText: entry.date, calendar: cal, billNumber: entry.bill, debit: entry.debit, credit: entry.credit, description: entry.description, status: "POSTED", clientToken: token });
    if (!r.ok) return fail(r.fieldErrors ? Object.values(r.fieldErrors)[0] : r.error);
    if (r.data.status === "duplicate") return fail("This bill number is already used");
    toast.success(t("Entry saved"));
    setDone(true);
  });

  if (done) {
    return (
      <div className="space-y-5 text-center">
        <CheckCircle2 className="mx-auto h-12 w-12 text-income" aria-hidden />
        <h2 className="text-xl font-semibold text-navy">{t("You're all set!")}</h2>
        <div className="flex flex-wrap justify-center gap-3">
          <Button asChild size="lg"><Link href="/dashboard">{t("Go to dashboard")}</Link></Button>
          <Button asChild size="lg" variant="outline"><Link href="/entries/new">{t("Add another entry")}</Link></Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{t("Step {n} of {total}", { n: step, total })}</p>
        <LanguageToggle />
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={1} aria-valuemax={total} aria-valuenow={step}>
        <div className="h-full bg-primary transition-all" style={{ width: `${(step / total) * 100}%` }} />
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      {step === 1 && (
        <form onSubmit={(e) => { e.preventDefault(); saveName(); }} className="space-y-4">
          <h2 className="text-lg font-semibold text-navy">{t("Your business")}</h2>
          <Field label={t("What is your business called?")} htmlFor="wz-name" hint={initial.isOwner ? undefined : t("Only the owner can change this.")}>
            <Input id="wz-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} disabled={!initial.isOwner} placeholder={t("Business name")} />
          </Field>
          <Field label={t("Show dates in")} htmlFor="wz-cal">
            <Select id="wz-cal" value={cal} onChange={(e) => setCal(e.target.value as Calendar)} disabled={!initial.isOwner}>
              <option value="BS">{t("Bikram Sambat (BS)")}</option><option value="AD">{t("Gregorian (AD)")}</option>
            </Select>
          </Field>
          <div className="flex gap-3"><Button type="submit" size="lg" loading={pending}>{t("Next step")}</Button><Button type="button" variant="ghost" size="lg" onClick={() => setStep(2)}>{t("Skip for now")}</Button></div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={(e) => { e.preventDefault(); saveOb(); }} className="space-y-4">
          <h2 className="text-lg font-semibold text-navy">{t("Opening balance (from your billpad)")}</h2>
          <p className="text-sm text-muted-foreground">{t("Look at the first page of your billpad. Is there a balance brought forward? Type it here. If you are starting fresh, leave it as 0.")}</p>
          <Field label={t("Opening balance (Rs.)")} htmlFor="wz-amount">
            <CurrencyInput id="wz-amount" autoFocus value={amount} onValueChange={setAmount} />
          </Field>
          <Field label={t("Balance as of date")} htmlFor="wz-obdate">
            <DateInput id="wz-obdate" value={obDate} calendar={cal} onChange={setObDate} onCalendarChange={setCal} />
          </Field>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" size="lg" onClick={() => setStep(1)}>{t("Back")}</Button>
            <Button type="submit" size="lg" loading={pending}>{t("Next step")}</Button>
            <Button type="button" variant="ghost" size="lg" onClick={() => setStep(3)}>{t("Skip for now")}</Button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={(e) => { e.preventDefault(); saveFirst(); }} className="space-y-4">
          <h2 className="text-lg font-semibold text-navy">{t("Your first entry")}</h2>
          <p className="text-sm text-muted-foreground">{t("Type one bill from your billpad to see how it works. You can change or delete it later.")}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Date")} htmlFor="wz-date"><DateInput id="wz-date" value={entry.date} calendar={cal} onChange={(v) => setEntry({ ...entry, date: v })} onCalendarChange={setCal} /></Field>
            <Field label={t("Bill Number")} htmlFor="wz-bill"><Input id="wz-bill" className="num text-lg" value={entry.bill} onChange={(e) => setEntry({ ...entry, bill: e.target.value })} /></Field>
            <Field label={t("Debit")} htmlFor="wz-debit"><CurrencyInput id="wz-debit" value={entry.debit} onValueChange={(v) => setEntry({ ...entry, debit: v })} /></Field>
            <Field label={t("Credit")} htmlFor="wz-credit"><CurrencyInput id="wz-credit" value={entry.credit} onValueChange={(v) => setEntry({ ...entry, credit: v })} /></Field>
            <Field label={t("Description / Notes")} htmlFor="wz-desc" className="sm:col-span-2"><Input id="wz-desc" value={entry.description} onChange={(e) => setEntry({ ...entry, description: e.target.value })} placeholder={t("Optional - e.g. customer or item name")} /></Field>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" size="lg" onClick={() => setStep(2)}>{t("Back")}</Button>
            <Button type="submit" size="lg" loading={pending}>{t("Save and finish")}</Button>
            <Button type="button" variant="ghost" size="lg" onClick={() => setDone(true)}>{t("Finish without an entry")}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
