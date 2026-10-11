import { AppError } from "@/lib/errors";
import { getLang } from "@/lib/i18n/server";
import { translate } from "@/lib/i18n";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string>; code?: string };

/** Converts thrown AppErrors into serialisable results; hides internals of unexpected errors. */
export async function run<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    if (e instanceof AppError) {
      const lang = await getLang();
      const fieldErrors = e.fieldErrors ? Object.fromEntries(Object.entries(e.fieldErrors).map(([k, v]) => [k, translate(lang, v)])) : undefined;
      return { ok: false, error: translate(lang, e.message), fieldErrors, code: e.code };
    }
    // Next.js redirect()/notFound() must propagate
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
    console.error("Unexpected action error", e);
    return { ok: false, error: translate(await getLang(), "Something went wrong. Your data was not changed. Please try again."), code: "INTERNAL" };
  }
}
