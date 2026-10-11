import "server-only";
import { cookies } from "next/headers";
import { isLang, LANG_COOKIE, translate, type Lang } from "./index";

export async function getLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : "en";
}

export type TFn = (text: string, params?: Record<string, string | number>) => string;

export async function getT(): Promise<{ t: TFn; lang: Lang }> {
  const lang = await getLang();
  return { lang, t: (text, params) => translate(lang, text, params) };
}
