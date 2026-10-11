"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { verifyPassword, dummyHash } from "@/lib/auth/password";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { hitRateLimit, resetRateLimit } from "@/lib/auth/rate-limit";
import { z } from "zod";

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
