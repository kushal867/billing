"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { DateInput } from "@/components/date-input";
import { formatDate, parseEnteredDate, type Calendar } from "@/lib/dates";
import { RANGE_LABELS, type RangeKey } from "@/lib/ranges";
import { cn } from "@/lib/utils";

const PRESETS: RangeKey[] = ["today", "month", "last30", "fy", "lastfy"];

export function DateRangeSelector({
  basePath, current, calendar, extra = {}, presets = PRESETS,
}: {
  basePath: string; current: { key: RangeKey; from: string; to: string }; calendar: Calendar; extra?: Record<string, string | undefined>; presets?: RangeKey[];
}) {
  const router = useRouter();
  const [from, setFrom] = useState(current.key === "all" ? "" : formatDate(current.from, calendar));
  const [to, setTo] = useState(current.key === "all" ? "" : formatDate(current.to, calendar));
  const [cal, setCal] = useState<Calendar>(calendar);
  const [err, setErr] = useState("");

  const qs = (o: Record<string, string>) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...extra, ...o })) if (v) q.set(k, v);
    return `${basePath}?${q.toString()}`;
  };

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    const a = parseEnteredDate(from, cal);
    const b = parseEnteredDate(to, cal);
    if (!a.ok || !b.ok) return setErr("Enter both dates as YYYY-MM-DD");
    if (a.iso > b.iso) return setErr("The start date must be on or before the end date");
    setErr("");
    router.push(qs({ range: "custom", from: a.iso, to: b.iso }));
  };

  return (
    <div className="no-print space-y-3 rounded-lg border bg-white p-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
        {presets.map((k) => (
          <Link
            key={k}
            href={qs({ range: k })}
            aria-current={current.key === k ? "true" : undefined}
            className={cn("rounded-md border px-3 py-1.5 text-sm", current.key === k ? "border-primary bg-primary text-white" : "bg-white hover:bg-muted")}
          >
            {RANGE_LABELS[k]}
          </Link>
        ))}
        <span className="ml-auto text-sm text-muted-foreground">
          {current.key === "all" ? "All dates" : `${formatDate(current.from, calendar)} to ${formatDate(current.to, calendar)} ${calendar}`}
        </span>
      </div>
      <form onSubmit={apply} className="grid items-start gap-3 sm:grid-cols-[1fr_1fr_auto]">
        <Field label="From"><DateInput value={from} calendar={cal} onChange={setFrom} onCalendarChange={setCal} /></Field>
        <Field label="To"><DateInput value={to} calendar={cal} onChange={setTo} hideCalendarSwitch /></Field>
        <div className="sm:pt-[26px]"><Button type="submit" variant="outline" className="w-full">Apply</Button></div>
        {err && <p role="alert" className="text-sm text-expense sm:col-span-3">{err}</p>}
      </form>
    </div>
  );
}
