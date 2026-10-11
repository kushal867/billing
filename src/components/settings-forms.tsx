"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { addFinancialYear, addUser, saveConvention, saveMyName, saveOpening, savePassword, savePreferences, saveProfile, setUserAccess } from "@/actions/settings";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { DateInput } from "@/components/date-input";
import { ConfirmAction } from "@/components/confirm-action";
import { Badge } from "@/components/ui/badge";
import { formatDate, parseEnteredDate, type Calendar } from "@/lib/dates";
import type { ActionResult } from "@/lib/action";

type Errors = Record<string, string>;

function useSubmit() {
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const submit = (fn: () => Promise<ActionResult<unknown>>, success: string, after?: () => void) =>
    start(async () => {
      const res = await fn();
      if (res.ok) {
        setErrors({}); setFormError("");
        toast.success(success);
        after?.();
      } else {
        setErrors(res.fieldErrors ?? {});
        setFormError(res.error);
        toast.error(res.error);
      }
    });
  return { pending, errors, formError, submit };
}

const fd = (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  return Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<string, string>;
};

export function ProfileForm({ biz, readOnly }: { biz: Record<"name" | "address" | "phone" | "email" | "panNumber" | "currency" | "currencySymbol" | "reportHeader" | "reportFooter", string>; readOnly: boolean }) {
  const { pending, errors, formError, submit } = useSubmit();
  return (
    <form onSubmit={(e) => { const v = fd(e); submit(() => saveProfile(v), "Business details saved"); }} className="grid gap-4 sm:grid-cols-2">
      {formError && <Alert tone="error" className="sm:col-span-2">{formError}</Alert>}
      <Field label="Business name" htmlFor="name" error={errors.name}><Input id="name" name="name" defaultValue={biz.name} disabled={readOnly} required /></Field>
      <Field label="PAN / VAT number" htmlFor="panNumber"><Input id="panNumber" name="panNumber" defaultValue={biz.panNumber} disabled={readOnly} /></Field>
      <Field label="Address" htmlFor="address" className="sm:col-span-2"><Input id="address" name="address" defaultValue={biz.address} disabled={readOnly} /></Field>
      <Field label="Phone" htmlFor="phone"><Input id="phone" name="phone" defaultValue={biz.phone} disabled={readOnly} /></Field>
      <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" defaultValue={biz.email} disabled={readOnly} /></Field>
      <Field label="Currency code" htmlFor="currency"><Input id="currency" name="currency" defaultValue={biz.currency} disabled={readOnly} /></Field>
      <Field label="Currency symbol" htmlFor="currencySymbol"><Input id="currencySymbol" name="currencySymbol" defaultValue={biz.currencySymbol} disabled={readOnly} /></Field>
      <Field label="Report header line" htmlFor="reportHeader" hint="Printed under the business name on reports" className="sm:col-span-2"><Input id="reportHeader" name="reportHeader" defaultValue={biz.reportHeader} disabled={readOnly} /></Field>
      <Field label="Report footer line" htmlFor="reportFooter" className="sm:col-span-2"><Input id="reportFooter" name="reportFooter" defaultValue={biz.reportFooter} disabled={readOnly} /></Field>
      {!readOnly && <div className="sm:col-span-2"><Button type="submit" loading={pending}>Save business details</Button></div>}
    </form>
  );
}

