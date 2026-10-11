"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, BellRing, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n/client";
import type { AlertItem } from "@/lib/services/alerts";
import { cn } from "@/lib/utils";

export const DISMISS_KEY = "kusbill:dismissedAlerts";
export const readDismissed = (): string[] => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]"); } catch { return []; } };

const TITLES: Record<AlertItem["kind"], string> = {
  "missing-bills": "Missing bill numbers", large: "Unusually large amounts", "duplicate-bills": "Duplicate bill numbers", drafts: "Drafts waiting",
  future: "Future-dated entries", stale: "No recent entries", uncategorised: "Entries without a category",
};
const DETAILS: Record<AlertItem["kind"], string> = {
  "missing-bills": "{n} bill numbers look skipped: {ranges}. If a bill was skipped on purpose or the series restarted, you can dismiss this.",
  large: "{n} recent entries are much larger than your usual amounts.",
  "duplicate-bills": "{n} bill numbers are used more than once.",
  drafts: "{n} drafts are saved but not counted in balances yet.",
  future: "{n} entries are dated in the future.",
  stale: "Nothing was added for {n} days (last entry on {date}).",
  uncategorised: "{n} entries have no category, so Profit & Loss leaves them out.",
};

/** Reminders with a per-device "dismiss". A dismissed reminder returns only if its content changes. */
export function AlertList({ alerts, compact }: { alerts: AlertItem[]; compact?: boolean }) {
  const t = useT();
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  useEffect(() => setDismissed(readDismissed()), []);
  const visible = alerts.filter((a) => !(dismissed ?? []).includes(a.id));
  const dismiss = (id: string) => { const next = [...(dismissed ?? []), id].slice(-200); try { localStorage.setItem(DISMISS_KEY, JSON.stringify(next)); } catch { /* ignore */ } setDismissed(next); };

  if (dismissed !== null && visible.length === 0) {
    return compact ? null : <Card className="p-8 text-center text-sm text-muted-foreground">{t("All clear. Nothing needs your attention.")}</Card>;
  }
  return (
    <div className="space-y-3">
      {(dismissed === null ? alerts : visible).slice(0, compact ? 3 : 50).map((a) => {
        const Icon = a.severity === "warn" ? AlertTriangle : Info;
        return (
          <Card key={a.id} className={cn("flex flex-wrap items-start gap-3 p-4", a.severity === "warn" ? "border-amber-300 bg-amber-50/60" : "bg-blue-50/40")}>
            <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", a.severity === "warn" ? "text-warn" : "text-primary")} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-navy">{t(TITLES[a.kind])}</p>
              <p className="text-sm">{t(DETAILS[a.kind], a.params)}</p>
              {!compact && a.items.length > 0 && <ul className="mt-1 flex flex-wrap gap-1.5 text-xs">{a.items.map((i) => <li key={i} className="rounded bg-white px-2 py-0.5 num ring-1 ring-border">{i}</li>)}</ul>}
            </div>
            <div className="flex gap-2">
              <Button asChild size="sm" variant="outline"><Link href={a.href}>{t("View entries")}</Link></Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss(a.id)}>{t("Dismiss")}</Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

export function AlertsHeading({ count }: { count: number }) {
  const t = useT();
  return <h2 className="flex items-center gap-2 font-semibold text-navy"><BellRing className="h-4 w-4" aria-hidden /> {t("Alerts")} <span className="text-sm font-normal text-muted-foreground">({count})</span></h2>;
}
