import { db } from "@/lib/db";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { conflict, validation } from "@/lib/errors";
import { ensureDefaultChart } from "./accounting";
import { ensureCurrentFinancialYear } from "./periods";

export const signupEnabled = () => (process.env.ALLOW_SIGNUP ?? "true").toLowerCase() !== "false";

/**
 * Self-service registration: creates a brand-new, empty business owned by the new user.
 * The account never gets access to any existing business.
 */
export async function registerAccount(input: { name: string; email: string; password: string; businessName?: string }) {
  if (!signupEnabled()) throw validation("Creating accounts is turned off. Ask the owner to add you.");
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const fieldErrors: Record<string, string> = {};
  if (!name) fieldErrors.name = "Enter your name";
  if (name.length > 100) fieldErrors.name = "Name is too long";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 150) fieldErrors.email = "Enter a valid email address";
  const problem = passwordProblem(input.password);
  if (problem) fieldErrors.password = problem;
  if (Object.keys(fieldErrors).length) throw validation(Object.values(fieldErrors)[0], fieldErrors);
  if (await db.user.findUnique({ where: { email } })) throw conflict("An account with this email already exists. Try signing in.");

  const passwordHash = await hashPassword(input.password);
  const biz = await db.business.create({ data: { name: (input.businessName?.trim() || `${name}'s Business`).slice(0, 120) } });
  try {
    const user = await db.user.create({ data: { businessId: biz.id, email, name, passwordHash, role: "OWNER" } });
    await ensureDefaultChart(biz.id);
    await ensureCurrentFinancialYear({ userId: user.id, userName: user.name, businessId: biz.id, role: "OWNER" });
    return user;
  } catch (e) {
    // Roll back so a half-created account can never exist (e.g. two sign-ups racing on the same email).
    await db.user.deleteMany({ where: { businessId: biz.id } });
    await db.auditLog.deleteMany({ where: { businessId: biz.id } });
    await db.financialYear.deleteMany({ where: { businessId: biz.id } });
    await db.category.deleteMany({ where: { businessId: biz.id } });
    await db.account.deleteMany({ where: { businessId: biz.id } });
    await db.business.delete({ where: { id: biz.id } }).catch(() => undefined);
    if ((e as { code?: string }).code === "P2002") throw conflict("An account with this email already exists. Try signing in.");
    throw e;
  }
}
