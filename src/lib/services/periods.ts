import type { Business, FinancialYear } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { assertWrite } from "@/lib/auth/context";
import { conflict, notFound, validation } from "@/lib/errors";
import { D, type Decimal } from "@/lib/money";
import { financialYearRange, financialYearStartFor, fromIso, toIso, todayIso } from "@/lib/dates";
import { audit, type Client } from "./audit";

export async function getBusiness(businessId: string): Promise<Business> {
  const b = await db.business.findUnique({ where: { id: businessId } });
  if (!b) throw notFound("Business");
  return b;
}

export async function listFinancialYears(businessId: string) {
  return db.financialYear.findMany({
    where: { businessId },
    orderBy: { startDate: "asc" },
    include: { openingBalance: true },
  });
}

/** Returns the FY with the given start-year (in the business FY calendar), creating it when missing. */
export async function ensureFinancialYear(ctx: Ctx, startYear: number): Promise<FinancialYear> {
  assertWrite(ctx);
  const biz = await getBusiness(ctx.businessId);
  const r = financialYearRange(biz.fyCalendar, biz.fyStartMonth, biz.fyStartDay, startYear);
  const existing = await db.financialYear.findUnique({ where: { businessId_label: { businessId: ctx.businessId, label: r.label } } });
  if (existing) return existing;
  const overlap = await db.financialYear.findFirst({
    where: { businessId: ctx.businessId, startDate: { lte: fromIso(r.end) }, endDate: { gte: fromIso(r.start) } },
  });
  if (overlap) throw conflict(`That year overlaps the existing financial year ${overlap.label}`);
  const fy = await db.financialYear.create({
    data: { businessId: ctx.businessId, label: r.label, startDate: fromIso(r.start), endDate: fromIso(r.end) },
  });
  await audit(db, ctx, { action: "CREATE", entityType: "FinancialYear", entityId: fy.id, after: fy });
  return fy;
}

export async function ensureCurrentFinancialYear(ctx: Ctx): Promise<FinancialYear> {
  const biz = await getBusiness(ctx.businessId);
  const start = financialYearStartFor(todayIso(), biz.fyCalendar, biz.fyStartMonth, biz.fyStartDay);
  return ensureFinancialYear(ctx, start);
}

export async function financialYearForDate(businessId: string, iso: string) {
  return db.financialYear.findFirst({
    where: { businessId, startDate: { lte: fromIso(iso) }, endDate: { gte: fromIso(iso) } },
  });
}

/** The anchor is the earliest explicit opening balance: the balance immediately before its effective date. */
export async function getAnchor(client: Client, businessId: string): Promise<{ amount: Decimal; date: string | null; id: string | null }> {
  const ob = await client.openingBalance.findFirst({ where: { businessId }, orderBy: { effectiveDate: "asc" } });
  if (!ob) return { amount: D(0), date: null, id: null };
  return { amount: D(ob.amount), date: toIso(ob.effectiveDate), id: ob.id };
}

export async function saveOpeningBalance(
  ctx: Ctx,
  input: { financialYearId: string; amount: string; effectiveDate: string; notes?: string },
) {
  assertWrite(ctx);
  const fy = await db.financialYear.findFirst({ where: { id: input.financialYearId, businessId: ctx.businessId } });
  if (!fy) throw notFound("Financial year");
  const amount = (() => {
    const s = input.amount.replace(/,/g, "").trim();
    if (!/^-?\d{1,13}(\.\d{1,2})?$/.test(s)) throw validation("Enter a valid opening balance (up to 2 decimals)", { amount: "Enter a valid amount" });
    return D(s);
  })();
  const eff = input.effectiveDate;
  if (eff < toIso(fy.startDate) || eff > toIso(fy.endDate))
    throw validation("Effective date must fall inside the financial year", { effectiveDate: "Must be inside the financial year" });

  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ctx.businessId}))`;
    const others = await tx.openingBalance.findMany({ where: { businessId: ctx.businessId, NOT: { financialYearId: fy.id } } });
    const dates = [eff, ...others.map((o) => toIso(o.effectiveDate))].sort();
    const newAnchorDate = dates[0];
    const earlier = await tx.transaction.count({
      where: { businessId: ctx.businessId, status: { in: ["POSTED", "DRAFT"] }, transactionDate: { lt: fromIso(newAnchorDate) } },
    });
    if (earlier > 0)
      throw validation(
        `${earlier} entr${earlier === 1 ? "y is" : "ies are"} dated before ${newAnchorDate}. Choose an earlier effective date so existing entries stay after the opening balance.`,
        { effectiveDate: "Entries exist before this date" },
      );
    const before = await tx.openingBalance.findUnique({ where: { financialYearId: fy.id } });
    const saved = await tx.openingBalance.upsert({
      where: { financialYearId: fy.id },
      create: { businessId: ctx.businessId, financialYearId: fy.id, amount, effectiveDate: fromIso(eff), notes: input.notes ?? "", createdBy: ctx.userId },
      update: { amount, effectiveDate: fromIso(eff), notes: input.notes ?? "" },
    });
    await audit(tx, ctx, { action: before ? "UPDATE" : "CREATE", entityType: "OpeningBalance", entityId: saved.id, before, after: saved, note: `FY ${fy.label}` });
    return saved;
  });
}
