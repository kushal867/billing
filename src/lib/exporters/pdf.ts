import PDFDocument from "pdfkit";
import path from "node:path";
import { formatMoney } from "@/lib/money";
import { englishOf, translate } from "@/lib/i18n";
import { MONEY_META, type Column, type ReportDoc, type Section } from "@/lib/services/report-doc";

// Noto Sans Devanagari (SIL OFL) covers Latin and Nepali, so one embedded font renders every report.
const FONT_DIR = path.join(process.cwd(), "src", "lib", "exporters", "fonts");
const REGULAR = path.join(FONT_DIR, "NotoSansDevanagari-Regular.ttf");
const BOLD = path.join(FONT_DIR, "NotoSansDevanagari-Bold.ttf");
// Strip control characters only; every other character is renderable with this font.
const latin = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");

const NAVY = "#0f172a";
const MUTED = "#64748b";
const LINE = "#cbd5e1";

function cellText(doc: ReportDoc, c: Column, v: string): string {
  if (c.type === "money" && /^-?\d+(\.\d+)?$/.test(v)) return formatMoney(v, doc.grouping);
  return latin(v);
}

export function reportToPdf(doc: ReportDoc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const wide = doc.sections.some((s) => s.columns.length > 6);
    const pdf = new PDFDocument({ size: "A4", layout: wide ? "landscape" : "portrait", margin: 36, bufferPages: true, info: { Title: latin(doc.title), Author: "KusBill" } });
    pdf.registerFont("NotoR", REGULAR);
    pdf.registerFont("NotoB", BOLD);
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const left = pdf.page.margins.left;
    const width = pdf.page.width - left - pdf.page.margins.right;
    const bottom = () => pdf.page.height - pdf.page.margins.bottom - 20;

    pdf.fillColor(NAVY).font("NotoB").fontSize(16).text(latin(doc.business.name), left, pdf.y);
    const contact = [doc.business.address, doc.business.phone, doc.business.email, doc.business.pan ? `PAN ${doc.business.pan}` : ""].filter(Boolean).join("  |  ");
    if (contact) pdf.font("NotoR").fontSize(8.5).fillColor(MUTED).text(latin(contact));
    if (doc.business.header) pdf.font("NotoR").fontSize(8.5).fillColor(MUTED).text(latin(doc.business.header));
    pdf.moveDown(0.6);
    pdf.font("NotoB").fontSize(13).fillColor(NAVY).text(latin(doc.title));
    pdf.font("NotoR").fontSize(9.5).fillColor(MUTED).text(latin(doc.subtitle));
    pdf.moveDown(0.4);
    for (const [k, v] of doc.meta) {
      pdf.font("NotoB").fontSize(9).fillColor(NAVY).text(`${latin(k)}: `, left, pdf.y, { continued: true });
      pdf.font("NotoR").text(MONEY_META.has(englishOf(k)) && /^-?\d+(\.\d+)?$/.test(v) ? formatMoney(v, doc.grouping) : latin(v));
    }
    for (const w of doc.warnings) {
      pdf.moveDown(0.3);
      pdf.font("NotoB").fontSize(9).fillColor("#b45309").text(`! ${latin(w)}`, left, pdf.y, { width });
    }

    let sectionIndex = 0;
    const drawSection = (s: Section) => {
      if (doc.pageBreaks && sectionIndex++ > 0) {
        // Billpad style: every page of the pad starts on a fresh sheet with the business and title repeated.
        pdf.addPage();
        pdf.font("NotoB").fontSize(10).fillColor(NAVY).text(`${latin(doc.business.name)} - ${latin(doc.title)}`, left, pdf.y);
      }
      pdf.moveDown(0.8);
      if (pdf.y > bottom() - 60) pdf.addPage();
      if (s.heading) pdf.font("NotoB").fontSize(11).fillColor(NAVY).text(latin(s.heading), left, pdf.y);
      pdf.moveDown(0.3);
      const total = s.columns.reduce((a, c) => a + (c.width ?? (c.type === "money" ? 1.1 : c.key === "description" ? 2.4 : 1)), 0);
      const colW = s.columns.map((c) => ((c.width ?? (c.type === "money" ? 1.1 : c.key === "description" ? 2.4 : 1)) / total) * width);
      const pad = 3;

      const drawRow = (data: Record<string, string>, opts: { head?: boolean; bold?: boolean; zebra?: boolean }) => {
        pdf.font(opts.head || opts.bold ? "NotoB" : "NotoR").fontSize(8.5);
        const texts = s.columns.map((c) => (opts.head ? latin(c.label) : cellText(doc, c, data[c.key] ?? "")));
        const h = Math.max(...texts.map((t, i) => pdf.heightOfString(t, { width: colW[i] - pad * 2 }))) + pad * 2;
        if (pdf.y + h > bottom()) {
          pdf.addPage();
          if (!opts.head) drawRow(Object.fromEntries(s.columns.map((c) => [c.key, c.label])), { head: true });
        }
        const y = pdf.y;
        if (opts.head) pdf.rect(left, y, width, h).fill(NAVY);
        else if (opts.zebra) pdf.rect(left, y, width, h).fill("#f1f5f9");
        let x = left;
        s.columns.forEach((c, i) => {
          pdf.fillColor(opts.head ? "#ffffff" : NAVY).text(texts[i], x + pad, y + pad, { width: colW[i] - pad * 2, align: c.align === "right" ? "right" : "left" });
          x += colW[i];
        });
        pdf.moveTo(left, y + h).lineTo(left + width, y + h).strokeColor(LINE).lineWidth(0.5).stroke();
        pdf.y = y + h;
        pdf.x = left;
      };

      drawRow({}, { head: true });
      if (!s.rows.length) {
        pdf.font("NotoR").fontSize(9).fillColor(MUTED).text(latin(s.emptyMessage ?? "No records"), left + pad, pdf.y + 4);
      }
      s.rows.forEach((r, i) => drawRow(r, { zebra: i % 2 === 1 }));
      if (s.totals) drawRow(s.totals, { bold: true });
    };
    doc.sections.forEach(drawSection);

    if (doc.notes.length) {
      pdf.moveDown(1);
      for (const n of doc.notes) pdf.font("NotoR").fontSize(8.5).fillColor(MUTED).text(latin(n), left, pdf.y, { width });
    }
    if (doc.business.footer) pdf.moveDown(0.6).font("NotoR").fontSize(8.5).fillColor(MUTED).text(latin(doc.business.footer), left, pdf.y, { width });

    const range = pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      pdf.switchToPage(range.start + i);
      // Footer sits inside the bottom margin; zero the margin so PDFKit does not auto-add a page for it.
      pdf.page.margins.bottom = 0;
      pdf.font("NotoR").fontSize(8).fillColor(MUTED);
      pdf.text(`${translate(doc.lang ?? "en", "Generated by KusBill on")} ${doc.generatedAt}`, left, pdf.page.height - 30, { width: width / 2, align: "left", lineBreak: false });
      pdf.text(translate(doc.lang ?? "en", "Page {page} of {pages}", { page: i + 1, pages: range.count }), left + width / 2, pdf.page.height - 30, { width: width / 2, align: "right", lineBreak: false });
    }
    pdf.end();
  });
}
