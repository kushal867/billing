import { createHash, randomBytes } from "node:crypto";
import type { AuthTokenType, User } from "@prisma/client";
import { db } from "@/lib/db";
import { actionEmail, appUrl, mailConfigured, sendMail } from "@/lib/mail";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { validation } from "@/lib/errors";
import { audit } from "./audit";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const VERIFY_TTL_MS = 24 * 3600_000;
export const RESET_TTL_MS = 60 * 60_000;

/** Creates a one-time token. Only its hash is stored; any earlier unused token of the same kind is voided. */
export async function createToken(userId: string, type: AuthTokenType, ttlMs: number, now = Date.now()): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date(now) } }),
    db.authToken.create({ data: { userId, type, tokenHash: sha256(raw), expiresAt: new Date(now + ttlMs) } }),
  ]);
  return raw;
}

/** Looks a token up without using it (to decide whether to show the reset form). */
export async function peekToken(raw: string, type: AuthTokenType, now = Date.now()) {
  if (!raw || raw.length < 20 || raw.length > 100) return null;
  const t = await db.authToken.findUnique({ where: { tokenHash: sha256(raw) } });
  if (!t || t.type !== type || t.usedAt || t.expiresAt.getTime() < now) return null;
  return t;
}

/** Atomically marks the token used. Returns the user id, or null if it was invalid, expired or already used. */
export async function consumeToken(raw: string, type: AuthTokenType, now = Date.now()): Promise<string | null> {
  const t = await peekToken(raw, type, now);
  if (!t) return null;
  const claimed = await db.authToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date(now) } });
  return claimed.count === 1 ? t.userId : null; // a concurrent second use loses the race
}

function linkBase(): string {
  const base = appUrl();
  if (!base) throw new Error("APP_URL is not set; refusing to build links for email");
  return base;
}

export async function sendVerificationEmail(user: Pick<User, "id" | "email" | "name">, now = Date.now()) {
  const raw = await createToken(user.id, "VERIFY_EMAIL", VERIFY_TTL_MS, now);
  await sendMail(actionEmail({
    to: user.email,
    subjectEn: "Verify your email", subjectNe: "आफ्नो इमेल प्रमाणित गर्नुहोस्",
    headingEn: `Welcome to KusBill, ${user.name}`, headingNe: `KusBill मा स्वागत छ, ${user.name}`,
    bodyEn: "Please confirm that this is your email address. The link works for 24 hours.", bodyNe: "कृपया यो तपाईंकै इमेल हो भनी पुष्टि गर्नुहोस्। यो लिङ्क २४ घण्टासम्म चल्छ।",
    buttonEn: "Verify email", buttonNe: "इमेल प्रमाणित गर्नुहोस्",
    url: `${linkBase()}/verify-email?token=${raw}`,
    noteEn: "If you did not create a KusBill account, you can ignore this email.", noteNe: "यदि तपाईंले KusBill खाता बनाउनु भएको होइन भने यो इमेल बेवास्ता गर्नुहोस्।",
  }));
}

export async function sendPasswordResetEmail(user: Pick<User, "id" | "email" | "name">, now = Date.now()) {
  const raw = await createToken(user.id, "RESET_PASSWORD", RESET_TTL_MS, now);
  await sendMail(actionEmail({
    to: user.email,
    subjectEn: "Reset your password", subjectNe: "पासवर्ड रिसेट गर्नुहोस्",
    headingEn: "Reset your KusBill password", headingNe: "आफ्नो KusBill पासवर्ड रिसेट गर्नुहोस्",
    bodyEn: "Use the button below to choose a new password. The link works for 1 hour and can be used once.", bodyNe: "नयाँ पासवर्ड राख्न तलको बटन थिच्नुहोस्। यो लिङ्क १ घण्टा मात्र चल्छ र एकपटक मात्र प्रयोग गर्न मिल्छ।",
    buttonEn: "Choose a new password", buttonNe: "नयाँ पासवर्ड राख्नुहोस्",
    url: `${linkBase()}/reset-password?token=${raw}`,
    noteEn: "If you did not ask for this, ignore this email. Your password will not change.", noteNe: "यदि तपाईंले यो माग्नु भएको होइन भने बेवास्ता गर्नुहोस्। तपाईंको पासवर्ड परिवर्तन हुँदैन।",
  }));
}

/** Always completes quietly so nobody can discover which emails have accounts. */
export async function requestPasswordReset(emailRaw: string, now = Date.now()): Promise<{ sent: boolean }> {
  const email = emailRaw.trim().toLowerCase();
  if (!mailConfigured() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { sent: false };
  const user = await db.user.findUnique({ where: { email } });
  if (!user || !user.isActive) return { sent: false };
  await sendPasswordResetEmail(user, now);
  await audit(db, { businessId: user.businessId, userId: user.id, userName: user.name }, { action: "PASSWORD_RESET_REQUESTED", entityType: "User", entityId: user.id });
  return { sent: true };
}

export async function verifyEmailToken(raw: string, now = Date.now()): Promise<{ ok: true; email: string } | { ok: false }> {
  const userId = await consumeToken(raw, "VERIFY_EMAIL", now);
  if (!userId) return { ok: false };
  const user = await db.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date(now) } });
  await audit(db, { businessId: user.businessId, userId: user.id, userName: user.name }, { action: "EMAIL_VERIFIED", entityType: "User", entityId: user.id });
  return { ok: true, email: user.email };
}

/** Sets a new password using a reset token, and signs the user out everywhere. */
export async function resetPasswordWithToken(raw: string, newPassword: string, now = Date.now()): Promise<void> {
  const problem = passwordProblem(newPassword);
  if (problem) throw validation(problem, { password: problem });
  const userId = await consumeToken(raw, "RESET_PASSWORD", now);
  if (!userId) throw validation("This link has expired or was already used. Ask for a new one.");
  const user = await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(newPassword),
      sessionVersion: { increment: 1 }, // every existing session becomes invalid
      emailVerifiedAt: new Date(now), // they received the email, so the address is theirs
    },
  });
  await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(now) } });
  await audit(db, { businessId: user.businessId, userId: user.id, userName: user.name }, { action: "PASSWORD_RESET", entityType: "User", entityId: user.id });
}