const MONTHS_BS = ["Baisakh", "Jestha", "Asar", "Shrawan", "Bhadra", "Aswin", "Kartik", "Mangsir", "Poush", "Magh", "Falgun", "Chaitra"];
const MONTHS_AD = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function PreferencesForm({ biz, readOnly }: { biz: { displayCalendar: Calendar; numberGrouping: string; fyCalendar: Calendar; fyStartMonth: number; fyStartDay: number; defaultSortField: string; defaultSortDir: string }; readOnly: boolean }) {
  const { pending, errors, formError, submit } = useSubmit();
  const [fyCal, setFyCal] = useState<Calendar>(biz.fyCalendar);
  return (
    <form onSubmit={(e) => { const v = fd(e); submit(() => savePreferences(v), "Preferences saved"); }} className="grid gap-4 sm:grid-cols-2">
      {formError && <Alert tone="error" className="sm:col-span-2">{formError}</Alert>}
      <Field label="Show dates in" htmlFor="displayCalendar" hint="Dates you type are always kept exactly as entered">
        <Select id="displayCalendar" name="displayCalendar" defaultValue={biz.displayCalendar} disabled={readOnly}><option value="BS">Bikram Sambat (BS)</option><option value="AD">Gregorian (AD)</option></Select>
      </Field>
      <Field label="Number format" htmlFor="numberGrouping">
        <Select id="numberGrouping" name="numberGrouping" defaultValue={biz.numberGrouping} disabled={readOnly}><option value="INTERNATIONAL">1,234,567.00</option><option value="INDIAN">12,34,567.00 (lakh / crore)</option></Select>
      </Field>
      <Field label="Financial year follows" htmlFor="fyCalendar">
        <Select id="fyCalendar" name="fyCalendar" value={fyCal} onChange={(e) => setFyCal(e.target.value as Calendar)} disabled={readOnly}><option value="BS">BS calendar</option><option value="AD">AD calendar</option></Select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Starts in month" htmlFor="fyStartMonth" error={errors.fyStartMonth}>
          <Select id="fyStartMonth" name="fyStartMonth" defaultValue={biz.fyStartMonth} key={fyCal} disabled={readOnly}>{(fyCal === "BS" ? MONTHS_BS : MONTHS_AD).map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</Select>
        </Field>
        <Field label="Day" htmlFor="fyStartDay"><Input id="fyStartDay" name="fyStartDay" type="number" min={1} max={32} defaultValue={biz.fyStartDay} disabled={readOnly} /></Field>
      </div>
      <Field label="Default ledger sort" htmlFor="defaultSortField">
        <Select id="defaultSortField" name="defaultSortField" defaultValue={biz.defaultSortField} disabled={readOnly}><option value="date">Date</option><option value="bill">Bill number</option><option value="debit">Debit</option><option value="credit">Credit</option><option value="balance">Balance</option></Select>
      </Field>
      <Field label="Direction" htmlFor="defaultSortDir">
        <Select id="defaultSortDir" name="defaultSortDir" defaultValue={biz.defaultSortDir} disabled={readOnly}><option value="asc">Oldest first</option><option value="desc">Newest first</option></Select>
      </Field>
      <p className="text-xs text-muted-foreground sm:col-span-2">Financial-year settings apply to years you add from now on. Existing years keep their dates. Nepal&apos;s standard year starts on Shrawan 1 (BS).</p>
      {!readOnly && <div className="sm:col-span-2"><Button type="submit" loading={pending}>Save preferences</Button></div>}
    </form>
  );
}

export function ConventionForm({ current, entries, readOnly }: { current: "DEBIT_PLUS" | "CREDIT_PLUS"; entries: number; readOnly: boolean }) {
  const { pending, formError, submit } = useSubmit();
  const [next, setNext] = useState(current);
  const [confirm, setConfirm] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(() => saveConvention(next, confirm), "Balance rule updated", () => setConfirm(false)); }} className="space-y-4">
      {formError && <Alert tone="error">{formError}</Alert>}
      <fieldset className="space-y-2" disabled={readOnly}>
        <legend className="sr-only">Balance rule</legend>
        {([
          ["DEBIT_PLUS", "Balance = Previous Balance + Debit - Credit", "Matches the billpad. Recommended."],
          ["CREDIT_PLUS", "Balance = Previous Balance + Credit - Debit", "Use only if your billpad adds credits to the balance."],
        ] as const).map(([v, label, hint]) => (
          <label key={v} className="flex cursor-pointer items-start gap-3 rounded-md border p-3 has-[:checked]:border-primary has-[:checked]:bg-blue-50">
            <input type="radio" name="convention" className="mt-1" checked={next === v} onChange={() => setNext(v)} />
            <span><span className="block font-medium">{label}</span><span className="text-sm text-muted-foreground">{hint}</span></span>
          </label>
        ))}
      </fieldset>
      {next !== current && entries > 0 && (
        <Alert tone="warning" title="This changes every balance you see">
          <p>Amounts you entered are never modified, but the Balance shown on all {entries} saved entries and in every report will be recalculated with the new rule. Opening balances are read under the new rule too.</p>
          <label className="mt-2 flex items-center gap-2 font-medium"><input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> I understand and want to change the rule</label>
        </Alert>
      )}
      {!readOnly && <Button type="submit" loading={pending} disabled={next === current || (entries > 0 && !confirm)}>Update balance rule</Button>}
    </form>
  );
}

