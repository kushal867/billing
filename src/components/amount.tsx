import { formatAmount, type Grouping } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Right-aligned, tabular, consistently formatted money. `tone="sign"` colours positive green and negative red. */
export function Amt({ v, grouping, tone = "plain", blankZero, className }: { v: string | null | undefined; grouping: Grouping; tone?: "plain" | "sign" | "income" | "expense"; blankZero?: boolean; className?: string }) {
  if (v === null || v === undefined || v === "") return <span className="text-muted-foreground">-</span>;
  const zero = /^-?0+(\.0+)?$/.test(v);
  if (zero && blankZero) return null;
  const neg = v.startsWith("-");
  const color = tone === "sign" ? (neg ? "text-expense" : zero ? "" : "text-income") : tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : neg ? "text-expense" : "";
  return <span className={cn("num whitespace-nowrap", color, className)}>{formatAmount(v, grouping)}</span>;
}
