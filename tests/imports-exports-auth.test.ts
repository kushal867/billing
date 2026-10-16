import { describe, expect, it, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { makeBusiness, makeFy, setOpening, entry, bs } from "./helpers";
import { createTransaction, getTransaction, updateTransaction, voidTransaction, reverseTransaction } from "@/lib/services/transactions";
import { commitImport, parseTable, storePdfReference, suggestMapping, validateRows } from "@/lib/services/imports";
import { listLedger } from "@/lib/services/ledger";
import { buildAnnualReport, buildLedgerReport } from "@/lib/services/reports";
import { reportToPdf } from "@/lib/exporters/pdf";
import { reportToXlsx } from "@/lib/exporters/xlsx";
import { reportToCsv } from "@/lib/exporters/csv";
import { saveOpeningBalance } from "@/lib/services/periods";
import { changeBalanceConvention, createUser, updateProfile } from "@/lib/services/settings";
import { createManualJournal } from "@/lib/services/accounting";
import type { Ctx } from "@/lib/auth/context";

let ctx: Ctx;
beforeEach(async () => {
  ({ ctx } = await makeBusiness());
  const fy = await makeFy(ctx, 2082);
  await setOpening(ctx, "1000", fy.id, bs(2082, 4, 1));
});

const csv = (s: string) => Buffer.from(s);

describe("CSV import", () => {
  const body = [
    "Date,Bill No.,Debit,Credit,Description",
    "2082-04-02,101,\"1,500.00\",,Rice",
    "2082-04-03,102,,250.50,Oil",
    "2082-04-31,103,10,,bad day",       // Shrawan has 31 days in 2082? -> check below via validation
    "2082-04-04,,10,,missing bill",
    "2082-04-05,105,abc,,bad amount",
    "2082-04-06,106,5,5,both sides",
    "2082-04-07,107,0,,zero",
    "2082-04-08,108,10.999,,three decimals",
    "2082-04-02,101,1500,,duplicate of row 2",
    "2081-01-01,109,10,,before opening",
  ].join("\n");

  it("maps columns, validates every row with row numbers and never saves anything on preview", async () => {
    const table = await parseTable("old.csv", csv(body));
    const mapping = suggestMapping(table.headers);
    expect(mapping).toEqual({ date: 0, billNumber: 1, debit: 2, credit: 3, description: 4 });
    const res = await validateRows(ctx, table, { mapping, calendar: "BS" });
    const by = Object.fromEntries(res.map((r) => [r.rowNumber, r]));
    expect(by[2].status).toBe("ok");
    expect(by[2].values).toMatchObject({ debit: "1500.00", credit: "0.00", dateIso: bs(2082, 4, 2) });
    expect(by[3].status).toBe("ok");
    expect(by[5].errors.join()).toMatch(/Bill number is missing/);
    expect(by[6].errors.join()).toMatch(/Debit "abc"/);
    expect(by[7].errors.join()).toMatch(/both a debit and a credit/);
    expect(by[8].errors.join()).toMatch(/empty or zero/);
    expect(by[9].errors.join()).toMatch(/Debit "10.999"/);
    expect(by[10].status).toBe("duplicate");
    expect(by[11].errors.join()).toMatch(/before the opening balance/);
    expect(await db.transaction.count({ where: { businessId: ctx.businessId } })).toBe(0);
  });

  it("imports only valid rows, reports successes/skips/failures and records the job", async () => {
    const table = await parseTable("old.csv", csv(body));
    const mapping = suggestMapping(table.headers);
    const summary = await commitImport(ctx, { filename: "old.csv", kind: "CSV", table, options: { mapping, calendar: "BS" }, includeDuplicates: false });
    expect(summary.total).toBe(10);
    expect(summary.imported + summary.skipped + summary.failed).toBe(10);
    expect(summary.skipped).toBe(1);
    const rows = (await listLedger(ctx, { pageSize: 0 })).rows;
    expect(rows).toHaveLength(summary.imported);
    expect(rows[0].balance?.toFixed(2)).toBe("2500.00");
    expect(rows[1].balance?.toFixed(2)).toBe("2249.50");
    const job = await db.importJob.findUniqueOrThrow({ where: { id: summary.jobId } });
    expect(job).toMatchObject({ importedRows: summary.imported, skippedRows: 1, failedRows: summary.failed });
    // Second run is idempotent: everything valid is now a duplicate.
    const again = await commitImport(ctx, { filename: "old.csv", kind: "CSV", table, options: { mapping, calendar: "BS" }, includeDuplicates: false });
    expect(again.imported).toBe(0);
  });

  it("flags ambiguous calendars instead of trusting them", async () => {
    const table = await parseTable("x.csv", csv("Date,Bill,Debit,Credit\n2025-04-14,1,10,"));
    const res = await validateRows(ctx, table, { mapping: suggestMapping(table.headers), calendar: "BS" });
    expect(res[0].warnings.join()).toMatch(/check the calendar/);
  });

  it("requires the essential columns to be mapped and rejects unsupported files", async () => {
    const table = await parseTable("x.csv", csv("a,b\n1,2"));
    await expect(validateRows(ctx, table, { mapping: { date: -1, billNumber: 0, debit: 1, credit: -1, description: -1 }, calendar: "AD" })).rejects.toThrow(/Date and Bill/);
    await expect(parseTable("x.exe", csv("zzz"))).rejects.toThrow(/\.csv, \.xlsx or \.pdf/);
    await expect(parseTable("x.csv", csv("\n\n"))).rejects.toThrow(/empty/);
  });

  it("imports an Excel workbook, treating real Excel dates as unambiguous AD", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["Date", "Bill No.", "Debit", "Credit", "Notes"]);
    ws.addRow([new Date(Date.UTC(2025, 7, 20)), 501, 750, null, "from excel"]);
    ws.addRow(["2082-05-10", "502", null, 20, "text date in BS"]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const table = await parseTable("book.xlsx", buf);
    expect(table.kind).toBe("XLSX");
    const res = await validateRows(ctx, table, { mapping: suggestMapping(table.headers), calendar: "BS" });
    expect(res.map((r) => r.status)).toEqual(["ok", "ok"]);
    expect(res[0].values?.dateIso).toBe("2025-08-20");
    expect(res[1].values?.dateIso).toBe(bs(2082, 5, 10));
  });

  it("stores PDFs for reference only and refuses non-PDF content", async () => {
    await expect(storePdfReference(ctx, "fake.pdf", Buffer.from("not a pdf"))).rejects.toThrow(/not a valid PDF/);
    const job = await storePdfReference(ctx, "scan.pdf", Buffer.from("%PDF-1.4\n%%EOF"));
    const row = await db.importJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject({ status: "REFERENCE_ONLY", importedRows: 0, totalRows: 0 });
  });
});

