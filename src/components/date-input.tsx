"use client";
import { useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { CalendarPicker } from "@/components/calendar-picker";
import { useT } from "@/lib/i18n/client";
import { Input, Select } from "@/components/ui/input";
import { adToBs, bsToAd, formatDateLong, parseEnteredDate, parseIso, type Calendar } from "@/lib/dates";

export function describeDate(text: string, calendar: Calendar): { error?: string; other?: string } {
  if (!text.trim()) return {};
  const r = parseEnteredDate(text, calendar);
  if (!r.ok) return { error: r.error };
  const otherCal: Calendar = calendar === "BS" ? "AD" : "BS";
  return { other: `${formatDateLong(r.iso, otherCal)} ${otherCal}` };
}

/** Text date entry in BS or AD with a live conversion preview so nothing is guessed. */
export function DateInput({
  id, value, calendar, onChange, onCalendarChange, invalid, autoFocus, name, hideCalendarSwitch,
}: {
  id?: string; value: string; calendar: Calendar; onChange: (v: string) => void; onCalendarChange?: (c: Calendar) => void;
  invalid?: boolean; autoFocus?: boolean; name?: string; hideCalendarSwitch?: boolean;
}) {
  const info = useMemo(() => describeDate(value, calendar), [value, calendar]);
  const t = useT();
  const [open, setOpen] = useState(false);
  const switchCalendar = (next: Calendar) => {
    // Convert the current value so the same real day stays selected.
    const r = parseEnteredDate(value, calendar);
    if (r.ok) {
      try {
        const p = next === "BS" ? adToBs(r.iso) : parseIso(r.iso)!;
        onChange(`${String(p.y).padStart(4, "0")}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`);
      } catch { /* out of BS range: keep text */ }
    }
    onCalendarChange?.(next);
  };
  return (
    <div className="relative space-y-1">
      <div className="flex gap-2">
        <Input
          id={id} name={name} inputMode="numeric" autoComplete="off" autoFocus={autoFocus} placeholder={calendar === "BS" ? "2082-04-01" : "2025-07-17"}
          value={value} onChange={(e) => onChange(e.target.value)} invalid={invalid || !!info.error} className="num"
        />
        <button type="button" onClick={() => setOpen((o) => !o)} aria-label={t("Choose date")} aria-expanded={open} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border bg-white hover:bg-muted">
          <CalendarDays className="h-5 w-5" aria-hidden />
        </button>
        {!hideCalendarSwitch && (
          <Select aria-label="Calendar" className="w-24 shrink-0" value={calendar} onChange={(e) => switchCalendar(e.target.value as Calendar)}>
            <option value="BS">BS</option>
            <option value="AD">AD</option>
          </Select>
        )}
      </div>
      {open && <CalendarPicker value={value} calendar={calendar} onPick={(v) => { onChange(v); setOpen(false); }} onClose={() => setOpen(false)} />}
      {info.error ? <p role="alert" className="text-sm text-expense">{info.error}</p> : info.other ? <p className="text-xs text-muted-foreground">= {info.other}</p> : null}
    </div>
  );
}

export { bsToAd };
