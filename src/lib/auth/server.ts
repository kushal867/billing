import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import { readSession, SESSION_COOKIE } from "./session";
import type { Ctx } from "./context";

export type SessionUser = { id: string; name: string; email: string; role: Role; businessId: string };

/** Loads the signed-in user from the database (so deactivation and password changes take effect immediately). */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await readSession(token);
  if (!session) return null;
  const user = await db.user.findUnique({ where: { id: session.userId } });
  if (!user || !user.isActive || user.sessionVersion !== session.version) return null;
  return { id: user.id, name: user.name, email: user.email, role: user.role, businessId: user.businessId };
});

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireCtx(): Promise<Ctx> {
  const u = await requireUser();
  return { userId: u.id, userName: u.name, businessId: u.businessId, role: u.role };
}

/** For route handlers: returns null instead of redirecting. */
export async function getCtx(): Promise<Ctx | null> {
  const u = await getSessionUser();
  return u ? { userId: u.id, userName: u.name, businessId: u.businessId, role: u.role } : null;
}
