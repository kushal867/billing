"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireCtx } from "@/lib/auth/server";
import { run } from "@/lib/action";
import { saveBusinessName, saveOpeningForCurrentYear } from "@/lib/services/onboarding";

const refresh = () => revalidatePath("/", "layout");

export async function setupBusiness(input: { name: string; displayCalendar: "BS" | "AD" }) {
  return run(async () => {
    const ctx = await requireCtx();
    const v = z.object({ name: z.string().max(200), displayCalendar: z.enum(["BS", "AD"]) }).parse(input);
    await saveBusinessName(ctx, v.name, v.displayCalendar);
    refresh();
  });
}

export async function setupOpening(input: { amount: string; dateText: string; calendar: "BS" | "AD" }) {
  return run(async () => {
    const ctx = await requireCtx();
    const v = z.object({ amount: z.string().max(30), dateText: z.string().max(20), calendar: z.enum(["BS", "AD"]) }).parse(input);
    await saveOpeningForCurrentYear(ctx, v);
    refresh();
  });
}
