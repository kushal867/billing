import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { registerAccount } from "@/lib/services/signup";
import { getSetupStatus, saveBusinessName, saveOpeningForCurrentYear } from "@/lib/services/onboarding";
import { createTransaction } from "@/lib/services/transactions";
import { getAnchor, getBusiness } from "@/lib/services/periods";
import { entry, makeBusiness } from "./helpers";

async function fresh() {
  const u = await registerAccount({ name: "Hari", email: `${randomUUID()}@onboard.test`, password: "Passw0rd123" });
  return { userId: u.id, userName: u.name, businessId: u.businessId, role: u.role };
}

describe("guided setup", () => {
  it("derives progress from real data", async () => {
    const ctx = await fresh();
    expect(await getSetupStatus(ctx.businessId)).toMatchObject({ nameSet: false, openingSet: false, entryAdded: false, complete: false, done: 0 });
    await saveBusinessName(ctx, "  Hari Traders ", "BS");
    expect(await getSetupStatus(ctx.businessId)).toMatchObject({ nameSet: true, done: 1 });
    await saveOpeningForCurrentYear(ctx, { amount: "5,000", dateText: "", calendar: "BS" }).catch(() => null);
    await saveOpeningForCurrentYear(ctx, { amount: "5000", dateText: "", calendar: "BS" });
    expect((await getAnchor(db, ctx.businessId)).amount.toFixed(2)).toBe("5000.00");
    const r = await createTransaction(ctx, entry({ dateText: new Date().toISOString().slice(0, 10), calendar: "AD", billNumber: "1" }));
    expect(r.status).toBe("saved");
    expect(await getSetupStatus(ctx.businessId)).toMatchObject({ complete: true, done: 3 });
    expect((await getBusiness(ctx.businessId)).name).toBe("Hari Traders");
  });

  it("blank opening balance means zero, defaulting to the start of the financial year", async () => {
    const ctx = await fresh();
    await saveOpeningForCurrentYear(ctx, { amount: "", dateText: "", calendar: "BS" });
    const a = await getAnchor(db, ctx.businessId);
    expect(a.amount.toFixed(2)).toBe("0.00");
    expect(a.date).toBeTruthy();
  });

  it("rejects bad input and enforces roles", async () => {
    const ctx = await fresh();
    await expect(saveBusinessName(ctx, "   ")).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveOpeningForCurrentYear(ctx, { amount: "12.345", dateText: "", calendar: "BS" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(saveOpeningForCurrentYear(ctx, { amount: "0", dateText: "2083-01-40", calendar: "BS" })).rejects.toMatchObject({ code: "VALIDATION" });
    const viewer = await makeBusiness("VIEWER");
    await expect(saveBusinessName(viewer.ctx, "x")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveOpeningForCurrentYear(viewer.ctx, { amount: "1", dateText: "", calendar: "BS" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