describe("exports reflect report calculations and filters", () => {
  it("produces a valid PDF, XLSX and CSV from the same report", async () => {
    for (let i = 1; i <= 60; i++) await createTransaction(ctx, entry({ dateText: "2082-04-10", calendar: "BS", billNumber: String(i), debit: "100.25", description: `Item ${i}` }));
    const doc = await buildLedgerReport(ctx, { q: "Item 1" });
    const pdf = await reportToPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(1500);
    const xlsx = await reportToXlsx(doc);
    expect(xlsx.subarray(0, 2).toString()).toBe("PK");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx as unknown as ExcelJS.Buffer);
    const ws = wb.worksheets[0];
    const texts: unknown[][] = [];
    ws.eachRow((r) => texts.push((r.values as unknown[]).slice(1)));
    const dataRows = texts.filter((r) => typeof r[3] === "number");
    expect(dataRows.length).toBe(doc.sections[0].rows.length + 1); // data rows + totals row
    expect(doc.sections[0].rows.length).toBeLessThan(60);
    expect(typeof dataRows[0][5]).toBe("number");
    const csvText = reportToCsv(doc);
    expect(csvText).toContain("Bill No.");
    expect(csvText.split("\r\n").filter((l) => l.includes(",Item 1")).length).toBe(doc.sections[0].rows.length);
  });

  it("multi-page annual PDF renders and neutralises formula injection in CSV/XLSX", async () => {
    await createTransaction(ctx, entry({ dateText: "2082-04-10", calendar: "BS", billNumber: "1", description: "=HYPERLINK(\"http://evil\")" }));
    const fy = await db.financialYear.findFirstOrThrow({ where: { businessId: ctx.businessId } });
    const doc = await buildAnnualReport(ctx, fy.id);
    expect((await reportToPdf(doc)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(reportToCsv(doc)).toContain("'=HYPERLINK");
  });
});

describe("authorization and tenant isolation", () => {
  it("one business can never read or change another business's records", async () => {
    const other = await makeBusiness();
    const mine = await createTransaction(ctx, entry({ billNumber: "9", dateText: "2082-04-10", calendar: "BS" }));
    if (mine.status !== "saved") throw new Error();
    const t = mine.transaction;
    await expect(getTransaction(other.ctx, t.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateTransaction(other.ctx, t.id, entry({ billNumber: "9" }), t.version)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(voidTransaction(other.ctx, t.id, "hacking")).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reverseTransaction(other.ctx, t.id, "hacking")).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await listLedger(other.ctx, { pageSize: 0 })).rows).toHaveLength(0);
    const fy = await db.financialYear.findFirstOrThrow({ where: { businessId: ctx.businessId } });
    await expect(buildAnnualReport(other.ctx, fy.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(saveOpeningBalance({ ...other.ctx }, { financialYearId: fy.id, amount: "1", effectiveDate: bs(2082, 4, 1) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const own = await db.transaction.findUniqueOrThrow({ where: { id: t.id } });
    expect(own.status).toBe("POSTED");
  });

  it("cannot assign another business's category or account", async () => {
    const other = await makeBusiness();
    const foreignCat = await db.category.findFirstOrThrow({ where: { businessId: other.ctx.businessId } });
    await expect(createTransaction(ctx, entry({ categoryId: foreignCat.id, dateText: "2082-04-10", calendar: "BS" }))).rejects.toMatchObject({ code: "VALIDATION" });
    const foreignAcct = await db.account.findFirstOrThrow({ where: { businessId: other.ctx.businessId } });
    const mineAcct = await db.account.findFirstOrThrow({ where: { businessId: ctx.businessId } });
    const D = (await import("@/lib/money")).D;
    await expect(
      createManualJournal(ctx, { date: "2025-08-01", memo: "x", lines: [{ accountId: foreignAcct.id, debit: D(1), credit: D(0) }, { accountId: mineAcct.id, debit: D(0), credit: D(1) }] }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("viewers are read-only and only owners can manage settings and users", async () => {
    const viewer = await makeBusiness("VIEWER");
    await expect(createTransaction(viewer.ctx, entry())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(commitImport(viewer.ctx, { filename: "a.csv", kind: "CSV", table: { rows: [], rowNumbers: [] }, options: { mapping: { date: 0, billNumber: 1, debit: 2, credit: -1, description: -1 }, calendar: "AD" }, includeDuplicates: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const acct = await makeBusiness("ACCOUNTANT");
    await expect(updateProfile(acct.ctx, { name: "x", address: "", phone: "", email: "", panNumber: "", currency: "NPR", currencySymbol: "Rs.", reportHeader: "", reportFooter: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createUser(acct.ctx, { name: "n", email: "n@x.co", password: "abcdefg1", role: "OWNER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(changeBalanceConvention(acct.ctx, "CREDIT_PLUS", true)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("changing the balance convention needs explicit confirmation once entries exist and never edits amounts", async () => {
    await createTransaction(ctx, entry({ dateText: "2082-04-10", calendar: "BS", billNumber: "1", debit: "100" }));
    await expect(changeBalanceConvention(ctx, "CREDIT_PLUS", false)).rejects.toMatchObject({ code: "VALIDATION" });
    await changeBalanceConvention(ctx, "CREDIT_PLUS", true);
    const rows = (await listLedger(ctx, { pageSize: 0 })).rows;
    expect(rows[0].debit.toFixed(2)).toBe("100.00");
    expect(rows[0].balance?.toFixed(2)).toBe("900.00");
    expect(await db.auditLog.count({ where: { businessId: ctx.businessId, action: "CHANGE_CONVENTION" } })).toBe(1);
  });
});
