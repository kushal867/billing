"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useT } from "@/lib/i18n/client";

const KEY = "kusbill:hideSetup";

/** Shown on the dashboard until the three setup steps are done. Can be hidden on this device. */
export function SetupChecklist({ status }: { status: { nameSet: boolean; openingSet: boolean; entryAdded: boolean; done: number } }) {
  const t = useT();
  const [hidden, setHidden] = useState(false);
  useEffect(() => { try { setHidden(localStorage.getItem(KEY) === "1"); } catch { /* ignore */ } }, []);
  if (hidden) return null;
  const items: Array<[boolean, string]> = [[status.nameSet, "Business name added"], [status.openingSet, "Opening balance set"], [status.entryAdded, "First entry added"]];
  return (
    <Card className="border-primary/40 bg-blue-50/50 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold text-navy">{t("Finish setting up KusBill")} <span className="text-sm font-normal text-muted-foreground">({status.done}/3)</span></h2>
          <ul className="mt-2 space-y-1 text-sm">
            {items.map(([ok, label]) => (
              <li key={label} className="flex items-center gap-2">{ok ? <CheckCircle2 className="h-4 w-4 text-income" aria-hidden /> : <Circle className="h-4 w-4 text-muted-foreground" aria-hidden />}<span className={ok ? "text-muted-foreground line-through" : ""}>{t(label)}</span></li>
            ))}
          </ul>
        </div>
        <div className="flex gap-2">
          <Button asChild><Link href="/welcome">{t("Start guided setup")}</Link></Button>
          <Button variant="ghost" onClick={() => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } setHidden(true); }}>{t("Hide")}</Button>
        </div>
      </div>
    </Card>
  );
}
