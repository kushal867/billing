import { NextResponse } from "next/server";
import { getCtx } from "@/lib/auth/server";
import { getAlerts } from "@/lib/services/alerts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Lightweight list for the header bell. Scoped to the signed-in user's business. */
export async function GET() {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const alerts = await getAlerts(ctx);
  return NextResponse.json({ alerts: alerts.map((a) => ({ id: a.id, severity: a.severity })) }, { headers: { "Cache-Control": "private, no-store" } });
}
