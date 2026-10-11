import ExcelJS from "exceljs";
import type { ReportDoc } from "@/lib/services/report-doc";

const isNum = (s: string) => /^-?\d+(\.\d+)?$/.test(s);

export async function reportToXlsx(doc: ReportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "KusBill";
  wb.created = new Date();
  const ws = wb.addWorksheet(doc.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  let r = 1;
  const put = (text: string, bold = false, size = 11) => {
    const row = ws.getRow(r++);
    row.getCell(1).value = text;
    row.getCell(1).font = { bold, size };
  };
  put(doc.business.name, true, 14);
  put(doc.title, true, 12);
  put(doc.subtitle);
  for (const [k, v] of doc.meta) {
    const row = ws.getRow(r++);
    row.getCell(1).value = k;
    row.getCell(1).font = { bold: true };
    row.getCell(2).value = v;
  }
  const maxCols = Math.max(2, ...doc.sections.map((s) => s.columns.length));
  const widths: number[] = Array(maxCols).fill(14);
  for (const s of doc.sections) {
    r++;
    if (s.heading) put(s.heading, true, 12);
    const head = ws.getRow(r++);
    s.columns.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.label;
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
      cell.alignment = { horizontal: c.align === "right" ? "right" : "left" };
      widths[i] = Math.max(widths[i], c.label.length + 2);
    });
    const writeRow = (data: Record<string, string>, bold = false) => {
      const row = ws.getRow(r++);
      s.columns.forEach((c, i) => {
        const raw = data[c.key] ?? "";
        const cell = row.getCell(i + 1);
        if ((c.type === "money" || c.type === "int") && isNum(raw)) {
          cell.value = Number(raw);
          cell.numFmt = c.type === "money" ? "#,##0.00;[Red]-#,##0.00" : "0";
          cell.alignment = { horizontal: "right" };
        } else {
          cell.value = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
          if (c.align === "right") cell.alignment = { horizontal: "right" };
        }
        if (bold) cell.font = { bold: true };
        widths[i] = Math.min(60, Math.max(widths[i], raw.length + 2));
      });
    };
    for (const row of s.rows) writeRow(row);
    if (s.totals) writeRow(s.totals, true);
  }
  r++;
  for (const w of doc.warnings) put(`Warning: ${w}`);
  for (const n of doc.notes) put(`Note: ${n}`);
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  ws.views = [{ state: "frozen", ySplit: 0 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
