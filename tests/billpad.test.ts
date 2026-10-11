import { describe, expect, it, beforeEach } from "vitest";
import { makeBusiness, makeFy, setOpening, entry, bs } from "./helpers";
import { createTransaction } from "@/lib/services/transactions";
import { buildReport } from "@/lib/services/report-registry";
import { summarizePeriod } from "@/lib/services/ledger";
import { reportToPdf } from "@/lib/exporters/pdf";
import { reportToXlsx } from "@/lib/exporters/xlsx";
import { reportToCsv } from "@/lib/exporters/csv";
import type { Ctx } from "@/lib/auth/context";

let ctx: Ctx;
beforeEach(async () => {
  ({ ctx } = await makeBusiness());
  const fy = await makeFy(ctx, 2082);
  await setOpening(ctx, "1000", fy.id, bs(2082, 4, 1));
  for (let i = 1; i <= 23; i++) {
    await createTransaction(ctx, entry({ dateText: `2082-04-${String(i).padStart(2, "0")}`, calendar: "BS", billNumber: String(100 + i), debit: i % 2 ? "100.50" : "", credit: i % 2 ? "" : "40" }));
  }
});

const P = { range: "custom", from: bs(2082, 4, 1), to: bs(2082, 4, 31) };

describe("billpad-style statement", () => {
  it("splits into pad pages with brought-forward and carried-forward balances that chain", async () => {
    const { doc } = await buildReport(ctx, "billpad", { ...P, rows: "10" });
    expect(doc.pageBreaks).toBe(true);
    expect(doc.sections).toHaveLength(3);
    expect(doc.sections.map((s) => s.rows.length - 1)).toEqual([10, 10, 3]);
    expect(doc.sections[0].rows[0]).toMatchObject({ date: "Opening Balance", balance: "1000.00" });
    for (let i = 1; i < 3; i++) {
      expect(doc.sections[i].rows[0]).toMatchObject({ date: "Brought forward", balance: doc.sections[i - 1].totals!.balance });
    }
    expect(doc.sections[0].totals!.date).toBe("Carried forward");
    expect(doc.sections[2].totals!.date).toBe("Closing Balance");
  });

  it("page totals add up to the period totals and the last balance equals the closing balance", async () => {
    const { doc } = await buildReport(ctx, "billpad", { ...P, rows: "10" });
    const s = await summarizePeriod(ctx, P.from, P.to);
    const dr = doc.sections.reduce((a, x) => a + Number(x.totals!.debit), 0);
    const cr = doc.sections.reduce((a, x) => a + Number(x.totals!.credit), 0);
    expect(dr.toFixed(2)).toBe(s.debit.toFixed(2));
    expect(cr.toFixed(2)).toBe(s.credit.toFixed(2));
    expect(doc.sections[2].totals!.balance).toBe(s.closing.toFixed(2));
    // every row's balance is previous + debit - credit
    let prev = Number(doc.sections[0].rows[0].balance);
    for (const sec of doc.sections) for (const r of sec.rows.slice(1)) {
      prev = Math.round((prev + Number(r.debit || 0) - Number(r.credit || 0)) * 100) / 100;
      expect(r.balance).toBe(prev.toFixed(2));
    }
  });

  it("handles an empty period and out-of-range rows-per-page", async () => {
    const empty = await buildReport(ctx, "billpad", { range: "custom", from: bs(2083, 1, 1), to: bs(2083, 1, 5) });
    expect(empty.doc.sections).toHaveLength(1);
    expect(empty.doc.sections[0].rows).toHaveLength(1);
    const big = await buildReport(ctx, "billpad", { ...P, rows: "9999" });
    expect(big.doc.sections.length).toBe(1);
    const tiny = await buildReport(ctx, "billpad", { ...P, rows: "1" });
    expect(tiny.doc.sections[0].rows.length - 1).toBe(5);
  });

  it("exports to PDF (one sheet per pad page), Excel and CSV, in Nepali too", async () => {
    const { doc } = await buildReport(ctx, "billpad", { ...P, rows: "10" }, "ne");
    expect(doc.sections[0].heading).toBe("पृष्ठ 1");
    expect(doc.sections[1].rows[0].date).toBe("अघिल्लो पृष्ठबाट ल्याइएको");
    const pdf = await reportToPdf(doc);
    const pages = (pdf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(3);
    expect((await reportToXlsx(doc)).subarray(0, 2).toString()).toBe("PK");
    expect(reportToCsv(doc)).toContain("पृष्ठ 3");
  });
});
