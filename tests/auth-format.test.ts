import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { SignJWT } from "jose";
import { hitRateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import { readSession, signSession } from "@/lib/auth/session";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { formatMoney, parseMoney } from "@/lib/money";
import { formatAmount } from "@/lib/format";
import { validateEntryForm } from "@/lib/entry-form";
import { csvEscape } from "@/lib/services/report-doc";

describe("authentication primitives", () => {
  it("hashes passwords with bcrypt and verifies them", async () => {
    const h = await hashPassword("Sup3rSecret!");
    expect(h).not.toContain("Sup3rSecret");
    expect(await verifyPassword("Sup3rSecret!", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("enforces a password policy", () => {
    expect(passwordProblem("short1")).toMatch(/8 characters/);
    expect(passwordProblem("allletters")).toMatch(/letters and numbers/);
    expect(passwordProblem("Good1234pass")).toBeNull();
  });
  it("issues signed sessions and rejects tampered or foreign tokens", async () => {
    const token = await signSession("user-1", 3);
    expect(await readSession(token)).toEqual({ userId: "user-1", version: 3 });
    expect(await readSession(token.slice(0, -3) + "abc")).toBeNull();
    expect(await readSession(undefined)).toBeNull();
    const foreign = await new SignJWT({ v: 1 }).setProtectedHeader({ alg: "HS256" }).setSubject("x").setExpirationTime("1h").sign(new TextEncoder().encode("a-different-secret-a-different-secret!!"));
    expect(await readSession(foreign)).toBeNull();
    const expired = await new SignJWT({ v: 1 }).setProtectedHeader({ alg: "HS256" }).setSubject("x").setExpirationTime(Math.floor(Date.now() / 1000) - 10).sign(new TextEncoder().encode(process.env.SESSION_SECRET!));
    expect(await readSession(expired)).toBeNull();
  });
  it("rate limits repeated attempts and resets on success", async () => {
    const key = `test:${randomUUID()}`;
    const results = [];
    for (let i = 0; i < 6; i++) results.push((await hitRateLimit(key, { max: 5, windowMs: 60_000 })).allowed);
    expect(results).toEqual([true, true, true, true, true, false]);
    await resetRateLimit(key);
    expect((await hitRateLimit(key, { max: 5, windowMs: 60_000 })).allowed).toBe(true);
  });
});

describe("money formatting and parsing (no floating point)", () => {
  it("groups thousands consistently in both styles", () => {
    expect(formatMoney("1234567.5")).toBe("1,234,567.50");
    expect(formatMoney("1234567.5", "INDIAN")).toBe("12,34,567.50");
    expect(formatMoney("0")).toBe("0.00");
    expect(formatMoney("-1500")).toBe("-1,500.00");
    expect(formatAmount("999.9")).toBe("999.90");
    expect(formatAmount("12345678.00", "INDIAN")).toBe("1,23,45,678.00");
  });
  it("parses amounts strictly", () => {
    expect(parseMoney("1,250.75")?.toFixed(2)).toBe("1250.75");
    expect(parseMoney("Rs. 10")?.toFixed(2)).toBe("10.00");
    for (const bad of ["", "-1", "1.234", "1e5", "abc", "1..2", "0x10"]) expect(parseMoney(bad)).toBeNull();
  });
  it("does not lose precision on classic float traps", () => {
    expect(parseMoney("0.1")!.plus(parseMoney("0.2")!).toFixed(2)).toBe("0.30");
    expect(parseMoney("9007199254740993.01")).toBeNull(); // more than 13 integer digits is rejected, not rounded
  });
});

describe("client entry validation mirrors the server", () => {
  const base = { dateText: "2082-04-10", calendar: "BS" as const, billNumber: "1", debit: "10", credit: "", description: "", categoryId: "" };
  it("accepts a valid entry and flags each kind of problem", () => {
    expect(validateEntryForm(base, "POSTED")).toEqual({});
    expect(validateEntryForm({ ...base, debit: "" }, "POSTED").debit).toBeTruthy();
    expect(validateEntryForm({ ...base, credit: "5" }, "POSTED").credit).toMatch(/not both/);
    expect(validateEntryForm({ ...base, dateText: "2082-01-40" }, "POSTED").dateText).toBeTruthy();
    expect(validateEntryForm({ ...base, billNumber: "" }, "POSTED").billNumber).toBeTruthy();
    expect(validateEntryForm({ ...base, billNumber: "" }, "DRAFT").billNumber).toBeUndefined();
  });
});

describe("CSV safety", () => {
  it("quotes special characters and neutralises formulas", () => {
    expect(csvEscape('a,"b"')).toBe('"a,""b"""');
    expect(csvEscape("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(csvEscape("-12.50")).toBe("-12.50");
  });
});
