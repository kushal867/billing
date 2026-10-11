import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { audit, snapshot } from "@/lib/services/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Full JSON export of this business's financial data (owner only). Password hashes are never included. */
export async function GET() {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (ctx.role !== "OWNER") return NextResponse.json({ error: "Only the owner can download a backup" }, { status: 403 });
  const b = ctx.businessId;
  const where = { businessId: b };
  const [business, users, financialYears, openingBalances, accounts, categories, transactions, journalEntries, auditLogs, importJobs] = await Promise.all([
    db.business.findUnique({ where: { id: b } }),
    db.user.findMany({ where, select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true } }),
    db.financialYear.findMany({ where }),
    db.openingBalance.findMany({ where }),
    db.account.findMany({ where }),
    db.category.findMany({ where }),
    db.transaction.findMany({ where, orderBy: { seq: "asc" } }),
    db.journalEntry.findMany({ where, include: { lines: true } }),
    db.auditLog.findMany({ where, orderBy: { createdAt: "asc" } }),
    db.importJob.findMany({ where, select: { id: true, filename: true, kind: true, status: true, totalRows: true, importedRows: true, skippedRows: true, failedRows: true, createdAt: true, report: true } }),
  ]);
  await audit(db, ctx, { action: "EXPORT_BACKUP", entityType: "Business", entityId: b, note: `${transactions.length} transactions` });
  const payload = snapshot({ app: "KusBill", version: 1, exportedAt: new Date().toISOString(), business, users, financialYears, openingBalances, accounts, categories, transactions, journalEntries, auditLogs, importJobs });
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="kusbill-backup-${stamp}.json"`, "Cache-Control": "no-store" },
  });
}
