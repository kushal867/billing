"use client";
import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { FileUp, CheckCircle2 } from "lucide-react";
import { previewImport, runImport, uploadImportFile, type UploadOutcome } from "@/actions/imports";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatAmount, type Grouping } from "@/lib/format";
import type { Calendar } from "@/lib/dates";
import type { RowResult, Mapping } from "@/lib/services/imports";

type Table = Extract<UploadOutcome, { kind: "table" }>;
type Summary = { jobId: string; total: number; imported: number; skipped: number; failed: number };
const FIELDS: Array<{ key: keyof Mapping; label: string; required?: boolean }> = [
  { key: "date", label: "Date", required: true },
  { key: "billNumber", label: "Bill Number", required: true },
  { key: "debit", label: "Debit" },
  { key: "credit", label: "Credit" },
  { key: "description", label: "Description" },
];

export function ImportWizard({ defaultCalendar, grouping }: { defaultCalendar: Calendar; grouping: Grouping }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [table, setTable] = useState<Table | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [calendar, setCalendar] = useState<Calendar>(defaultCalendar);
  const [results, setResults] = useState<RowResult[] | null>(null);
  const [includeDup, setIncludeDup] = useState(false);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [pdf, setPdf] = useState<{ jobId: string; filename: string } | null>(null);

  const reset = () => { setTable(null); setMapping(null); setResults(null); setSummary(null); setPdf(null); setError(""); setIncludeDup(false); };

  const upload = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await uploadImportFile(fd);
      if (!r.ok) { setError(r.error); return; }
      setError("");
      if (r.data.kind === "pdf") { setPdf(r.data); toast.success("PDF saved for reference"); } else { setTable(r.data); setMapping(r.data.mapping); }
    });
  };

  const payload = () => ({ rows: table!.rows, rowNumbers: table!.rowNumbers, mapping: mapping!, calendar });
  const preview = () =>
    start(async () => {
      const r = await previewImport(payload());
      if (!r.ok) { setError(r.error); return; }
      setError(""); setResults(r.data.results);
    });
  const doImport = () =>
    start(async () => {
      const r = await runImport({ ...payload(), filename: table!.filename, fileKind: table!.fileKind, includeDuplicates: includeDup });
      if (!r.ok) { setError(r.error); toast.error(r.error); return; }
      setSummary(r.data); setResults(null); toast.success(`${r.data.imported} entries imported`);
    });

  if (summary) {
    return (
      <div className="space-y-4">
        <Alert tone={summary.failed || summary.skipped ? "warning" : "success"} title="Import finished">
          <p>{summary.total} rows were checked: <strong>{summary.imported} imported</strong>, <strong>{summary.skipped} skipped</strong> as duplicates, <strong>{summary.failed} failed</strong> validation and were not imported.</p>
          {summary.failed > 0 && <p className="mt-1">Fix the failed rows in your file and import them again; rows already imported will be detected as duplicates.</p>}
        </Alert>
        <div className="flex gap-2"><Button asChild><Link href="/ledger">View ledger</Link></Button><Button variant="outline" onClick={reset}>Import another file</Button></div>
      </div>
    );
  }

  if (pdf) {
    return (
      <div className="space-y-4">
        <Alert tone="info" title="PDF saved for reference only">
          <p><strong>{pdf.filename}</strong> was stored, but its contents were <strong>not read or imported</strong>. KusBill does not read scanned or PDF text automatically, because a misread date or amount would silently corrupt your ledger.</p>
          <p className="mt-1">Open it next to <Link className="underline" href="/entries/new">Billpad Entry</Link> and type the rows in, or convert it to Excel/CSV and import that file here.</p>
        </Alert>
        <div className="flex gap-2"><Button asChild variant="outline"><a href={`/api/imports/${pdf.jobId}`} target="_blank" rel="noreferrer">Open PDF</a></Button><Button variant="ghost" onClick={reset}>Done</Button></div>
      </div>
    );
  }

  if (!table) {
    return (
      <form onSubmit={upload} className="space-y-4">
        {error && <Alert tone="error">{error}</Alert>}
        <Field label="Choose a file" htmlFor="file" hint="Excel (.xlsx), CSV, or a PDF with typed text (not a photo or scan) can be imported, then you carry on adding entries as usual. Up to 5,000 rows.">
          <input id="file" name="file" type="file" accept=".csv,.xlsx,.pdf,.txt" required className="block w-full rounded-md border bg-white p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-2 file:text-sm file:font-medium file:text-white" />
        </Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="hasHeader" value="true" defaultChecked /> The first row contains column names</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="referenceOnly" value="true" /> PDF only: just keep it for reference, do not read entries from it</label>
        <Button type="submit" loading={pending}><FileUp className="h-4 w-4" aria-hidden /> Upload and continue</Button>
      </form>
    );
  }

  const counts = results ? { ok: results.filter((r) => r.status === "ok").length, dup: results.filter((r) => r.status === "duplicate").length, err: results.filter((r) => r.status === "error").length } : null;
  const shown = results?.filter((r) => !onlyProblems || r.status !== "ok" || r.warnings.length) ?? [];

  return (
    <div className="space-y-5">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm"><strong>{table.filename}</strong> - {table.rows.length} data rows</p>
        <Button variant="ghost" size="sm" onClick={reset}>Choose another file</Button>
      </div>

      <section aria-labelledby="map-h" className="space-y-3 rounded-lg border p-4">
        <h3 id="map-h" className="font-semibold">1. Match your columns</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FIELDS.map((f) => (
            <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={`map-${f.key}`}>
              <Select id={`map-${f.key}`} value={mapping![f.key]} onChange={(e) => { setMapping({ ...mapping!, [f.key]: Number(e.target.value) }); setResults(null); }}>
                <option value={-1}>{f.required ? "Choose column..." : "Not in file"}</option>
                {table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
              </Select>
            </Field>
          ))}
          <Field label="Dates in this file are" htmlFor="map-cal" hint="Excel date cells are always read as AD. Text dates use this setting.">
            <Select id="map-cal" value={calendar} onChange={(e) => { setCalendar(e.target.value as Calendar); setResults(null); }}><option value="BS">Bikram Sambat (BS)</option><option value="AD">Gregorian (AD)</option></Select>
          </Field>
        </div>
        <div className="overflow-x-auto rounded-md border">
          <table className="tbl"><thead><tr>{table.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.slice(0, 3).map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="whitespace-nowrap">{c}</td>)}</tr>)}</tbody></table>
        </div>
        <Button onClick={preview} loading={pending} disabled={mapping!.date < 0 || mapping!.billNumber < 0 || (mapping!.debit < 0 && mapping!.credit < 0)}>Check the data (nothing is saved yet)</Button>
      </section>

      {results && counts && (
        <section aria-labelledby="prev-h" className="space-y-3 rounded-lg border p-4">
          <h3 id="prev-h" className="font-semibold">2. Review before importing</h3>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone="green">{counts.ok} ready</Badge><Badge tone="amber">{counts.dup} duplicates</Badge><Badge tone="red">{counts.err} with errors</Badge>
          </div>
          {counts.err > 0 && <Alert tone="warning">Rows with errors will <strong>not</strong> be imported. Everything else can be imported now.</Alert>}
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows needing attention</label>
            {counts.dup > 0 && <label className="flex items-center gap-2"><input type="checkbox" checked={includeDup} onChange={(e) => setIncludeDup(e.target.checked)} /> Import duplicates too</label>}
          </div>
          <div className="max-h-96 overflow-auto rounded-md border">
            <table className="tbl">
              <thead className="sticky top-0"><tr><th>Row</th><th>Status</th><th>Date (AD)</th><th>Bill No.</th><th className="text-right">Debit</th><th className="text-right">Credit</th><th>Notes</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.rowNumber} className={r.status === "error" ? "bg-red-50" : r.status === "duplicate" ? "bg-amber-50" : undefined}>
                    <td className="num">{r.rowNumber}</td>
                    <td>{r.status === "ok" ? <Badge tone="green">Ready</Badge> : r.status === "duplicate" ? <Badge tone="amber">Duplicate</Badge> : <Badge tone="red">Error</Badge>}</td>
                    <td className="num whitespace-nowrap">{r.values?.dateIso ?? ""}</td>
                    <td>{r.values?.billNumber ?? ""}</td>
                    <td className="r">{r.values && Number(r.values.debit) > 0 ? formatAmount(r.values.debit, grouping) : ""}</td>
                    <td className="r">{r.values && Number(r.values.credit) > 0 ? formatAmount(r.values.credit, grouping) : ""}</td>
                    <td className="text-xs">{[...r.errors.map((m) => `Error: ${m}`), ...r.warnings].map((m, i) => <div key={i} className={m.startsWith("Error") ? "text-expense" : "text-warn"}>{m}</div>)}</td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">Nothing needs attention.</td></tr>}
              </tbody>
            </table>
          </div>
          <Button onClick={doImport} loading={pending} disabled={counts.ok + (includeDup ? counts.dup : 0) === 0}>
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Import {counts.ok + (includeDup ? counts.dup : 0)} entries
          </Button>
        </section>
      )}
    </div>
  );
}
