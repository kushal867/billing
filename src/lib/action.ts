import { AppError } from "@/lib/errors";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; code?: string };

/** Converts thrown AppErrors into serialisable results; hides internals of unexpected errors. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors, code: e.code };
    // Next.js redirect()/notFound() must propagate
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    console.error("Unexpected action error", e);
    return { ok: false, error: "Something went wrong. Your data was not changed. Please try again.", code: "INTERNAL" };
  }
}
