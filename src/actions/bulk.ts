"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCtx } from "@/lib/auth/server";
import { run } from "@/lib/action";
import { MAX_BULK_ROWS, previewBulk as preview, saveBulk as save } from "@/lib/services/bulk";

const schema = z.object({
  rows: z.array(z.object({ date: z.string().max(20), bill: z.string().max(60), debit: z.string().max(30), credit: z.string().max(30), description: z.string().max(500) })).max(MAX_BULK_ROWS),
  defaultDate: z.string().max(20),
  calendar: z.enum(["BS", "AD"]),
});

export async function previewBulk(input: unknown) {
  return run(async () => preview(await requireCtx(), schema.parse(input)));
}

export async function saveBulk(input: unknown, includeDuplicates: boolean) {
  return run(async () => {
    const summary = await save(await requireCtx(), schema.parse(input), includeDuplicates === true);
    for (const p of ["/ledger", "/dashboard", "/imports", "/entries/new"]) revalidatePath(p);
    return summary;
  });
}
