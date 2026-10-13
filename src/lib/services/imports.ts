import Papa from "papaparse";
import { pdfToRows } from "@/lib/importers/pdf-table";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { assertWrite } from "@/lib/auth/context";
import { validation } from "@/lib/errors";
import { D, parseMoney, ZERO } from "@/lib/money";
import { fromIso, parseEnteredDate, parseIso, type Calendar } from "@/lib/dates";
import { audit } from "./audit";
import { getAnchor } from "./periods";
import { withBusinessLock } from "./transactions";

export const MAX_IMPORT_ROWS = 5000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

export type ParsedTable = {
  kind: "CSV" | "XLSX" | "PDF";
  headers: string[];
  /** Data rows; `rowNumbers[i]` is the 1-based row number in the original file. */
  rows: string[][];
  rowNumbers: number[];
};

export type Mapping = { date: number; billNumber: number; debit: number; credit: number; description: number };
export type ImportOptions = { mapping: Mapping; calendar: Calendar };

const FIELD_HINTS: Record<keyof Mapping, RegExp> = {
  date: /date|miti|मिति|dt$/i,
  billNumber: /bill|invoice|voucher|ref|no\.?$|number|#/i,
  debit: /debit|dr\b|dr\.|paid|out/i,
  credit: /credit|cr\b|cr\.|received|in\b/i,
  description: /desc|note|particular|narration|detail|remark/i,
};

export function suggestMapping(headers: string[]): Mapping {
  const used = new Set<number>();
  const pick = (k: keyof Mapping) => {
    const i = headers.findIndex((h, idx) => !used.has(idx) && FIELD_HINTS[k].test(h.trim()));
    if (i >= 0) used.add(i);
    return i;
  };
  // Order matters: "Bill No." must claim the bill column before generic hints can.
  const date = pick("date");
  const debit = pick("debit");
  const credit = pick("credit");
  const description = pick("description");
  const billNumber = pick("billNumber");
  return { date, billNumber, debit, credit, description };
}

function cellToString(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return `AD:${v.toISOString().slice(0, 10)}`; // Excel dates are unambiguous Gregorian
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("result" in o) return cellToString(o.result as ExcelJS.CellValue);
    if ("richText" in o) return (o.richText as Array<{ text: string }>).map((t) => t.text).join("");
    if ("text" in o) return String(o.text);
    return "";
  }
  return String(v).trim();
}

export async function parseTable(filename: string, buf: Buffer, hasHeader = true): Promise<ParsedTable> {
  if (buf.length > MAX_FILE_BYTES) throw validation("File is larger than 5 MB");
  const lower = filename.toLowerCase();
  let all: { cells: string[]; n: number }[] = [];
  let kind: "CSV" | "XLSX" | "PDF";
  if (lower.endsWith(".xlsx")) {
    kind = "XLSX";
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    } catch {
      throw validation("This does not look like a valid Excel (.xlsx) file");
    }
    const ws = wb.worksheets[0];
    if (!ws) throw validation("The workbook has no sheets");
    const width = ws.columnCount;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const cells: string[] = [];
      for (let c = 1; c <= width; c++) cells.push(cellToString(row.getCell(c).value));
      all.push({ cells, n });
    });
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    kind = "CSV";
    const text = buf.toString("utf8").replace(/^﻿/, "");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
    all = parsed.data.map((cells, i) => ({ cells: cells.map((c) => (c ?? "").trim()), n: i + 1 }));
  } else if (lower.endsWith(".pdf")) {
    kind = "PDF";
    let rows: string[][];
    try {
      rows = await pdfToRows(buf);
    } catch (e) {
      throw validation(e instanceof Error ? e.message : "This PDF could not be read");
    }
    if (!rows.length) throw validation("No table of text was found in this PDF. Scanned or photographed pages cannot be read - use the Excel template instead.");
    all = rows.map((cells, i) => ({ cells, n: i + 1 }));
  } else {
    throw validation("Upload a .csv, .xlsx or .pdf file");
  }
  all = all.filter((r) => r.cells.some((c) => c !== ""));
  if (!all.length) throw validation("The file is empty");
  const width = Math.max(...all.map((r) => r.cells.length));
  const pad = (c: string[]) => [...c, ...Array(width - c.length).fill("")];
  const alpha = (i: number) => `Column ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""}`;
  const headers = hasHeader ? pad(all[0].cells).map((h, i) => h || alpha(i)) : Array.from({ length: width }, (_, i) => alpha(i));
  const body = hasHeader ? all.slice(1) : all;
  if (body.length > MAX_IMPORT_ROWS) throw validation(`Files are limited to ${MAX_IMPORT_ROWS} rows per import. Split the file and import it in parts.`);
  return { kind, headers, rows: body.map((r) => pad(r.cells)), rowNumbers: body.map((r) => r.n) };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export type RowValues = { dateIso: string; dateText: string; calendar: Calendar; billNumber: string; debit: string; credit: string; description: string };
