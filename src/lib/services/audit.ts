import type { Prisma, PrismaClient } from "@prisma/client";
import type { Ctx } from "@/lib/auth/context";

export type Client = PrismaClient | Prisma.TransactionClient;

/** Make a record safe to store as JSON (Decimals/Dates/BigInts -> strings). */
export function snapshot<T>(value: T): Prisma.InputJsonValue {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

export async function audit(
  client: Client,
  ctx: Pick<Ctx, "businessId" | "userId" | "userName">,
  entry: { action: string; entityType: string; entityId?: string | null; before?: unknown; after?: unknown; note?: string },
) {
  await client.auditLog.create({
    data: {
      businessId: ctx.businessId,
      userId: ctx.userId,
      userName: ctx.userName,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: entry.before === undefined ? undefined : snapshot(entry.before),
      after: entry.after === undefined ? undefined : snapshot(entry.after),
      note: entry.note ?? "",
    },
  });
}
