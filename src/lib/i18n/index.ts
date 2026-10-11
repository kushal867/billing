import { ne } from "./ne";

export type Lang = "en" | "ne";
export const LANG_COOKIE = "kb_lang";
export const isLang = (v: unknown): v is Lang => v === "en" || v === "ne";

/** Reverse map (Nepali -> English) so code can recognise a translated label. */
const reverse: Record<string, string> = {};
for (const [en, np] of Object.entries(ne)) if (!(np in reverse)) reverse[np] = en; // first (capitalised) key wins
export const englishOf = (text: string) => reverse[text] ?? text;

const BS_MONTH_NE: Record<string, string> = {
  Baisakh: "बैशाख", Jestha: "जेठ", Asar: "असार", Shrawan: "श्रावण", Bhadra: "भदौ", Aswin: "आश्विन",
  Kartik: "कार्तिक", Mangsir: "मंसिर", Poush: "पौष", Magh: "माघ", Falgun: "फाल्गुन", Chaitra: "चैत्र",
};
const AD_MONTH_NE: Record<string, string> = {
  January: "जनवरी", February: "फेब्रुअरी", March: "मार्च", April: "अप्रिल", May: "मे", June: "जुन",
  July: "जुलाई", August: "अगस्ट", September: "सेप्टेम्बर", October: "अक्टोबर", November: "नोभेम्बर", December: "डिसेम्बर",
  Jan: "जन", Feb: "फेब", Mar: "मार्च", Apr: "अप्रि", Jun: "जुन", Jul: "जुला", Aug: "अग", Sep: "सेप्ट", Oct: "अक्टो", Nov: "नोभे", Dec: "डिसे",
};
const MONTH_RE = new RegExp(`\\b(${[...Object.keys(BS_MONTH_NE), ...Object.keys(AD_MONTH_NE)].join("|")})\\b`, "g");

export function translateMonths(text: string, lang: Lang): string {
  if (lang !== "ne") return text;
  return text.replace(MONTH_RE, (m) => BS_MONTH_NE[m] ?? AD_MONTH_NE[m] ?? m);
}

/** Translate `text` (an English source string). Unknown strings fall back to English. `{name}` placeholders are filled from params. */
export function translate(lang: Lang, text: string, params?: Record<string, string | number>): string {
  let out = lang === "ne" ? (ne[text] ?? text) : text;
  if (params) for (const [k, v] of Object.entries(params)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
