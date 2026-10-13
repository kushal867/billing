"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCtx } from "@/lib/auth/server";
import { assertWrite } from "@/lib/auth/context";
import { run } from "@/lib/action";
import { validation } from "@/lib/errors";
import { commitImport, parseTable, storePdfReference, suggestMapping, validateRows, MAX_IMPORT_ROWS, type Mapping, type RowResult } from "@/lib/services/imports";

export type UploadOutcome =
  | { kind: "table"; filename: string; fileKind: "CSV" | "XLSX" | "PDF"; headers: string[]; rows: string[][]; rowNumbers: number[]; mapping: Mapping }
  | { kind: "pdf"; jobId: string; filename: string };

export async function uploadImportFile(formData: FormData) {
  return run<UploadOutcome>(async () => {
    const ctx = await requireCtx();
    assertWrite(ctx);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) throw validation("Choose a file to upload");
    const buf = Buffer.from(await file.arrayBuffer());
    const name = file.name || "upload";
    if (name.toLowerCase().endsWith(".pdf") && formData.get("referenceOnly") === "true") {
      const job = await storePdfReference(ctx, name, buf);
      revalidatePath("/imports");
      return { kind: "pdf", jobId: job.id, filename: job.filename };
    }
    const table = await parseTable(name, buf, formData.get("hasHeader") === "true");
    return { kind: "table", filename: name, fileKind: table.kind, headers: table.headers, rows: table.rows, rowNumbers: table.rowNumbers, mapping: suggestMapping(table.headers) };
  });
}

const mappingSchema = z.object({ date: z.number().int(), billNumber: z.number().int(), debit: z.number().int(), credit: z.number().int(), description: z.number().int() });
const payload = z.object({
  rows: z.array(z.array(z.string().max(2000))).max(MAX_IMPORT_ROWS),
  rowNumbers: z.array(z.number().int()).max(MAX_IMPORT_ROWS),
  mapping: mappingSchema,
  calendar: z.enum(["BS", "AD"]),
});

export async function previewImport(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    assertWrite(ctx);
    const v = payload.parse(input);
    const results = await validateRows(ctx, v, { mapping: v.mapping, calendar: v.calendar });
    return { results: results as RowResult[] };
  });
}

export async function runImport(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const v = payload.extend({ filename: z.string().max(200), fileKind: z.enum(["CSV", "XLSX", "PDF"]), includeDuplicates: z.boolean() }).parse(input);
    const summary = await commitImport(ctx, { filename: v.filename, kind: v.fileKind, table: v, options: { mapping: v.mapping, calendar: v.calendar }, includeDuplicates: v.includeDuplicates });
    for (const p of ["/imports", "/ledger", "/dashboard"]) revalidatePath(p);
    return summary;
  });
}
