import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { outbox, appUrl, verificationRequired, mailMode, setMailSender } from "@/lib/mail";
import { registerAccount } from "@/lib/services/signup";
import { createToken, peekToken, requestPasswordReset, resetPasswordWithToken, sendVerificationEmail, verifyEmailToken, RESET_TTL_MS, VERIFY_TTL_MS } from "@/lib/services/auth-tokens";
import { verifyPassword } from "@/lib/auth/password";

const tokenFrom = (to: string, path: string) => {
  const mail = [...outbox].reverse().find((m) => m.to === to);
  const m = mail && new RegExp(`${path}\\?token=([A-Za-z0-9_-]+)`).exec(mail.text);
  return m ? m[1] : null;
};
async function newUser() {
  const email = `${randomUUID()}@mail.test`;
  const u = await registerAccount({ name: "Hari", email, password: "Passw0rd123" });
  return { u, email };
}
beforeEach(() => { outbox.length = 0; setMailSender(null); });

describe("email verification", () => {
  it("new accounts start unverified, get a bilingual email with a one-time link, and verify once", async () => {
    const { u, email } = await newUser();
    expect(u.emailVerifiedAt).toBeNull();
    await sendVerificationEmail(u);
    const mail = outbox.find((m) => m.to === email)!;
    expect(mail.subject).toContain("Verify your email");
    expect(mail.subject).toContain("प्रमाणित");
    expect(mail.text).toContain("https://kusbill.test/verify-email?token=");
    expect(mail.html).toContain("https://kusbill.test/verify-email?token=");
    const token = tokenFrom(email, "/verify-email")!;
    expect(await verifyEmailToken(token)).toEqual({ ok: true, email });
    expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).emailVerifiedAt).not.toBeNull();
    expect(await verifyEmailToken(token)).toEqual({ ok: false }); // single use
  });

  it("stores only a hash, never the token", async () => {
    const { u } = await newUser();
    const raw = await createToken(u.id, "VERIFY_EMAIL", VERIFY_TTL_MS);
    const rows = await db.authToken.findMany({ where: { userId: u.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(raw);
    expect(JSON.stringify(rows)).not.toContain(raw);
  });

  it("rejects expired, garbage and wrong-type tokens; a newer email voids the older link", async () => {
    const { u } = await newUser();
    const t0 = Date.now();
    const old = await createToken(u.id, "VERIFY_EMAIL", VERIFY_TTL_MS, t0);
    expect(await verifyEmailToken(old, t0 + VERIFY_TTL_MS + 1000)).toEqual({ ok: false });
    expect(await verifyEmailToken("", t0)).toEqual({ ok: false });
    expect(await verifyEmailToken("x".repeat(43), t0)).toEqual({ ok: false });
    const a = await createToken(u.id, "VERIFY_EMAIL", VERIFY_TTL_MS, t0);
    const b = await createToken(u.id, "VERIFY_EMAIL", VERIFY_TTL_MS, t0);
    expect(await verifyEmailToken(a, t0)).toEqual({ ok: false });
    expect((await verifyEmailToken(b, t0)).ok).toBe(true);
    const reset = await createToken(u.id, "RESET_PASSWORD", RESET_TTL_MS, t0);
    expect(await peekToken(reset, "VERIFY_EMAIL", t0)).toBeNull();
  });
});

describe("forgot / reset password", () => {
  it("sends a reset email only for real, active accounts, and reveals nothing otherwise", async () => {
    const { u, email } = await newUser();
    expect(await requestPasswordReset(email.toUpperCase())).toEqual({ sent: true });
    expect(outbox.filter((m) => m.to === email)).toHaveLength(1);
    expect(outbox[0].text).toContain("/reset-password?token=");
    outbox.length = 0;
    expect(await requestPasswordReset(`${randomUUID()}@nobody.test`)).toEqual({ sent: false });
    expect(await requestPasswordReset("not-an-email")).toEqual({ sent: false });
    await db.user.update({ where: { id: u.id }, data: { isActive: false } });
    expect(await requestPasswordReset(email)).toEqual({ sent: false });
    expect(outbox).toHaveLength(0);
  });

  it("changes the password with the link, once, and signs out every existing session", async () => {
    const { u, email } = await newUser();
    const before = (await db.user.findUniqueOrThrow({ where: { id: u.id } })).sessionVersion;
    await db.session.create({ data: { userId: u.id } });
    await requestPasswordReset(email);
    const token = tokenFrom(email, "/reset-password")!;
    await resetPasswordWithToken(token, "BrandNew456");
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(await verifyPassword("BrandNew456", after.passwordHash)).toBe(true);
    expect(await verifyPassword("Passw0rd123", after.passwordHash)).toBe(false);
    expect(after.sessionVersion).toBe(before + 1);
    expect(after.emailVerifiedAt).not.toBeNull(); // proving the inbox also proves the address
    expect(await db.session.count({ where: { userId: u.id, revokedAt: null } })).toBe(0);
    await expect(resetPasswordWithToken(token, "AnotherOne789")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("a weak password does not burn the link; expired links and a newer request are refused", async () => {
    const { u, email } = await newUser();
    await requestPasswordReset(email);
    const token = tokenFrom(email, "/reset-password")!;
    await expect(resetPasswordWithToken(token, "short")).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await peekToken(token, "RESET_PASSWORD")).not.toBeNull();
    await requestPasswordReset(email); // newer link
    await expect(resetPasswordWithToken(token, "ValidPass123")).rejects.toThrow(/expired or was already used/);
    const t0 = Date.now();
    const raw = await createToken(u.id, "RESET_PASSWORD", RESET_TTL_MS, t0);
    await expect(resetPasswordWithToken(raw, "ValidPass123", t0 + RESET_TTL_MS + 1000)).rejects.toThrow(/expired/);
  });

  it("two simultaneous uses of one link: exactly one wins", async () => {
    const { email } = await newUser();
    await requestPasswordReset(email);
    const token = tokenFrom(email, "/reset-password")!;
    const results = await Promise.allSettled([resetPasswordWithToken(token, "FirstPass123"), resetPasswordWithToken(token, "SecondPass123")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
});

describe("mail configuration", () => {
  it("only enforces verification when email can really be sent", () => {
    expect(mailMode()).toBe("memory");
    expect(verificationRequired()).toBe(true);
    const keep = { ...process.env };
    process.env.MAIL_TRANSPORT = "";
    delete process.env.SMTP_HOST;
    expect(mailMode()).toBe("off");
    expect(verificationRequired()).toBe(false);
    Object.assign(process.env, { MAIL_TRANSPORT: "", SMTP_HOST: "smtp.example.com", SMTP_USER: "u", SMTP_PASS: "p" });
    expect(mailMode()).toBe("smtp");
    expect(verificationRequired()).toBe(true);
    process.env.REQUIRE_EMAIL_VERIFICATION = "false";
    expect(verificationRequired()).toBe(false);
    for (const k of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "REQUIRE_EMAIL_VERIFICATION"]) delete process.env[k];
    process.env.MAIL_TRANSPORT = keep.MAIL_TRANSPORT;
  });

  it("builds links from APP_URL and refuses to guess in production", () => {
    expect(appUrl()).toBe("https://kusbill.test");
    const env = process.env as Record<string, string | undefined>;
    const keepUrl = env.APP_URL; const keepEnv = env.NODE_ENV;
    delete env.APP_URL; env.NODE_ENV = "production";
    expect(appUrl()).toBeNull();
    env.NODE_ENV = "development";
    expect(appUrl()).toBe("http://localhost:3000");
    env.APP_URL = keepUrl; env.NODE_ENV = keepEnv;
  });

  it("surfaces a sending failure to the caller instead of pretending the email went out", async () => {
    const { u } = await newUser();
    setMailSender(async () => { throw new Error("SMTP down"); });
    await expect(sendVerificationEmail(u)).rejects.toThrow("SMTP down");
  });
});
