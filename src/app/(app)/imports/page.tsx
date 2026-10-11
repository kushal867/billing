import type { Metadata } from "next";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { getBusiness } from "@/lib/services/periods";
import { ImportWizard } from "@/components/import-wizard";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/states";

export const metadata: Metadata = { title: "Imports" };
export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const ctx = await requireCtx();
  const biz = await getBusiness(ctx.businessId);
  const jobs = await db.importJob.findMany({
    where: { businessId: ctx.businessId }, orderBy: { createdAt: "desc" }, take: 20,
    select: { id: true, filename: true, kind: true, status: true, totalRows: true, importedRows: true, skippedRows: true, failedRows: true, createdAt: true },
  });
  return (
    <>
      <PageHeader title="Import old records" description="Bring in past billpad entries from a spreadsheet. You review everything before anything is saved." />
      {canWrite(ctx.role) ? (
        <Card className="mb-5"><CardContent className="p-5"><ImportWizard defaultCalendar={biz.displayCalendar} grouping={biz.numberGrouping} /></CardContent></Card>
      ) : <Alert tone="info" className="mb-5">Your account is read-only, so imports are disabled.</Alert>}
      <Card>
        <CardHeader><CardTitle>Import history</CardTitle></CardHeader>
        <CardContent>
          {jobs.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No imports yet.</p> : (
            <div className="overflow-x-auto rounded-md border">
              <table className="tbl">
                <thead><tr><th>When (UTC)</th><th>File</th><th>Result</th><th className="text-right">Rows</th><th className="text-right">Imported</th><th className="text-right">Skipped</th><th className="text-right">Failed</th></tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id}>
                      <td className="num whitespace-nowrap">{j.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
                      <td>{j.kind === "PDF" ? <a className="text-primary underline" href={`/api/imports/${j.id}`} target="_blank" rel="noreferrer">{j.filename}</a> : j.filename}</td>
                      <td>{j.status === "REFERENCE_ONLY" ? <Badge tone="amber">PDF kept for reference - not imported</Badge> : <Badge tone="green">Completed</Badge>}</td>
                      <td className="r">{j.totalRows}</td><td className="r">{j.importedRows}</td><td className="r">{j.skippedRows}</td><td className="r">{j.failedRows}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