export type FyRow = { id: string; label: string; start: string; end: string; opening: { amount: string; effectiveDate: string; notes: string } | null };

export function OpeningBalanceForm({ years, calendar, readOnly }: { years: FyRow[]; calendar: Calendar; readOnly: boolean }) {
  const { pending, errors, formError, submit } = useSubmit();
  const [fyId, setFyId] = useState(years[years.length - 1]?.id ?? "");
  const fy = years.find((y) => y.id === fyId);
  const [amount, setAmount] = useState(fy?.opening?.amount ?? "");
  const [cal, setCal] = useState<Calendar>(calendar);
  const [date, setDate] = useState(formatDate(fy?.opening?.effectiveDate ?? fy?.start ?? "2025-01-01", calendar));
  const [notes, setNotes] = useState(fy?.opening?.notes ?? "");

  const pick = (id: string) => {
    const y = years.find((x) => x.id === id);
    setFyId(id);
    setAmount(y?.opening?.amount ?? "");
    setDate(formatDate(y?.opening?.effectiveDate ?? y?.start ?? "", cal));
    setNotes(y?.opening?.notes ?? "");
  };

  if (!years.length) return <Alert tone="info">Add a financial year first (below), then set its opening balance here.</Alert>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const d = parseEnteredDate(date, cal);
        if (!d.ok) return toast.error(d.error);
        submit(() => saveOpening({ financialYearId: fyId, amount, effectiveDate: d.iso, notes }), "Opening balance saved");
      }}
      className="grid gap-4 sm:grid-cols-2"
    >
      {formError && <Alert tone="error" className="sm:col-span-2">{formError}</Alert>}
      <Field label="Financial year" htmlFor="ob-fy"><Select id="ob-fy" value={fyId} onChange={(e) => pick(e.target.value)} disabled={readOnly}>{years.map((y) => <option key={y.id} value={y.id}>{y.label}{y.opening ? " (set)" : ""}</option>)}</Select></Field>
      <Field label="Opening balance (Rs.)" htmlFor="ob-amount" error={errors.amount} hint="Use a minus sign for a negative balance">
        <Input id="ob-amount" className="num text-right text-lg" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,-]/g, ""))} disabled={readOnly} placeholder="0.00" />
      </Field>
      <Field label="Effective date" htmlFor="ob-date" error={errors.effectiveDate} hint="The balance is the amount immediately before this date. Entries cannot be dated earlier.">
        <DateInput id="ob-date" value={date} calendar={cal} onChange={setDate} onCalendarChange={setCal} />
      </Field>
      <Field label="Notes (optional)" htmlFor="ob-notes"><Textarea id="ob-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} disabled={readOnly} /></Field>
      <p className="text-xs text-muted-foreground sm:col-span-2">The earliest opening balance starts the ledger. For later years the balance is always carried forward from the previous year; a different figure recorded here is only shown as a difference on the Annual Report.</p>
      {!readOnly && <div className="sm:col-span-2"><Button type="submit" loading={pending}>Save opening balance</Button></div>}
    </form>
  );
}

export function AddFinancialYear({ defaultYear, calendar, readOnly }: { defaultYear: number; calendar: Calendar; readOnly: boolean }) {
  const { pending, formError, submit } = useSubmit();
  const [year, setYear] = useState(String(defaultYear));
  if (readOnly) return null;
  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(() => addFinancialYear(Number(year)), "Financial year added"); }} className="flex flex-wrap items-end gap-3">
      <Field label={`Add a year starting in (${calendar})`} htmlFor="fy-year" error={formError}><Input id="fy-year" type="number" className="w-40" value={year} onChange={(e) => setYear(e.target.value)} /></Field>
      <Button type="submit" variant="outline" loading={pending}>Add financial year</Button>
    </form>
  );
}

