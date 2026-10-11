import { z } from "zod";
import { parseMoney, ZERO, type Decimal } from "@/lib/money";
import { parseEnteredDate } from "@/lib/dates";

const optionalId = z
  .string()
  .optional()
  .transform((v) => (v && v !== "none" ? v : undefined))
  .pipe(z.string().uuid("Invalid category").optional());

export const entrySchema = z.object({
  dateText: z.string().trim().min(1, "Enter the date"),
  calendar: z.enum(["BS", "AD"]),
  billNumber: z.string().trim().max(40, "Bill number is too long"),
  debit: z.string().trim().default(""),
  credit: z.string().trim().default(""),
  description: z.string().trim().max(500, "Keep notes under 500 characters").default(""),
  categoryId: optionalId,
  status: z.enum(["POSTED", "DRAFT"]).default("POSTED"),
  clientToken: z.string().max(100).optional(),
  allowDuplicate: z.boolean().optional(),
});
export type EntryInput = z.input<typeof entrySchema>;

export type ParsedEntry = {
  dateIso: string;
  dateText: string;
  calendar: "BS" | "AD";
  billNumber: string;
  debit: Decimal;
  credit: Decimal;
  description: string;
  categoryId?: string;
  status: "POSTED" | "DRAFT";
  clientToken?: string;
  allowDuplicate: boolean;
};

export type FieldErrors = Record<string, string>;

/** Validates raw form input. Returns either parsed values or a map of field errors. */
export function parseEntry(raw: unknown): { ok: true; value: ParsedEntry } | { ok: false; errors: FieldErrors } {
  const r = entrySchema.safeParse(raw);
  const errors: FieldErrors = {};
  if (!r.success) {
    for (const i of r.error.issues) errors[String(i.path[0] ?? "form")] ??= i.message;
    return { ok: false, errors };
  }
  const v = r.data;
  const date = parseEnteredDate(v.dateText, v.calendar);
  if (!date.ok) errors.dateText = date.error;

  const debit = v.debit === "" ? ZERO : parseMoney(v.debit);
  const credit = v.credit === "" ? ZERO : parseMoney(v.credit);
  if (debit === null) errors.debit = "Enter a positive amount with up to 2 decimals";
  if (credit === null) errors.credit = "Enter a positive amount with up to 2 decimals";
  if (debit && credit) {
    if (debit.isZero() && credit.isZero()) errors.debit = "Enter a debit or a credit amount";
    else if (debit.gt(0) && credit.gt(0)) errors.credit = "Enter either a debit or a credit, not both";
  }
  if (v.status === "POSTED" && v.billNumber === "") errors.billNumber = "Enter the bill number";
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      dateIso: (date as { ok: true; iso: string }).iso,
      dateText: v.dateText,
      calendar: v.calendar,
      billNumber: v.billNumber,
      debit: debit!,
      credit: credit!,
      description: v.description,
      categoryId: v.categoryId,
      status: v.status,
      clientToken: v.clientToken,
      allowDuplicate: v.allowDuplicate ?? false,
    },
  };
}
