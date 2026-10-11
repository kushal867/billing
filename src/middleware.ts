import { NextResponse, type NextRequest } from "next/server";
import { readSession, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * Redirect to a path on the host the visitor actually used. Behind a reverse proxy
 * (nginx) with `next start -H 127.0.0.1`, req.url points at localhost, so build the
 * origin from the forwarded headers instead.
 */
function redirectTo(req: NextRequest, path: string) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  const origin = host ? `${proto}://${host}` : req.nextUrl.origin;
  return NextResponse.redirect(new URL(path, origin));
}

// Cheap signature/expiry check at the edge. Pages and actions re-verify against the database.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (pathname === "/login" || pathname === "/signup") {
    if (session) return redirectTo(req, "/dashboard");
    return NextResponse.next();
  }
  // Reachable signed in or out: emailed links open here.
  if (pathname === "/forgot-password" || pathname === "/reset-password" || pathname === "/verify-email") return NextResponse.next();
  if (!session) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    return redirectTo(req, pathname !== "/" ? `/login?next=${encodeURIComponent(pathname)}` : "/login");
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|sw.js|offline.html).*)"] };
