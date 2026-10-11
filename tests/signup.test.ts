import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { registerAccount } from "@/lib/services/signup";
import { createTransaction, getTransaction } from "@/lib/services/transactions";
import { listLedger } from "@/lib/services/ledger";
import { verifyPassword } from "@/lib/auth/password";
import { entry } from "./helpers";

const email = () => `${randomUUID()}@signup.test`;

describe("self-service sign-up", () => {
  it("creates a separate business with a chart of accounts and a financial year", async () => {
    const e = email();
    const u = await registerAccount({ name: "Ram", email: ` ${e.toUpperCase()} `, password: "Passw0rd123", businessName: "Ram Traders" });
    expect(u.role).toBe("OWNER");
    expect(u.email).toBe(e);
    expect(await verifyPassword("Passw0rd123", u.passwordHash)).toBe(true);
    const biz = await db.business.findUniqueOrThrow({ where: { id: u.businessId } });
    expect(biz.name).toBe("Ram Traders");
    expect(await db.account.count({ where: { businessId: biz.id } })).toBeGreaterThan(5);
    expect(await db.financialYear.count({ where: { businessId: biz.id } })).toBe(1);
  });

  it("rejects duplicate emails, weak passwords and bad input", async () => {
    const e = email();
    await registerAccount({ name: "A", email: e, password: "Passw0rd123" });
    await expect(registerAccount({ name: "B", email: e.toUpperCase(), password: "Passw0rd123" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(registerAccount({ name: "B", email: email(), password: "short" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(registerAccount({ name: "B", email: "not-an-email", password: "Passw0rd123" })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(registerAccount({ name: " ", email: email(), password: "Passw0rd123" })).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("a new account cannot see or touch another account's data", async () => {
    const a = await registerAccount({ name: "A", email: email(), password: "Passw0rd123" });
    const b = await registerAccount({ name: "B", email: email(), password: "Passw0rd123" });
    const ctx = (u: typeof a) => ({ userId: u.id, userName: u.name, businessId: u.businessId, role: u.role });
    const r = await createTransaction(ctx(a), entry({ billNumber: "1" }));
    if (r.status !== "saved") throw new Error();
    expect((await listLedger(ctx(b), { pageSize: 0 })).rows).toHaveLength(0);
    await expect(getTransaction(ctx(b), r.transaction.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("can be switched off with ALLOW_SIGNUP=false", async () => {
    process.env.ALLOW_SIGNUP = "false";
    try {
      await expect(registerAccount({ name: "A", email: email(), password: "Passw0rd123" })).rejects.toMatchObject({ code: "VALIDATION" });
    } finally {
      delete process.env.ALLOW_SIGNUP;
    }
  });
});
