import { parseEnteredDate, type Calendar } from "./dates";

export type EntryFormValues = {
  dateText: string;
  calendar: Calendar;
  billNumber: string;
  debit: string;
  credit: string;
  description: string;
  categoryId: string;
};

const AMOUNT = /^\d{1,13}(\.\d{1,2})?$/;
const clean = (s: string) => s.replace(/,/g, "").trim();

/** Client-side mirror of the server rules (the server remains the authority). */
export function validateEntryForm(v: EntryFormValues, status: "POSTED" | "DRAFT"): Partial<Record<keyof EntryFormValues, string>> {
  const e: Partial<Record<keyof EntryFormValues, string>> = {};
  const d = parseEnteredDate(v.dateText, v.calendar);
  if (!v.dateText.trim()) e.dateText = "Enter the date";
  else if (!d.ok) e.dateText = d.error;
  if (status === "POSTED" && !v.billNumber.trim()) e.billNumber = "Enter the bill number";
  if (v.billNumber.length > 40) e.billNumber = "Bill number is too long";
  const debit = clean(v.debit);
  const credit = clean(v.credit);
  if (debit && !AMOUNT.test(debit)) e.debit = "Enter a positive amount with up to 2 decimals";
  if (credit && !AMOUNT.test(credit)) e.credit = "Enter a positive amount with up to 2 decimals";
  const dn = debit && AMOUNT.test(debit) ? Number(debit) : 0;
  const cn = credit && AMOUNT.test(credit) ? Number(credit) : 0;
  if (!e.debit && !e.credit) {
    if (dn === 0 && cn === 0) e.debit = "Enter a debit or a credit amount";
    else if (dn > 0 && cn > 0) e.credit = "Enter either a debit or a credit, not both";
  }
  if (v.description.length > 500) e.description = "Keep notes under 500 characters";
  return e;
}
