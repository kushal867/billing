import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { ensureDefaultChart } from "@/lib/services/accounting";
import { saveOpeningBalance, ensureFinancialYear } from "@/lib/services/periods";
import { bsToAd } from "@/lib/dates";

export async function makeBusiness(role: Ctx["role"] = "OWNER") {
  const biz = await db.business.create({ data: { name: `Test ${randomUUID().slice(0, 6)}` } });
  const user = await db.user.create({
    data: { businessId: biz.id, email: `${randomUUID()}@test.local`, name: "Tester", passwordHash: "x", role },
  });
  await ensureDefaultChart(biz.id);
  const ctx: Ctx = { userId: user.id, userName: user.name, businessId: biz.id, role };
  return { biz, user, ctx };
}

/** FY 2082/83 BS (Shrawan 2082 - Asar 2083). */
export async function makeFy(ctx: Ctx, startYear = 2082) {
  return ensureFinancialYear({ ...ctx, role: "OWNER" }, startYear);
}

export async function setOpening(ctx: Ctx, amount: string, fyId: string, effectiveDate: string) {
  return saveOpeningBalance({ ...ctx, role: "OWNER" }, { financialYearId: fyId, amount, effectiveDate });
}

export const bs = (y: number, m: number, d: number) => bsToAd({ y, m, d });

export function entry(over: Partial<Record<string, unknown>> = {}) {
  return { dateText: "2025-08-01", calendar: "AD", billNumber: String(Math.floor(Math.random() * 1e9)), debit: "100", credit: "", description: "", status: "POSTED", ...over };
}
