"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { verifyPassword, dummyHash } from "@/lib/auth/password";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { hitRateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import { z } from "zod";
import { registerAccount, signupEnabled } from "@/lib/services/signup";
import { requestPasswordReset, resetPasswordWithToken, sendVerificationEmail } from "@/lib/services/auth-tokens";
import { mailConfigured, verificationRequired } from "@/lib/mail";
import { getSessionUser } from "@/lib/auth/server";
import { AppError } from "@/lib/errors";

export type LoginState = { error?: string; email?: string } | undefined;

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) });

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const typedEmail = String(formData.get("email") ?? "");
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter your email and password.", email: typedEmail };
  const { email, password } = parsed.data;

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const [byIp, byEmail] = await Promise.all([
    hitRateLimit(`login:ip:${ip}`, { max: 30, windowMs: 15 * 60_000 }),
    hitRateLimit(`login:email:${email}`, { max: 8, windowMs: 15 * 60_000 }),
  ]);
  if (!byIp.allowed || !byEmail.allowed) {
    const wait = Math.ceil(Math.max(byIp.allowed ? 0 : byIp.retryAfterSec, byEmail.allowed ? 0 : byEmail.retryAfterSec) / 60);
    return { error: `Too many sign-in attempts. Please wait about ${wait} minute${wait === 1 ? "" : "s"} and try again.`, email: typedEmail };
  }

  const user = await db.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash ?? dummyHash());
  if (!user || !user.isActive || !ok) return { error: "Incorrect email or password.", email: typedEmail };

  await resetRateLimit(`login:email:${email}`);
  (await cookies()).set(SESSION_COOKIE, await signSession(user.id, user.sessionVersion), cookieOptions());
  const next = String(formData.get("next") ?? "");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export type SignupState = { error?: string; fieldErrors?: Record<string, string>; values?: { name: string; email: string; businessName: string } } | undefined;

export async function signup(_prev: SignupState, formData: FormData): Promise<SignupState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    businessName: String(formData.get("businessName") ?? ""),
  };
  if (!signupEnabled()) return { error: "Creating accounts is turned off.", values };
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords do not match.", fieldErrors: { confirm: "Passwords do not match" }, values };

  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
  const limit = await hitRateLimit(`signup:ip:${ip}`, { max: 5, windowMs: 60 * 60_000 });
  if (!limit.allowed) return { error: "Too many accounts created from this connection. Please try again later.", values };

  let userId: string;
  let version: number;
  try {
    const user = await registerAccount({ ...values, password });
    userId = user.id;
    version = user.sessionVersion;
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, fieldErrors: e.fieldErrors, values };
    console.error("Signup failed", e);
    return { error: "Something went wrong. Please try again.", values };
  }
  (await cookies()).set(SESSION_COOKIE, await signSession(userId, version), cookieOptions());
  if (verificationRequired()) {
    try {
      const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
      await sendVerificationEmail(u);
    } catch (e) {
      console.error("Could not send verification email", e); // the pending page offers "Resend"
    }
    redirect("/verify-email");
  }
  redirect("/welcome");
}

const clientIp = async () => ((await headers()).get("x-forwarded-for") ?? "unknown").split(",")[0].trim();

export type ForgotState = { done?: boolean; error?: string; email?: string } | undefined;

export async function forgotPassword(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 150);
  if (!mailConfigured()) return { error: "Email is not set up on this server yet. Please ask the owner to reset your password.", email };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a valid email address", email };
  const [byIp, byEmail] = await Promise.all([
    hitRateLimit(`reset:ip:${await clientIp()}`, { max: 10, windowMs: 60 * 60_000 }),
    hitRateLimit(`reset:email:${email}`, { max: 3, windowMs: 60 * 60_000 }),
  ]);
  if (!byIp.allowed || !byEmail.allowed) return { error: "Too many requests. Please wait a while and try again.", email };
  try { await requestPasswordReset(email); } catch (e) { console.error("Password reset email failed", e); }
  return { done: true, email }; // identical answer whether or not the address has an account
}

export type ResetState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

export async function resetPassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords do not match.", fieldErrors: { confirm: "Passwords do not match" } };
  const limit = await hitRateLimit(`resetuse:ip:${await clientIp()}`, { max: 20, windowMs: 60 * 60_000 });
  if (!limit.allowed) return { error: "Too many requests. Please wait a while and try again." };
  try {
    await resetPasswordWithToken(token, password);
  } catch (e) {
    if (e instanceof AppError) return { error: e.message, fieldErrors: e.fieldErrors };
    console.error("Password reset failed", e);
    return { error: "Something went wrong. Please try again." };
  }
  redirect("/login?reset=1");
}

export async function resendVerification(): Promise<{ ok: boolean; error?: string }> {
  const u = await getSessionUser();
  if (!u) return { ok: false, error: "Please sign in first." };
  if (u.emailVerified) return { ok: true };
  const limit = await hitRateLimit(`verify:user:${u.id}`, { max: 5, windowMs: 60 * 60_000 });
  if (!limit.allowed) return { ok: false, error: "Too many emails sent. Please wait a while and try again." };
  try { await sendVerificationEmail({ id: u.id, email: u.email, name: u.name }); return { ok: true }; } catch (e) {
    console.error("Could not send verification email", e);
    return { ok: false, error: "We could not send the email. Please try again later." };
  }
}
