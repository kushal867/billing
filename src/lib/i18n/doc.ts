import type { ReportDoc } from "@/lib/services/report-doc";
import { translate, translateMonths, type Lang } from "./index";

/**
 * Translate a built report into the user's language. Labels come from the dictionary
 * (English text is the key); month names are translated; numbers, dates, bill numbers and
 * user-entered text are left untouched. Unknown strings stay in English.
 */
const RULES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/^The opening balance recorded for this year differs from the balance carried forward from earlier years by (.+)\. The carried-forward figure is used for all calculations\.$/, (m) => `यस वर्षका लागि दर्ता गरिएको सुरुको मौज्दात अघिल्ला वर्षबाट सारिएको मौज्दातभन्दा ${m[1]} ले फरक छ। सबै गणनामा सारिएको मौज्दात नै प्रयोग गरिन्छ।`],
  [/^Closing balance (.+)$/, (m) => `अन्तिम मौज्दात ${m[1]}`],
  [/^(\d+) draft entr(?:y is|ies are) not included in these figures\.$/, (m) => `${m[1]} मस्यौदा प्रविष्टि यी तथ्याङ्कमा समावेश छैनन्।`],
  [/^(\d+) billpad entr(?:y|ies) in this period \(debit (.+), credit (.+)\) (?:has|have) no category and (?:is|are) NOT included\. This result is incomplete until (?:it is|they are) classified\.$/, (m) => `यस अवधिका ${m[1]} बिल प्याड प्रविष्टि (डेबिट ${m[2]}, क्रेडिट ${m[3]}) को वर्ग छैन र गणनामा समावेश छैनन्। ती वर्गीकृत नभएसम्म यो नतिजा अपूर्ण हुन्छ।`],
  [/^The trial balance is out by (.+)\.$/, (m) => `तलपटमा ${m[1]} को फरक छ।`],
  [/^Page (\d+)$/, (m) => `पृष्ठ ${m[1]}`],
  [/^Page totals cover the entries on that page\. (\d+) entries on (\d+) pages? of up to (\d+) rows\.$/, (m) => `पृष्ठको जोडमा त्यही पृष्ठका प्रविष्टि मात्र समावेश छन्। ${m[2]} पृष्ठमा ${m[1]} प्रविष्टि (प्रति पृष्ठ बढीमा ${m[3]} पङ्क्ति)।`],
  [/^search "(.*)"$/, (m) => `खोज "${m[1]}"`],
  [/^(debit|credit) entries only$/, (m) => (m[1] === "debit" ? "डेबिट प्रविष्टि मात्र" : "क्रेडिट प्रविष्टि मात्र")],
];

export function translateDoc(doc: ReportDoc, lang: Lang): ReportDoc {
  if (lang === "en") return doc;
  const tr = (s: string) => {
    for (const [re, fn] of RULES) { const m = s.match(re); if (m) return fn(m); }
    return translateMonths(translate(lang, s), lang);
  };
  const row = (r: Record<string, string>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, /^[\d.,\-\s]*$/.test(v) ? v : tr(v)]));
  // Titles like "Annual Ledger Report - FY 2083/84 BS" translate the part before " - ".
  const title = doc.title.includes(" - ") ? `${tr(doc.title.split(" - ")[0])} - ${doc.title.split(" - ").slice(1).join(" - ").replace(/^FY\b/, tr("FY"))}` : tr(doc.title);
  return {
    ...doc,
    lang,
    title,
    subtitle: tr(doc.subtitle.replace(/^As of /, `${translate(lang, "As of")} `).replace(/ to /g, " देखि ")),
    meta: doc.meta.map(([k, v]) => [tr(k), /^[\d.,\-\s]*$/.test(v) ? v : tr(v)] as [string, string]),
    sections: doc.sections.map((s) => ({
      ...s,
      heading: s.heading ? tr(s.heading) : s.heading,
      columns: s.columns.map((c) => ({ ...c, label: tr(c.label) })),
      rows: s.rows.map(row),
      totals: s.totals ? row(s.totals) : s.totals,
      emptyMessage: s.emptyMessage ? tr(s.emptyMessage) : s.emptyMessage,
    })),
    notes: doc.notes.map(tr),
    warnings: doc.warnings.map(tr),
  };
}
