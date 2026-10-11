import { db } from "@/lib/db";
import type { Ctx } from "@/lib/auth/context";
import { addDays, toIso, todayIso } from "@/lib/dates";
import { D } from "@/lib/money";
import { listLedger } from "./ledger";

export type AlertKind = "missing-bills" | "large" | "duplicate-bills" | "drafts" | "future" | "stale" | "uncategorised";
export type AlertItem = {
  /** Stable id so a dismissed reminder stays dismissed (per device) until its content changes. */
  id: string;
  kind: AlertKind;
  severity: "warn" | "info";
  count: number;
  params: Record<string, string | number>;
  items: string[];
  href: string;
};

const MAX_GAP = 50; // larger jumps are far more likely a restarted series than a missing bill
const MAX_RANGES = 12;

/** Ranges of missing numbers between consecutive numeric bill numbers, e.g. [[103,105]]. */
export function findGaps(numbers: number[]): Array<[number, number]> {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const gaps: Array<[number, number]> = [];
  for (let i = 1; i < sorted.length; i++) {
    const missing = sorted[i] - sorted[i - 1] - 1;
    if (missing > 0 && missing <= MAX_GAP) gaps.push([sorted[i - 1] + 1, sorted[i] - 1]);
  }
  return gaps;
}

const fmtRange = ([a, b]: [number, number]) => (a === b ? String(a) : `${a}-${b}`);

export async function getAlerts(ctx: Pick<Ctx, "businessId">, today: string = todayIso()): Promise<AlertItem[]> {
  const b = ctx.businessId;
  const out: AlertItem[] = [];

  // 1. Missing bill numbers (purely numeric series only)
  const nums = await db.$queryRaw<{ n: number }[]>`
    SELECT DISTINCT "billNumber"::int AS n FROM "Transaction"
    WHERE "businessId" = ${b}::uuid AND status = 'POSTED' AND "reversalOfId" IS NULL AND "billNumber" ~ '^[0-9]{1,9}$'
    ORDER BY n`;
  const gaps = findGaps(nums.map((r) => r.n));
  if (gaps.length) {
    const total = gaps.reduce((a, [x, y]) => a + (y - x + 1), 0);
    const ranges = gaps.slice(-MAX_RANGES).map(fmtRange);
    out.push({
      id: `missing:${gaps.map(fmtRange).join(",").slice(0, 200)}`, kind: "missing-bills", severity: "warn", count: total,
      params: { n: total, ranges: ranges.join(", ") }, items: ranges, href: "/ledger?sort=bill&dir=asc",
    });
  }

  // 2. Unusually large amounts in the last 60 days
  const recent = await listLedger(ctx, { from: addDays(today, -60), to: "2999-12-31", pageSize: 0 });
  const large = recent.rows.filter((r) => r.flags.large);
  if (large.length) {
    out.push({
      id: `large:${large.map((r) => r.id).join(",").slice(0, 200)}`, kind: "large", severity: "warn", count: large.length, params: { n: large.length },
      items: large.slice(0, 8).map((r) => `${r.billNumber} - ${D(r.debit.isZero() ? r.credit : r.debit).toFixed(2)} (${r.date})`), href: "/ledger?sort=debit&dir=desc",
    });
  }

  // 3. Bill numbers used more than once (reversals excluded: they share the original's number by design)
  const dups = await db.$queryRaw<{ bill: string; n: bigint }[]>`
    SELECT "billNumber" AS bill, COUNT(*) AS n FROM "Transaction"
    WHERE "businessId" = ${b}::uuid AND status = 'POSTED' AND "reversalOfId" IS NULL AND length(btrim("billNumber")) > 0
    GROUP BY "billNumber" HAVING COUNT(*) > 1 ORDER BY "billNumber" LIMIT 50`;
  if (dups.length) {
    out.push({
      id: `dup:${dups.map((d) => d.bill).join(",").slice(0, 200)}`, kind: "duplicate-bills", severity: "warn", count: dups.length, params: { n: dups.length },
      items: dups.slice(0, 10).map((d) => `${d.bill} (x${d.n})`), href: "/ledger?sort=bill&dir=asc",
    });
  }

  // 4. Drafts waiting, 5. future-dated entries, 6. uncategorised
  const [drafts, future, uncategorised, lastAdded, categories] = await Promise.all([
    db.transaction.count({ where: { businessId: b, status: "DRAFT" } }),
    db.transaction.count({ where: { businessId: b, status: "POSTED", transactionDate: { gt: new Date(`${today}T00:00:00Z`) } } }),
    db.transaction.count({ where: { businessId: b, status: "POSTED", categoryId: null, reversalOfId: null } }),
    db.transaction.aggregate({ where: { businessId: b, status: { in: ["POSTED", "DRAFT"] } }, _max: { createdAt: true }, _count: { _all: true } }),
    db.category.count({ where: { businessId: b, isActive: true } }),
  ]);
  if (drafts) out.push({ id: `drafts:${drafts}`, kind: "drafts", severity: "info", count: drafts, params: { n: drafts }, items: [], href: "/ledger?status=DRAFT" });
  if (future) out.push({ id: `future:${future}`, kind: "future", severity: "warn", count: future, params: { n: future }, items: [], href: "/ledger?sort=date&dir=desc" });

  // 7. Nothing recorded for a few days
  if (lastAdded._max.createdAt && lastAdded._count._all > 0) {
    const last = toIso(new Date(lastAdded._max.createdAt.getTime() + 5.75 * 3600_000));
    const days = Math.floor((Date.parse(today) - Date.parse(last)) / 86_400_000);
    if (days >= 3) out.push({ id: `stale:${last}`, kind: "stale", severity: "info", count: days, params: { n: days, date: last }, items: [], href: "/entries/new" });
  }
  if (uncategorised && categories) out.push({ id: `uncat:${uncategorised}`, kind: "uncategorised", severity: "info", count: uncategorised, params: { n: uncategorised }, items: [], href: "/ledger" });

  // warnings first
  return out.sort((x, y) => (x.severity === y.severity ? 0 : x.severity === "warn" ? -1 : 1));
}
