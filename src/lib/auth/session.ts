import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "kb_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (at least 32 characters). See .env.example");
  return new TextEncoder().encode(s);
}

export async function signSession(userId: string, version: number): Promise<string> {
  return new SignJWT({ v: version })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function readSession(token: string | undefined): Promise<{ userId: string; version: number } | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (!payload.sub || typeof payload.v !== "number") return null;
    return { userId: payload.sub, version: payload.v };
  } catch {
    return null;
  }
}

export const cookieOptions = () => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE,
});
