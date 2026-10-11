// Pure string helpers shared by server and client code (no Prisma import here).
export type Grouping = "INTERNATIONAL" | "INDIAN";

/** "1234567.5" -> "1,234,567.50" or "12,34,567.50". Operates on strings only, so no floating point. */
export function groupDigits(fixed: string, grouping: Grouping): string {
  const neg = fixed.startsWith("-");
  const [int, frac = "00"] = fixed.replace("-", "").split(".");
  const f = (frac + "00").slice(0, 2);
  let g: string;
  if (grouping === "INDIAN" && int.length > 3) g = `${int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${int.slice(-3)}`;
  else g = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${g}.${f}`;
}

export function formatAmount(raw: string | null | undefined, grouping: Grouping = "INTERNATIONAL"): string {
  if (raw === null || raw === undefined || raw === "") return "";
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return raw;
  const [i, f = ""] = raw.split(".");
  return groupDigits(f ? `${i}.${f}` : i, grouping);
}
