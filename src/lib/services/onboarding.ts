import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { assertOwner, assertWrite } from "@/lib/auth/context";
import { validation } from "@/lib/errors";
import { parseEnteredDate, toIso, type Calendar } from "@/lib/dates";
import { ensureCurrentFinancialYear, getBusiness, saveOpeningBalance } from "./periods";
import { updatePreferences, updateProfile } from "./settings";

export type SetupStatus = { nameSet: boolean; openingSet: boolean; entryAdded: boolean; complete: boolean; done: number };

const DEFAULT_NAMES = (name: string) => name === "My Business" || /'s Business$/.test(name);

/** Which setup steps are done is derived from real data, so it can never get out of step. */
export async function getSetupStatus(businessId: string): Promise<SetupStatus> {
  const [biz, opening, entries] = await Promise.all([
    getBusiness(businessId),
    db.openingBalance.count({ where: { businessId } }),
    db.transaction.count({ where: { businessId, status: { in: ["POSTED", "DRAFT"] } } }),
  ]);
  const nameSet = !DEFAULT_NAMES(biz.name);
  const openingSet = opening > 0;
  const entryAdded = entries > 0;
  const done = [nameSet, openingSet, entryAdded].filter(Boolean).length;
  return { nameSet, openingSet, entryAdded, complete: done === 3, done };
}

export async function saveBusinessName(ctx: Ctx, name: string, displayCalendar?: Calendar) {
  assertOwner(ctx);
  const n = name.trim();
  if (!n) throw validation("Enter the business name", { name: "Required" });
  if (n.length > 120) throw validation("Business name is too long", { name: "Business name is too long" });
  const biz = await getBusiness(ctx.businessId);
  await updateProfile(ctx, {
    name: n, address: biz.address, phone: biz.phone, email: biz.email, panNumber: biz.panNumber,
    currency: biz.currency, currencySymbol: biz.currencySymbol, reportHeader: biz.reportHeader, reportFooter: biz.reportFooter,
  });
  if (displayCalendar && displayCalendar !== biz.displayCalendar) {
    await updatePreferences(ctx, {
      displayCalendar, numberGrouping: biz.numberGrouping, fyCalendar: biz.fyCalendar, fyStartMonth: biz.fyStartMonth, fyStartDay: biz.fyStartDay,
      defaultSortField: biz.defaultSortField as "date", defaultSortDir: biz.defaultSortDir as "asc",
    });
  }
}

/** Sets the opening balance on the current financial year. Blank amount means 0. */
export async function saveOpeningForCurrentYear(ctx: Ctx, input: { amount: string; dateText: string; calendar: Calendar }) {
  assertWrite(ctx);
  const fy = await ensureCurrentFinancialYear({ ...ctx, role: ctx.role });
  let effective = toIso(fy.startDate);
  if (input.dateText.trim()) {
    const d = parseEnteredDate(input.dateText, input.calendar);
    if (!d.ok) throw validation(d.error, { dateText: d.error });
    effective = d.iso;
  }
  return saveOpeningBalance(ctx, { financialYearId: fy.id, amount: input.amount.trim() === "" ? "0" : input.amount, effectiveDate: effective, notes: "Set during guided setup" });
}
