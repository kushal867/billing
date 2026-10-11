import { describe, expect, it, beforeEach } from "vitest";
import { translate, translateMonths, englishOf } from "@/lib/i18n";
import { ne } from "@/lib/i18n/ne";
import { translateDoc } from "@/lib/i18n/doc";
import { reportToPdf } from "@/lib/exporters/pdf";
import { reportToCsv } from "@/lib/exporters/csv";
import { reportToXlsx } from "@/lib/exporters/xlsx";
import { buildReport } from "@/lib/services/report-registry";
import { createTransaction } from "@/lib/services/transactions";
import { makeBusiness, makeFy, setOpening, entry, bs } from "./helpers";
import type { Ctx } from "@/lib/auth/context";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

describe("translation helpers", () => {
  it("falls back to English for unknown text and fills placeholders", () => {
    expect(translate("ne", "Some brand new sentence")).toBe("Some brand new sentence");
    expect(translate("en", "Debit")).toBe("Debit");
    expect(translate("ne", "Debit")).toBe("डेबिट");
    expect(translate("ne", "Showing {from}-{to} of {total}", { from: 1, to: 50, total: 120 })).toBe("जम्मा 120 मध्ये 1-50 देखाइँदै");
  });
  it("translates BS and AD month names inside labels", () => {
    expect(translateMonths("Shrawan 2083", "ne")).toBe("श्रावण 2083");
    expect(translateMonths("Jan 2025", "ne")).toBe("जन 2025");
    expect(translateMonths("Shrawan 2083", "en")).toBe("Shrawan 2083");
  });
  it("round-trips labels back to English", () => {
    expect(englishOf("कुल डेबिट")).toBe("Total Debit");
    expect(englishOf("not in dictionary")).toBe("not in dictionary");
  });
  it("has a Nepali value for every key and no accidental blanks", () => {
    for (const [k, v] of Object.entries(ne)) { expect(v.trim().length, k).toBeGreaterThan(0); }
    // placeholders must be preserved
    for (const [k, v] of Object.entries(ne)) for (const ph of k.match(/\{\w+\}/g) ?? []) expect(v, `${k} keeps ${ph}`).toContain(ph);
  });
});

describe("Nepali reports and PDF", () => {
  let ctx: Ctx;
  beforeEach(async () => {
    ({ ctx } = await makeBusiness());
    const fy = await makeFy(ctx, 2082);
    await setOpening(ctx, "1000", fy.id, bs(2082, 4, 1));
    await createTransaction(ctx, entry({ dateText: "2082-04-10", calendar: "BS", billNumber: "1", debit: "500", description: "चामल बिक्री" }));
  });

  it("translates labels, keeps numbers and user text", async () => {
    const { doc } = await buildReport(ctx, "monthly", { range: "custom", from: bs(2082, 4, 1), to: bs(2082, 5, 30) }, "ne");
    expect(doc.title).toBe("मासिक रिपोर्ट");
    expect(doc.meta.map(([k]) => k)).toContain("सुरुको मौज्दात");
    expect(doc.sections[0].columns.map((c) => c.label)).toContain("कुल डेबिट");
    expect(doc.sections[0].rows[0].month).toBe("श्रावण 2082");
    expect(doc.sections[0].rows[0].debit).toBe("500.00");
    const ledger = await buildReport(ctx, "ledger", {}, "ne");
    expect(ledger.doc.sections[0].rows[0].description).toBe("चामल बिक्री");
  });

  it("renders Nepali text into a valid PDF with an embedded Devanagari font", async () => {
    const { doc } = await buildReport(ctx, "ledger", {}, "ne");
    const pdf = await reportToPdf(doc);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.toString("latin1")).toMatch(/NotoSansDevanagari/);
    // If poppler is available, confirm the Nepali text is actually extractable (not "?").
    try {
      const dir = mkdtempSync(path.join(tmpdir(), "kb-"));
      const f = path.join(dir, "r.pdf");
      writeFileSync(f, pdf);
      const text = execFileSync("pdftotext", [f, "-"], { encoding: "utf8" });
      expect(text).toContain("खाता");
      expect(text).toContain("मौज्दात"); // text extraction reads glyphs in visual order, so check a word without a left-side vowel sign
      expect(text).not.toMatch(/\?{3,}/);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; // pdftotext not installed: skip text check
    }
  });

  it("Excel and CSV exports carry the translated labels", async () => {
    const { doc } = await buildReport(ctx, "ledger", {}, "ne");
    expect(reportToCsv(doc)).toContain("बिल नं.");
    expect((await reportToXlsx(doc)).subarray(0, 2).toString()).toBe("PK");
  });

  it("translateDoc is a no-op for English", async () => {
    const { doc } = await buildReport(ctx, "ledger", {}, "en");
    expect(translateDoc(doc, "en")).toBe(doc);
  });
});