export function PasswordForm({ name }: { name: string }) {
  const { pending, errors, formError, submit } = useSubmit();
  const nameState = useSubmit();
  return (
    <div className="space-y-6">
      <form onSubmit={(e) => { const v = fd(e); nameState.submit(() => saveMyName(v.name), "Name updated"); }} className="flex flex-wrap items-end gap-3">
        <Field label="Your name" htmlFor="my-name" error={nameState.errors.name}><Input id="my-name" name="name" defaultValue={name} className="w-64" /></Field>
        <Button type="submit" variant="outline" loading={nameState.pending}>Save name</Button>
      </form>
      <form onSubmit={(e) => { const f = e.currentTarget; const v = fd(e); submit(() => savePassword({ current: v.current, next: v.next, confirm: v.confirm }), "Password changed. Other devices were signed out.", () => f.reset()); }} className="grid gap-4 sm:grid-cols-3">
        {formError && <Alert tone="error" className="sm:col-span-3">{formError}</Alert>}
        <Field label="Current password" htmlFor="pw-cur" error={errors.current}><Input id="pw-cur" name="current" type="password" autoComplete="current-password" required /></Field>
        <Field label="New password" htmlFor="pw-new" error={errors.password} hint="At least 8 characters with letters and numbers"><Input id="pw-new" name="next" type="password" autoComplete="new-password" required /></Field>
        <Field label="Confirm new password" htmlFor="pw-cf" error={errors.confirm}><Input id="pw-cf" name="confirm" type="password" autoComplete="new-password" required /></Field>
        <div className="sm:col-span-3"><Button type="submit" loading={pending}>Change password</Button></div>
      </form>
    </div>
  );
}

export type UserRow = { id: string; name: string; email: string; role: "OWNER" | "ACCOUNTANT" | "VIEWER"; isActive: boolean };

export function UserManager({ users, meId }: { users: UserRow[]; meId: string }) {
  const { pending, errors, formError, submit } = useSubmit();
  const [, start] = useTransition();
  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-md border">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}{u.id === meId && <Badge className="ml-2">You</Badge>}</td>
                <td>{u.email}</td>
                <td>
                  <Select aria-label={`Role for ${u.name}`} className="h-9 w-40" value={u.role} disabled={u.id === meId} onChange={(e) => start(async () => { const r = await setUserAccess(u.id, { role: e.target.value as UserRow["role"] }); if (r.ok) toast.success("Role updated"); else toast.error(r.error); })}>
                    <option value="OWNER">Owner</option><option value="ACCOUNTANT">Accountant (can edit)</option><option value="VIEWER">Viewer (read only)</option>
                  </Select>
                </td>
                <td>{u.isActive ? <Badge tone="green">Active</Badge> : <Badge tone="red">Disabled</Badge>}</td>
                <td className="text-right">
                  {u.id !== meId && (
                    <ConfirmAction
                      trigger={<Button variant="outline" size="sm">{u.isActive ? "Disable" : "Enable"}</Button>}
                      title={u.isActive ? `Disable ${u.name}?` : `Enable ${u.name}?`}
                      description={u.isActive ? "They will be signed out immediately and will not be able to sign in." : "They will be able to sign in again."}
                      confirmLabel={u.isActive ? "Disable user" : "Enable user"}
                      destructive={u.isActive}
                      onConfirm={() => setUserAccess(u.id, { isActive: !u.isActive })}
                      onDone={() => toast.success("User updated")}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={(e) => { const f = e.currentTarget; const v = fd(e); submit(() => addUser(v), "User added", () => f.reset()); }} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {formError && <Alert tone="error" className="sm:col-span-2 lg:col-span-4">{formError}</Alert>}
        <Field label="Name" htmlFor="u-name" error={errors.name}><Input id="u-name" name="name" required /></Field>
        <Field label="Email" htmlFor="u-email" error={errors.email}><Input id="u-email" name="email" type="email" required /></Field>
        <Field label="Temporary password" htmlFor="u-pw" error={errors.password}><Input id="u-pw" name="password" type="password" autoComplete="new-password" required /></Field>
        <Field label="Role" htmlFor="u-role"><Select id="u-role" name="role" defaultValue="ACCOUNTANT"><option value="ACCOUNTANT">Accountant (can edit)</option><option value="VIEWER">Viewer (read only)</option><option value="OWNER">Owner</option></Select></Field>
        <div className="sm:col-span-2 lg:col-span-4"><Button type="submit" loading={pending}>Add user</Button></div>
      </form>
    </div>
  );
}
