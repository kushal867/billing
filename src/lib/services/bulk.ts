import type { Ctx } from "@/lib/auth/context";
import { assertWrite } from "@/lib/auth/context";
import { validation } from "@/lib/errors";
import type { Calendar } from "@/lib/dates";
import { commitImport, validateRows, type ImportSummary, type RowResult } from "./imports";

export const MAX_BULK_ROWS = 300;
export type BulkRow = { date: string; bill: string; debit: string; credit: string; description: string };
export type BulkInput = { rows: BulkRow[]; defaultDate: string; calendar: Calendar };

const isBlank = (r: BulkRow) => !r.bill.trim() && !r.debit.trim() && !r.credit.trim() && !r.description.trim();
const MAPPING = { date: 0, billNumber: 1, debit: 2, credit: 3, description: 4 };

/** Blank rows are ignored; a row without its own date uses the page date. Grid row numbers are preserved in results. */
function toTable(input: BulkInput) {
  if (input.rows.length > MAX_BULK_ROWS) throw validation(`Bulk entry is limited to ${MAX_BULK_ROWS} rows at a time`);
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  input.rows.forEach((r, i) => {
    if (isBlank(r)) return;
    rows.push([r.date.trim() || input.defaultDate.trim(), r.bill, r.debit, r.credit, r.description]);
    rowNumbers.push(i + 1);
  });
  if (!rows.length) throw validation("Type at least one row first");
  return { rows, rowNumbers };
}

export async function previewBulk(ctx: Ctx, input: BulkInput): Promise<RowResult[]> {
  assertWrite(ctx);
  const table = toTable(input);
  return validateRows(ctx, table, { mapping: MAPPING, calendar: input.calendar });
}

/**
 * All-or-nothing: if any row is invalid nothing is saved. Rows that duplicate an existing
 * entry are saved only when `includeDuplicates` is true.
 */
export async function saveBulk(ctx: Ctx, input: BulkInput, includeDuplicates: boolean): Promise<ImportSummary> {
  assertWrite(ctx);
  const table = toTable(input);
  return commitImport(ctx, { filename: "Bulk entry", kind: "BULK", table, options: { mapping: MAPPING, calendar: input.calendar }, includeDuplicates, strict: true });
}
