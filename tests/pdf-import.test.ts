import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { parseTable } from "@/lib/services/imports";

function makePdf(rows: string[][], colX = [40, 130, 230, 330, 430]): Promise<Buffer> {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c)).on("end", () => resolve(Buffer.concat(chunks)));
    doc.fontSize(14).text("Ram Traders - Ledger", 40, 40);
    let y = 90;
    for (const r of rows) {
      doc.fontSize(10);
      r.forEach((cell, i) => doc.text(cell, colX[i], y, { lineBreak: false }));
      y += 20;
    }
    doc.end();
  });
}

describe("PDF import", () => {
  it("rebuilds the table from a typed PDF", async () => {
    const buf = await makePdf([
      ["Date", "Bill No", "Debit", "Credit", "Description"],
      ["2082-04-01", "B-101", "1500.00", "", "Sugar sale"],
      ["2082-04-02", "B-102", "", "700.50", "Payment received"],
    ]);
    const t = await parseTable("ledger.pdf", buf, true);
    expect(t.kind).toBe("PDF");
    expect(t.headers.map((h) => h.toLowerCase())).toEqual(["date", "bill no", "debit", "credit", "description"]);
    expect(t.rows).toHaveLength(2);
    expect(t.rows[0][0]).toBe("2082-04-01");
    expect(t.rows[0][2]).toBe("1500.00");
    expect(t.rows[1][3]).toBe("700.50");
  });
  it("explains when there is no text to read", async () => {
    await expect(parseTable("scan.pdf", Buffer.from("%PDF-1.4\n%%EOF"), true)).rejects.toThrow();
  });
});
