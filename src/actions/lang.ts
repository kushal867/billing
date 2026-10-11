"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { isLang, LANG_COOKIE } from "@/lib/i18n";

/** Saves the language and re-renders the page the person is on (and the layouts), so every text switches without a reload. */
export async function setLanguage(lang: string, path?: string) {
  if (!isLang(lang)) return;
  (await cookies()).set(LANG_COOKIE, lang, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  if (path && /^\/[A-Za-z0-9/_\-.[\]]*$/.test(path) && path.length < 200) revalidatePath(path);
  revalidatePath("/", "layout");
}
