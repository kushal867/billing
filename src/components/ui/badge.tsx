import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-muted text-foreground",
  blue: "bg-blue-50 text-blue-800",
  green: "bg-green-50 text-income",
  red: "bg-red-50 text-expense",
  amber: "bg-amber-50 text-warn",
};
export function Badge({ tone = "neutral", className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", tones[tone], className)} {...p} />;
}
