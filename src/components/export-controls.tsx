"use client";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";

/** `query` must contain exactly the params that produced the on-screen report so exports match it. */
export function ExportControls({ report, query }: { report: string; query: Record<string, string | undefined> }) {
  const t = useT();
  const q = new URLSearchParams({ report });
  for (const [k, v] of Object.entries(query)) if (v) q.set(k, v);
  const link = (format: string) => `/api/export?${q.toString()}&format=${format}`;
  return (
    <div className="no-print flex flex-wrap gap-2">
      <Button asChild variant="outline" size="sm"><a href={link("pdf")} download><FileText className="h-4 w-4" aria-hidden /> PDF</a></Button>
      <Button asChild variant="outline" size="sm"><a href={link("xlsx")} download><FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel</a></Button>
      <Button asChild variant="outline" size="sm"><a href={link("csv")} download><Download className="h-4 w-4" aria-hidden /> CSV</a></Button>
      <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> {t("Print")}</Button>
    </div>
  );
}
