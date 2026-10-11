/** A renderer-neutral report. The same object drives the HTML view, print, PDF, Excel and CSV. */
export type Column = { key: string; label: string; align?: "left" | "right"; type?: "text" | "money" | "int"; width?: number };
export type Cell = string;
export type Row = Record<string, Cell>;
export type Section = {
  heading?: string;
  columns: Column[];
  rows: Row[];
  /** Footer row (totals). */
  totals?: Row;
  emptyMessage?: string;
};
export type ReportDoc = {
  slug: string;
  title: string;
  subtitle: string;
  business: { name: string; address: string; phone: string; email: string; pan: string; header: string; footer: string };
  grouping: "INTERNATIONAL" | "INDIAN";
  currencySymbol: string;
  generatedAt: string;
  meta: Array<[string, string]>;
  sections: Section[];
  notes: string[];
  warnings: string[];
  /** Billpad-style output: one ruled page per section, with a page break between sections. */
  pageBreaks?: boolean;
  /** Language the labels were translated into (default English). */
  lang?: "en" | "ne";
};

export function csvEscape(v: string): string {
  // Guard against spreadsheet formula injection from user-entered text.
  const safe = /^[=+\-@\t\r]/.test(v) && !/^-?\d+(\.\d+)?$/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Header lines whose values are money and should be formatted with thousands separators. */
export const MONEY_META = new Set(["Opening Balance", "Total Debit", "Total Credit", "Closing Balance", "Total Revenue", "Total Expenses", "Net Profit", "Net Loss", "Imbalance"]);
