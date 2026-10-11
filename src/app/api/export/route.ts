import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";
import { buildReport, REPORT_SLUGS, type ReportSlug } from "@/lib/services/report-registry";
import { reportToCsv } from "@/lib/exporters/csv";
import { reportToXlsx } from "@/lib/exporters/xlsx";
import { reportToPdf } from "@/lib/exporters/pdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const p = Object.fromEntries(req.nextUrl.searchParams.entries());
  const slug = p.report as ReportSlug;
  if (!REPORT_SLUGS.includes(slug)) return NextResponse.json({ error: "Unknown report" }, { status: 400 });
  const format = p.format;
  if (!["pdf", "xlsx", "csv"].includes(format)) return NextResponse.json({ error: "Unknown format" }, { status: 400 });
  try {
    const { doc, range } = await buildReport(ctx, slug, p);
    const base = `kusbill-${slug}-${range.key === "all" ? "all" : `${range.from}_${range.to}`}`;
    let body: Buffer | string;
    let type: string;
    if (format === "pdf") { body = await reportToPdf(doc); type = "application/pdf"; }
    else if (format === "xlsx") { body = await reportToXlsx(doc); type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"; }
    else { body = reportToCsv(doc); type = "text/csv; charset=utf-8"; }
    return new NextResponse(new Uint8Array(typeof body === "string" ? Buffer.from(body) : body), {
      headers: { "Content-Type": type, "Content-Disposition": `attachment; filename="${base}.${format}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof AppError) return NextResponse.json({ error: e.message }, { status: e.code === "NOT_FOUND" ? 404 : e.code === "FORBIDDEN" ? 403 : 400 });
    console.error("Export failed", e);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
