import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const styles = {
  info: { c: "border-blue-200 bg-blue-50 text-blue-900", i: Info },
  warning: { c: "border-amber-300 bg-amber-50 text-amber-900", i: AlertTriangle },
  error: { c: "border-red-300 bg-red-50 text-red-900", i: XCircle },
  success: { c: "border-green-300 bg-green-50 text-green-900", i: CheckCircle2 },
};
export function Alert({ tone = "info", title, children, className }: { tone?: keyof typeof styles; title?: string; children?: React.ReactNode; className?: string }) {
  const { c, i: Icon } = styles[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-md border p-3 text-sm", c, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
