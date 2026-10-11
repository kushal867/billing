import { Card } from "@/components/ui/card";
import { Amt } from "@/components/amount";
import type { Grouping } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SummaryCard({ label, value, grouping, tone = "plain", note, text }: { label: string; value?: string | null; grouping: Grouping; tone?: "plain" | "sign" | "income" | "expense"; note?: React.ReactNode; text?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold", text && "text-lg text-muted-foreground")}>
        {text ? text : <><span className="mr-1 text-sm font-normal text-muted-foreground">Rs.</span><Amt v={value} grouping={grouping} tone={tone} /></>}
      </p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </Card>
  );
}