export type RowResult = {
  rowNumber: number;
  status: "ok" | "duplicate" | "error";
  errors: string[];
  warnings: string[];
  values?: RowValues;
  cells: string[];
};

const at = (cells: string[], i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");

function parseImportDate(text: string, calendar: Calendar): { ok: true; iso: string; calendar: Calendar; warn?: string } | { ok: false; error: string } {
  let cal = calendar;
  let t = text;
  if (t.startsWith("AD:")) {
    cal = "AD";
    t = t.slice(3);
  }
  const r = parseEnteredDate(t, cal);
  if (!r.ok) return { ok: false, error: `Date "${text.replace(/^AD:/, "")}": ${r.error}` };
  const y = parseIso(t.replace(/[/.]/g, "-"))!.y;
  let warn: string | undefined;
  if (cal === "AD" && y >= 2070) warn = `Date ${t} is interpreted as AD but looks like a Bikram Sambat date - check the calendar setting.`;
  if (cal === "BS" && y < 2060) warn = `Date ${t} is interpreted as BS but looks like a Gregorian year - check the calendar setting.`;
  return { ok: true, iso: r.iso, calendar: cal, warn };
}

export async function validateRows(ctx: Pick<Ctx, "businessId">, table: Pick<ParsedTable, "rows" | "rowNumbers">, opts: ImportOptions): Promise<RowResult[]> {
  const { mapping, calendar } = opts;
  if (mapping.date < 0 || mapping.billNumber < 0) throw validation("Map the Date and Bill Number columns first");
  if (mapping.debit < 0 && mapping.credit < 0) throw validation("Map at least one of the Debit or Credit columns");
  if (table.rows.length > MAX_IMPORT_ROWS) throw validation(`Too many rows (limit ${MAX_IMPORT_ROWS})`);

  const anchor = await getAnchor(db, ctx.businessId);
  const existing = await db.transaction.findMany({
    where: { businessId: ctx.businessId, status: "POSTED" },
    select: { transactionDate: true, billNumber: true, debitAmount: true, creditAmount: true },
  });
  const key = (d: string, b: string, dr: string, cr: string) => `${d}|${b}|${D(dr).toFixed(2)}|${D(cr).toFixed(2)}`;
  const seen = new Set(existing.map((t) => key(t.transactionDate.toISOString().slice(0, 10), t.billNumber, t.debitAmount.toString(), t.creditAmount.toString())));
  const billsInDb = new Set(existing.map((t) => t.billNumber));
  const billsInFile = new Set<string>();

  return table.rows.map((cells, i) => {
    const rowNumber = table.rowNumbers[i] ?? i + 2;
    const errors: string[] = [];
    const warnings: string[] = [];
    const dateText = at(cells, mapping.date);
    const bill = at(cells, mapping.billNumber);
    const debitText = at(cells, mapping.debit);
    const creditText = at(cells, mapping.credit);
    const description = at(cells, mapping.description).slice(0, 500);

    let iso = "";
    let entered: Calendar = calendar;
    if (!dateText) errors.push("Date is missing");
    else {
      const d = parseImportDate(dateText, calendar);
      if (!d.ok) errors.push(d.error);
      else {
        iso = d.iso;
        entered = d.calendar;
        if (d.warn) warnings.push(d.warn);
        if (anchor.date && iso < anchor.date) errors.push(`Date is before the opening balance date (${anchor.date})`);
      }
    }
    if (!bill) errors.push("Bill number is missing");
    else if (bill.length > 40) errors.push("Bill number is longer than 40 characters");

    const debit = debitText === "" ? ZERO : parseMoney(debitText);
    const credit = creditText === "" ? ZERO : parseMoney(creditText);
    if (debit === null) errors.push(`Debit "${debitText}" is not a valid positive amount (max 2 decimals)`);
    if (credit === null) errors.push(`Credit "${creditText}" is not a valid positive amount (max 2 decimals)`);
    if (debit && credit) {
      if (debit.isZero() && credit.isZero()) errors.push("Both debit and credit are empty or zero");
      else if (debit.gt(0) && credit.gt(0)) errors.push("Row has both a debit and a credit");
    }

    if (errors.length) return { rowNumber, status: "error" as const, errors, warnings, cells };
    const values: RowValues = { dateIso: iso, dateText: dateText.replace(/^AD:/, ""), calendar: entered, billNumber: bill, debit: debit!.toFixed(2), credit: credit!.toFixed(2), description };
    const k = key(iso, bill, values.debit, values.credit);
    let status: RowResult["status"] = "ok";
    if (seen.has(k)) {
      status = "duplicate";
      warnings.push("An identical entry (same date, bill number and amounts) already exists or appears earlier in this file");
    } else {
      seen.add(k);
      if (billsInDb.has(bill) || billsInFile.has(bill)) warnings.push(`Bill number ${bill} is already used by another entry`);
    }
    billsInFile.add(bill);
    return { rowNumber, status, errors, warnings, values, cells };
  });
}

export type ImportSummary = { jobId: string; total: number; imported: number; skipped: number; failed: number };

export async function commitImport(
  ctx: Ctx,
  input: { filename: string; kind: "CSV" | "XLSX" | "PDF" | "BULK"; table: Pick<ParsedTable, "rows" | "rowNumbers">; options: ImportOptions; includeDuplicates: boolean; /** Refuse (and save nothing) if any row fails validation. */ strict?: boolean },
): Promise<ImportSummary> {
  assertWrite(ctx);
  return withBusinessLock(
    ctx.businessId,
    async (tx) => {
      // Re-validate on the server inside the lock; never trust the client's preview.
      const results = await validateRows(ctx, input.table, input.options);
      const toImport = results.filter((r) => r.status === "ok" || (input.includeDuplicates && r.status === "duplicate"));
      const failed = results.filter((r) => r.status === "error");
      if (input.strict && failed.length) throw validation(`${failed.length} row${failed.length === 1 ? " has" : "s have"} errors. Nothing was saved.`);
      const skipped = results.length - toImport.length - failed.length;
      const job = await tx.importJob.create({
        data: {
          businessId: ctx.businessId,
          userId: ctx.userId,
          filename: input.filename.slice(0, 200),
          kind: input.kind,
          status: "COMPLETED",
          totalRows: results.length,
          importedRows: toImport.length,
          skippedRows: skipped,
          failedRows: failed.length,
          mapping: input.options as object,
          report: {
            errors: failed.slice(0, 500).map((r) => ({ row: r.rowNumber, messages: r.errors })),
            skipped: results.filter((r) => r.status === "duplicate" && !input.includeDuplicates).slice(0, 500).map((r) => ({ row: r.rowNumber, messages: r.warnings })),
          },
        },
      });
      if (toImport.length) {
        // Insert in file order so same-date rows keep the order of the physical billpad.
        await tx.transaction.createMany({
          data: toImport.map((r) => ({
            businessId: ctx.businessId,
            transactionDate: fromIso(r.values!.dateIso),
            enteredDateText: r.values!.dateText,
            enteredCalendar: r.values!.calendar,
            billNumber: r.values!.billNumber,
            debitAmount: r.values!.debit,
            creditAmount: r.values!.credit,
            description: r.values!.description,
            status: "POSTED" as const,
            createdBy: ctx.userId,
            importJobId: job.id,
          })),
        });
      }
      await audit(tx, ctx, {
        action: input.kind === "BULK" ? "BULK_ENTRY" : "IMPORT",
        entityType: "ImportJob",
        entityId: job.id,
        note: `${input.filename}: ${toImport.length} imported, ${skipped} skipped, ${failed.length} failed`,
      });
      return { jobId: job.id, total: results.length, imported: toImport.length, skipped, failed: failed.length };
    },
    120000,
  );
}

export async function storePdfReference(ctx: Ctx, filename: string, buf: Buffer) {
  assertWrite(ctx);
  if (buf.length > 8 * 1024 * 1024) throw validation("PDF is larger than 8 MB");
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw validation("This file is not a valid PDF");
  return db.$transaction(async (tx) => {
    const job = await tx.importJob.create({
      data: { businessId: ctx.businessId, userId: ctx.userId, filename: filename.slice(0, 200), kind: "PDF", status: "REFERENCE_ONLY", fileData: new Uint8Array(buf) },
      select: { id: true, filename: true },
    });
    await audit(tx, ctx, { action: "UPLOAD_PDF", entityType: "ImportJob", entityId: job.id, note: filename });
    return job;
  });
}

export async function getPdf(ctx: Pick<Ctx, "businessId">, id: string) {
  return db.importJob.findFirst({ where: { id, businessId: ctx.businessId, kind: "PDF" }, select: { filename: true, fileData: true } });
}
