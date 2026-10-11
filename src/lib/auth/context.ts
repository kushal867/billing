import type { Role } from "@prisma/client";
import { forbidden } from "@/lib/errors";

/** Everything a service needs to know about who is acting. Always derived server-side. */
export type Ctx = { userId: string; userName: string; businessId: string; role: Role };

export const canWrite = (role: Role) => role === "OWNER" || role === "ACCOUNTANT";

export function assertWrite(ctx: Ctx) {
  if (!canWrite(ctx.role)) throw forbidden("Your account is read-only");
}
export function assertOwner(ctx: Ctx) {
  if (ctx.role !== "OWNER") throw forbidden("Only the business owner can do that");
}
