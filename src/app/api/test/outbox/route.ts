import { NextResponse, type NextRequest } from "next/server";
import { outbox } from "@/lib/mail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * TEST ONLY. Lets browser tests read the emails the app "sent". It exists only when the server is
 * started with MAIL_TRANSPORT=memory AND a TEST_API_KEY, and requires that key in a header.
 * Never set MAIL_TRANSPORT=memory on a real server.
 */
export async function GET(req: NextRequest) {
  const key = process.env.TEST_API_KEY;
  if (process.env.MAIL_TRANSPORT !== "memory" || !key || req.headers.get("x-test-key") !== key) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const to = req.nextUrl.searchParams.get("to");
  return NextResponse.json({ mails: outbox.filter((m) => !to || m.to === to) });
}
