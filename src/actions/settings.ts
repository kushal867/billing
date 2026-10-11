"use server";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { requireCtx } from "@/lib/auth/server";
import { cookieOptions, SESSION_COOKIE, signSession } from "@/lib/auth/session";
import { run } from "@/lib/action";
import { validation } from "@/lib/errors";
import { ensureFinancialYear, saveOpeningBalance } from "@/lib/services/periods";
import { changeBalanceConvention, changeOwnPassword, createUser, updateOwnName, updatePreferences, updateProfile, updateUser } from "@/lib/services/settings";

const refresh = () => revalidatePath("/", "layout");

function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of r.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    throw validation(Object.values(fieldErrors)[0] ?? "Check the form", fieldErrors);
  }
  return r.data;
}

const str = (max: number) => z.string().trim().max(max);

export async function saveProfile(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const v = parse(z.object({ name: str(120).min(1, "Business name is required"), address: str(300), phone: str(40), email: str(120), panNumber: str(40), currency: str(5).min(1), currencySymbol: str(8).min(1), reportHeader: str(300), reportFooter: str(300) }), input);
    await updateProfile(ctx, v);
    refresh();
  });
}

export async function savePreferences(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const v = parse(z.object({
      displayCalendar: z.enum(["BS", "AD"]), numberGrouping: z.enum(["INTERNATIONAL", "INDIAN"]), fyCalendar: z.enum(["BS", "AD"]),
      fyStartMonth: z.coerce.number().int().min(1).max(12), fyStartDay: z.coerce.number().int().min(1).max(32),
      defaultSortField: z.enum(["date", "bill", "debit", "credit", "balance"]), defaultSortDir: z.enum(["asc", "desc"]),
    }), input);
    await updatePreferences(ctx, v);
    refresh();
  });
}

export async function saveConvention(next: "DEBIT_PLUS" | "CREDIT_PLUS", confirm: boolean) {
  return run(async () => {
    const ctx = await requireCtx();
    await changeBalanceConvention(ctx, z.enum(["DEBIT_PLUS", "CREDIT_PLUS"]).parse(next), confirm);
    refresh();
  });
}

export async function saveOpening(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const v = parse(z.object({ financialYearId: z.string().uuid(), amount: z.string().trim().min(1, "Enter the opening balance"), effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date"), notes: str(500).optional() }), input);
    await saveOpeningBalance(ctx, v);
    refresh();
  });
}

export async function addFinancialYear(startYear: number) {
  return run(async () => {
    const ctx = await requireCtx();
    const y = z.coerce.number().int().min(1900).max(2100).parse(startYear);
    const fy = await ensureFinancialYear(ctx, y);
    refresh();
    return { label: fy.label };
  });
}

export async function addUser(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const v = parse(z.object({ name: str(100), email: str(150), password: z.string().max(128), role: z.enum(["OWNER", "ACCOUNTANT", "VIEWER"]) }), input);
    await createUser(ctx, v);
    refresh();
  });
}

export async function setUserAccess(id: string, patch: { role?: "OWNER" | "ACCOUNTANT" | "VIEWER"; isActive?: boolean }) {
  return run(async () => {
    const ctx = await requireCtx();
    await updateUser(ctx, z.string().uuid().parse(id), patch);
    refresh();
  });
}

export async function saveMyName(name: string) {
  return run(async () => {
    const ctx = await requireCtx();
    await updateOwnName(ctx, name);
    refresh();
  });
}

export async function savePassword(input: unknown) {
  return run(async () => {
    const ctx = await requireCtx();
    const v = parse(z.object({ current: z.string().min(1, "Enter your current password"), next: z.string().max(128), confirm: z.string() }), input);
    if (v.next !== v.confirm) throw validation("The new passwords do not match", { confirm: "Passwords do not match" });
    const version = await changeOwnPassword(ctx, v.current, v.next);
    // Other devices are signed out; keep this one signed in.
    (await cookies()).set(SESSION_COOKIE, await signSession(ctx.userId, version), cookieOptions());
  });
}
