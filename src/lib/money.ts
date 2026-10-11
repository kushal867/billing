import { Prisma } from "@prisma/client";

export type Decimal = Prisma.Decimal;
export const D = (v: Prisma.Decimal.Value | null | undefined): Decimal => new Prisma.Decimal(v ?? 0);
export const ZERO = D(0);

/** Positive amount with at most two decimals, optionally containing thousands separators. */
const AMOUNT_RE = /^\d{1,13}(\.\d{1,2})?$/;

export function parseMoney(input: string | number | null | undefined): Decimal | null {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/,/g, "").replace(/^(rs\.?|npr)\s*/i, "").trim();
  if (s === "") return null;
  if (!AMOUNT_RE.test(s)) return null;
  return D(s);
}

export type { Grouping } from "./format";
import { groupDigits, type Grouping } from "./format";

export function formatMoney(value: Prisma.Decimal.Value | null | undefined, grouping: Grouping = "INTERNATIONAL"): string {
  const d = D(value);
  return `${d.isNegative() && !d.isZero() ? "-" : ""}${groupDigits(d.abs().toFixed(2), grouping)}`;
}

export function formatRs(value: Prisma.Decimal.Value | null | undefined, grouping: Grouping = "INTERNATIONAL", symbol = "Rs."): string {
  const d = D(value);
  return `${d.isNegative() && !d.isZero() ? "-" : ""}${symbol} ${groupDigits(d.abs().toFixed(2), grouping)}`;
}

export const sum = (values: Array<Prisma.Decimal.Value>): Decimal => values.reduce<Decimal>((a, v) => a.plus(v), ZERO);
