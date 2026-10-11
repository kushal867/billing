"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { toast } from "sonner";
import { AlertTriangle, Save } from "lucide-react";
import { saveEntry, updateEntry, type SaveOutcome } from "@/actions/entries";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { CurrencyInput } from "@/components/currency-input";
import { DateInput } from "@/components/date-input";
import { validateEntryForm, type EntryFormValues } from "@/lib/entry-form";
import { formatDate, parseEnteredDate, todayIso, type Calendar } from "@/lib/dates";
import { formatAmount, type Grouping } from "@/lib/format";
import { useT } from "@/lib/i18n/client";
import { useOffline } from "@/components/offline-provider";
import { incrementBill, isNetworkError } from "@/lib/offline-queue";

type Duplicates = Extract<SaveOutcome, { status: "duplicate" }>["duplicates"];
type Props = {
  mode: "create" | "edit";
  calendar: Calendar;
  grouping: Grouping;
  symbol: string;
  categories: Array<{ id: string; name: string; kind: string }>;
  nextBill?: string;
  edit?: { id: string; version: number; status: "POSTED" | "DRAFT"; initial: EntryFormValues };
};

const WORK_DATE_KEY = "kusbill:workDate";

export function EntryForm({ mode, calendar, grouping, symbol, categories, nextBill = "", edit }: Props) {
  const router = useRouter();
  const t = useT();
  const offline = useOffline();
  const [pending, start] = useTransition();
  const [formError, setFormError] = useState("");
  const [dups, setDups] = useState<Duplicates | null>(null);
  const [lastSaved, setLastSaved] = useState<string>("");
  const tokenRef = useRef<string>("");
  const submitMode = useRef<"POSTED" | "DRAFT">("POSTED");

  const defaults: EntryFormValues = edit?.initial ?? {
    dateText: formatDate(todayIso(), calendar), calendar, billNumber: nextBill, debit: "", credit: "", description: "", categoryId: "",
  };
  const { register, control, handleSubmit, setError, setValue, setFocus, reset, getValues, clearErrors, formState: { errors } } = useForm<EntryFormValues>({
    defaultValues: defaults,
    // Validate only on submit so typing is never interrupted; errors clear as the user edits.
    resolver: async (values) => {
      const errs = validateEntryForm(values, submitMode.current);
      return { values: Object.keys(errs).length ? {} : values, errors: Object.fromEntries(Object.entries(errs).map(([k, message]) => [k, { type: "validate", message }])) };
    },
  });

  useEffect(() => {
    tokenRef.current = crypto.randomUUID();
    if (mode === "create") {
      // Restore the working date used last (a per-device convenience only).
      try {
        const saved = JSON.parse(localStorage.getItem(WORK_DATE_KEY) ?? "null") as { dateText: string; calendar: Calendar } | null;
        if (saved && parseEnteredDate(saved.dateText, saved.calendar).ok) {
          setValue("dateText", saved.dateText);
          setValue("calendar", saved.calendar);
        }
      } catch { /* storage unavailable */ }
      setFocus("billNumber");
    }
  }, [mode, setValue, setFocus]);

  const submit = useCallback(
    (status: "POSTED" | "DRAFT", allowDuplicate = false) =>
      handleSubmit((values) => {
        setFormError("");
        const payload = { ...values, status, allowDuplicate, clientToken: mode === "create" ? tokenRef.current : undefined };
        start(async () => {
          let res: Awaited<ReturnType<typeof saveEntry>>;
          try {
            res = mode === "create" ? await saveEntry(payload) : await updateEntry(edit!.id, edit!.version, payload);
          } catch (e) {
            if (!isNetworkError(e)) throw e;
            if (mode === "edit") { setFormError(t("You are offline")); toast.error(t("You are offline")); return; }
            // No internet: keep the entry on this device. It carries its idempotency token, so syncing can never duplicate it.
            if (!offline.enqueue({ ...payload, calendar: values.calendar, status })) { toast.error(t("This device has no room left.")); return; }
            try { localStorage.setItem(WORK_DATE_KEY, JSON.stringify({ dateText: values.dateText, calendar: values.calendar })); } catch { /* ignore */ }
            toast.success(t("Saved on this device - will sync when online"));
            setLastSaved(`${t("Saved on this device - will sync when online")}: ${t("Bill Number")} ${values.billNumber}`);
            tokenRef.current = crypto.randomUUID();
            reset({ ...values, billNumber: incrementBill(values.billNumber), debit: "", credit: "", description: "", categoryId: "" });
            setFocus("billNumber");
            return;
          }
          if (!res.ok) {
            setFormError(t(res.error));
            for (const [k, msg] of Object.entries(res.fieldErrors ?? {})) setError(k as keyof EntryFormValues, { message: msg });
            toast.error(t(res.error)); // entered values stay in the form
            return;
          }
          const out = res.data;
          if (out.status === "duplicate") {
            setDups(out.duplicates);
            return;
          }
          setDups(null);
          out.warnings.forEach((w) => toast.warning(t(w)));
          if (mode === "edit") {
            toast.success(t("Changes saved"));
            router.refresh();
            router.push("/ledger");
            return;
          }
          try { localStorage.setItem(WORK_DATE_KEY, JSON.stringify({ dateText: values.dateText, calendar: values.calendar })); } catch { /* ignore */ }
          const amt = values.debit ? `${t("Debit")} ${formatAmount(values.debit.replace(/,/g, ""), grouping)}` : `${t("Credit")} ${formatAmount(values.credit.replace(/,/g, ""), grouping)}`;
          setLastSaved(`${status === "DRAFT" ? t("Draft saved") : t("Saved")}: ${t("Bill Number")} ${out.billNumber || "-"} - ${amt}`);
          toast.success(status === "DRAFT" ? t("Draft saved") : `${t("Entry saved")} - ${t("Bill Number")} ${out.billNumber}`);
          tokenRef.current = crypto.randomUUID();
          reset({ ...values, billNumber: out.nextBill, debit: "", credit: "", description: "", categoryId: "" });
          router.refresh();
          setFocus("billNumber");
        });
      }, () => { setFormError(t("Please fix the highlighted fields.")); }),
    [handleSubmit, mode, edit, grouping, reset, router, setError, setFocus, offline, t],
  );

  const e = errors;
  return (
    <form onSubmit={(ev) => { ev.preventDefault(); submitMode.current = "POSTED"; void submit("POSTED")(); }} className="space-y-5" noValidate>
      {formError && <Alert tone="error">{formError}</Alert>}
      {lastSaved && !formError && <Alert tone="success">{lastSaved}. {t("Ready for the next entry.")}</Alert>}

      {dups && (
        <Alert tone={dups.exact.length ? "error" : "warning"} title={dups.exact.length ? t("An identical entry already exists") : t("This bill number is already used")}>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {[...dups.exact, ...dups.sameBill].map((m) => (
              <li key={m.id}>
                <Link className="underline" href={`/entries/${m.id}`} target="_blank">{t("Bill Number")} {m.billNumber}</Link> {m.date}: {t("Debit")} {formatAmount(m.debit, grouping)}, {t("Credit")} {formatAmount(m.credit, grouping)}{m.description ? ` - ${m.description}` : ""}
              </li>
            ))}
          </ul>
          <div className="mt-3 flex gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => { submitMode.current = "POSTED"; void submit("POSTED", true)(); }}>
              <AlertTriangle className="h-4 w-4" /> {t("Save anyway")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setDups(null); setFocus("billNumber"); }}>{t("Change bill number")}</Button>
          </div>
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          control={control}
          name="dateText"
          render={({ field }) => (
            <Field label={t("Date")} htmlFor="dateText" error={e.dateText?.message && t(e.dateText.message)} hint={t("Type the date as shown on the bill, e.g. 2082-04-15")}>
              <Controller
                control={control}
                name="calendar"
                render={({ field: cal }) => (
                  <DateInput id="dateText" value={field.value} calendar={cal.value} onChange={(v) => { field.onChange(v); clearErrors("dateText"); }} onCalendarChange={cal.onChange} invalid={!!e.dateText} />
                )}
              />
            </Field>
          )}
        />
        <Field label={t("Bill Number")} htmlFor="billNumber" error={e.billNumber?.message && t(e.billNumber.message)} hint={mode === "create" && nextBill ? t("Suggested from the last entry - type to change") : undefined}>
          <Input id="billNumber" {...register("billNumber")} autoComplete="off" invalid={!!e.billNumber} className="num text-lg" onFocus={(ev) => ev.currentTarget.select()} />
        </Field>

        <Field label={t("Debit")} htmlFor="debit" error={e.debit?.message && t(e.debit.message)}>
          <Controller control={control} name="debit" render={({ field }) => <CurrencyInput id="debit" symbol={symbol} value={field.value} onValueChange={(v) => { field.onChange(v); clearErrors(["debit", "credit"]); }} invalid={!!e.debit} />} />
        </Field>
        <Field label={t("Credit")} htmlFor="credit" error={e.credit?.message && t(e.credit.message)}>
          <Controller control={control} name="credit" render={({ field }) => <CurrencyInput id="credit" symbol={symbol} value={field.value} onValueChange={(v) => { field.onChange(v); clearErrors(["debit", "credit"]); }} invalid={!!e.credit} />} />
        </Field>

        <Field label={t("Description / Notes")} htmlFor="description" error={e.description?.message && t(e.description.message)} className="sm:col-span-2">
          <Input id="description" maxLength={500} autoComplete="off" {...register("description")} invalid={!!e.description} placeholder={t("Optional - e.g. customer or item name")} />
        </Field>

        <Field label={t("Category")} htmlFor="categoryId" error={e.categoryId?.message && t(e.categoryId.message)} hint={t("Optional. Needed only to include this entry in Profit & Loss.")} className="sm:col-span-2">
          <Select id="categoryId" {...register("categoryId")}>
            <option value="">{t("Not classified")}</option>
            <optgroup label={t("Income")}>{categories.filter((c) => c.kind === "INCOME").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
            <optgroup label={t("Expense")}>{categories.filter((c) => c.kind === "EXPENSE").map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</optgroup>
          </Select>
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" size="lg" loading={pending} onClick={() => (submitMode.current = "POSTED")}>
          <Save className="h-4 w-4" aria-hidden /> {mode === "edit" ? (edit?.status === "DRAFT" ? t("Save & post entry") : t("Save changes")) : t("Save Entry")}
        </Button>
        {(mode === "create" || edit?.status === "DRAFT") && (
          <Button type="button" variant="outline" size="lg" disabled={pending} onClick={() => { submitMode.current = "DRAFT"; void submit("DRAFT")(); }}>{t("Save as Draft")}</Button>
        )}
        {mode === "edit" ? <Button asChild variant="ghost" size="lg"><Link href="/ledger">{t("Cancel")}</Link></Button> : (
          <Button type="button" variant="ghost" size="lg" onClick={() => { reset({ ...getValues(), billNumber: nextBill, debit: "", credit: "", description: "", categoryId: "" }); setFormError(""); setDups(null); setFocus("billNumber"); }}>{t("Clear")}</Button>
        )}
      </div>
    </form>
  );
}
