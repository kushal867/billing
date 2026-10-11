import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth/server";
import { getPdf } from "@/lib/services/imports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Streams a stored reference PDF back to the user who owns it (same business only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const pdf = await getPdf(ctx, id);
  if (!pdf?.fileData) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(pdf.fileData), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${pdf.filename.replace(/[^\w.\- ]/g, "_")}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Cache-Control": "private, no-store" },
  });
}
