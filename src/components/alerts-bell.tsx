"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { readDismissed } from "@/components/alert-list";
import { useT } from "@/lib/i18n/client";

/** Header bell with a count. Loads after the page so it never slows navigation. */
export function AlertsBell() {
  const t = useT();
  const path = usePathname();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    fetch("/api/alerts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { alerts: Array<{ id: string }> } | null) => { if (alive && d) { const gone = readDismissed(); setCount(d.alerts.filter((a) => !gone.includes(a.id)).length); } })
      .catch(() => { /* offline: keep the last count */ });
    return () => { alive = false; };
  }, [path]);
  return (
    <Link href="/alerts" aria-label={`${t("Alerts")}${count ? ` (${count})` : ""}`} className="relative inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-muted">
      <Bell className="h-5 w-5" aria-hidden />
      {count > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-expense px-1 text-[10px] font-semibold text-white">{count > 9 ? "9+" : count}</span>}
    </Link>
  );
}
