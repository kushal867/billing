import { csvEscape, type ReportDoc } from "@/lib/services/report-doc";

export function reportToCsv(doc: ReportDoc): string {
  const lines: string[] = [];
  lines.push(csvEscape(doc.business.name));
  lines.push(csvEscape(doc.title));
  lines.push(csvEscape(doc.subtitle));
  for (const [k, v] of doc.meta) lines.push(`${csvEscape(k)},${csvEscape(v)}`);
  for (const s of doc.sections) {
    lines.push("");
    if (s.heading) lines.push(csvEscape(s.heading));
    lines.push(s.columns.map((c) => csvEscape(c.label)).join(","));
    for (const r of s.rows) lines.push(s.columns.map((c) => csvEscape(r[c.key] ?? "")).join(","));
    if (s.totals) lines.push(s.columns.map((c) => csvEscape(s.totals![c.key] ?? "")).join(","));
  }
  if (doc.warnings.length || doc.notes.length) lines.push("");
  for (const w of doc.warnings) lines.push(csvEscape(`Warning: ${w}`));
  for (const n of doc.notes) lines.push(csvEscape(`Note: ${n}`));
  return "﻿" + lines.join("\r\n") + "\r\n"; // BOM so Excel opens UTF-8 correctly
}
