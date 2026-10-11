import type { Role } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { assertOwner } from "@/lib/auth/context";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { conflict, notFound, validation } from "@/lib/errors";
import { audit } from "./audit";
import { getBusiness } from "./periods";

export type ProfileInput = {
  name: string; address: string; phone: string; email: string; panNumber: string;
  currency: string; currencySymbol: string; reportHeader: string; reportFooter: string;
};
export type PreferencesInput = {
  displayCalendar: "BS" | "AD";
  numberGrouping: "INTERNATIONAL" | "INDIAN";
  fyCalendar: "BS" | "AD";
  fyStartMonth: number;
  fyStartDay: number;
  defaultSortField: "date" | "bill" | "debit" | "credit" | "balance";
  defaultSortDir: "asc" | "desc";
};

export async function updateProfile(ctx: Ctx, input: ProfileInput) {
  assertOwner(ctx);
  if (!input.name.trim()) throw validation("Business name is required", { name: "Required" });
  const before = await getBusiness(ctx.businessId);
  const after = await db.business.update({ where: { id: ctx.businessId }, data: { ...input, name: input.name.trim() } });
  await audit(db, ctx, { action: "UPDATE", entityType: "Business", entityId: ctx.businessId, before, after, note: "Profile" });
  return after;
}

export async function updatePreferences(ctx: Ctx, input: PreferencesInput) {
  assertOwner(ctx);
  if (input.fyStartMonth < 1 || input.fyStartMonth > 12 || input.fyStartDay < 1 || input.fyStartDay > 32)
    throw validation("Invalid financial year start", { fyStartMonth: "Check month and day" });
  if (input.fyCalendar === "AD" && input.fyStartDay > 31) throw validation("Invalid day for AD calendar");
  const before = await getBusiness(ctx.businessId);
  const after = await db.business.update({ where: { id: ctx.businessId }, data: input });
  await audit(db, ctx, { action: "UPDATE", entityType: "Business", entityId: ctx.businessId, before, after, note: "Preferences" });
  return after;
}

/**
 * Balances are always derived from the stored debit/credit amounts, so switching the
 * convention never rewrites history - but it does change every displayed balance, so
 * once entries exist the owner must explicitly confirm.
 */
export async function changeBalanceConvention(ctx: Ctx, next: "DEBIT_PLUS" | "CREDIT_PLUS", confirm: boolean) {
  assertOwner(ctx);
  const biz = await getBusiness(ctx.businessId);
  if (biz.balanceConvention === next) return biz;
  const count = await db.transaction.count({ where: { businessId: ctx.businessId, status: "POSTED" } });
  if (count > 0 && !confirm)
    throw validation(
      `Changing this will change the Balance shown on all ${count} saved entries (and every report). Amounts you entered are not modified. Tick the confirmation box to continue.`,
      { convention: "Confirmation required" },
    );
  const after = await db.business.update({ where: { id: ctx.businessId }, data: { balanceConvention: next } });
  await audit(db, ctx, { action: "CHANGE_CONVENTION", entityType: "Business", entityId: ctx.businessId, before: { balanceConvention: biz.balanceConvention }, after: { balanceConvention: next }, note: `${count} entries affected in display` });
  return after;
}

export async function listUsers(ctx: Ctx) {
  assertOwner(ctx);
  return db.user.findMany({ where: { businessId: ctx.businessId }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true } });
}

export async function createUser(ctx: Ctx, input: { name: string; email: string; password: string; role: Role }) {
  assertOwner(ctx);
  const email = input.email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw validation("Enter a valid email", { email: "Invalid email" });
  if (!input.name.trim()) throw validation("Name is required", { name: "Required" });
  const problem = passwordProblem(input.password);
  if (problem) throw validation(problem, { password: problem });
  if (await db.user.findUnique({ where: { email } })) throw conflict("A user with that email already exists");
  const user = await db.user.create({
    data: { businessId: ctx.businessId, email, name: input.name.trim(), role: input.role, passwordHash: await hashPassword(input.password), emailVerifiedAt: new Date() /* the owner vouches for people they add */ },
    select: { id: true, email: true, role: true, name: true },
  });
  await audit(db, ctx, { action: "CREATE", entityType: "User", entityId: user.id, after: user });
  return user;
}

export async function updateUser(ctx: Ctx, id: string, patch: { role?: Role; isActive?: boolean }) {
  assertOwner(ctx);
  const u = await db.user.findFirst({ where: { id, businessId: ctx.businessId } });
  if (!u) throw notFound("User");
  const nextRole = patch.role ?? u.role;
  const nextActive = patch.isActive ?? u.isActive;
  if (u.role === "OWNER" && (nextRole !== "OWNER" || !nextActive)) {
    const owners = await db.user.count({ where: { businessId: ctx.businessId, role: "OWNER", isActive: true } });
    if (owners <= 1) throw conflict("There must be at least one active owner");
  }
  const after = await db.user.update({
    where: { id },
    data: { role: nextRole, isActive: nextActive, ...(nextActive === false || nextRole !== u.role ? { sessionVersion: { increment: 1 } } : {}) },
    select: { id: true, email: true, role: true, isActive: true },
  });
  await audit(db, ctx, { action: "UPDATE", entityType: "User", entityId: id, before: { role: u.role, isActive: u.isActive }, after });
  return after;
}

export async function updateOwnName(ctx: Ctx, name: string) {
  if (!name.trim()) throw validation("Name is required", { name: "Required" });
  await db.user.update({ where: { id: ctx.userId }, data: { name: name.trim() } });
}

/** Returns the user's new sessionVersion so the caller can re-issue the cookie; all other sessions are invalidated. */
export async function changeOwnPassword(ctx: Ctx, current: string, next: string): Promise<number> {
  const user = await db.user.findUnique({ where: { id: ctx.userId } });
  if (!user) throw notFound("User");
  if (!(await verifyPassword(current, user.passwordHash))) throw validation("Current password is incorrect", { current: "Incorrect password" });
  const problem = passwordProblem(next);
  if (problem) throw validation(problem, { password: problem });
  const updated = await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), sessionVersion: { increment: 1 } } });
  await audit(db, ctx, { action: "CHANGE_PASSWORD", entityType: "User", entityId: user.id });
  return updated.sessionVersion;
}

export async function recentAudit(ctx: Ctx, limit = 100) {
  assertOwner(ctx);
  return db.auditLog.findMany({ where: { businessId: ctx.businessId }, orderBy: { createdAt: "desc" }, take: limit });
}
