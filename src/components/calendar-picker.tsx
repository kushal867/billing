"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { adToBs, parseEnteredDate, todayIso, type Calendar } from "@/lib/dates";
import { monthGrid, shiftMonth } from "@/lib/calendar-grid";
import { translateMonths } from "@/lib/i18n";
import { useLang, useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

/** Month calendar for BS or AD. Each cell also shows the day number in the other calendar. */
export function CalendarPicker({ value, calendar, onPick, onClose }: { value: string; calendar: Calendar; onPick: (text: string) => void; onClose: () => void }) {
  const t = useT();
  const lang = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const today = todayIso();
  const selectedIso = useMemo(() => { const r = parseEnteredDate(value, calendar); return r.ok ? r.iso : null; }, [value, calendar]);

  const start = useMemo(() => {
    const iso = selectedIso ?? today;
    try {
      if (calendar === "BS") { const b = adToBs(iso); return { year: b.y, month: b.m }; }
    } catch { /* outside BS range: fall through */ }
    const [y, m] = iso.split("-").map(Number);
    return { year: y, month: m };
  }, [selectedIso, calendar, today]);
  const [view, setView] = useState(start);

  let grid;
  try { grid = monthGrid(calendar, view.year, view.month); } catch { grid = monthGrid(calendar, calendar === "BS" ? 2082 : 2025, 1); }

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("[data-selected='true'], [data-today='true'], [data-day]")?.focus();
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const go = (delta: number) => { const n = shiftMonth(view.year, view.month, delta); setView(n); };
  const pick = (iso: string) => {
    let text = iso;
    if (calendar === "BS") { const b = adToBs(iso); text = `${b.y}-${pad(b.m)}-${pad(b.d)}`; }
    onPick(text);
  };
  const nav = "rounded p-1.5 hover:bg-muted disabled:opacity-30";

  return (
    <div ref={ref} role="dialog" aria-label={t("Choose date")} className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border bg-white p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex">
          <button type="button" className={nav} aria-label={t("Previous month")} disabled={!grid.canPrev} onClick={() => go(-12)}><ChevronsLeft className="h-4 w-4" /></button>
          <button type="button" className={nav} aria-label={t("Previous month")} disabled={!grid.canPrev} onClick={() => go(-1)}><ChevronLeft className="h-4 w-4" /></button>
        </div>
        <p className="text-sm font-semibold text-navy" aria-live="polite">{translateMonths(grid.label, lang)}</p>
        <div className="flex">
          <button type="button" className={nav} aria-label={t("Next month")} disabled={!grid.canNext} onClick={() => go(1)}><ChevronRight className="h-4 w-4" /></button>
          <button type="button" className={nav} aria-label={t("Next month")} disabled={!grid.canNext} onClick={() => go(12)}><ChevronsRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted-foreground">
        {WEEKDAYS.map((d) => <div key={d} className={cn("py-1", d === "Sat" && "text-expense")}>{t(d)}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: grid.leading }, (_, i) => <div key={`b${i}`} />)}
        {grid.days.map((d) => {
          const selected = d.iso === selectedIso;
          const isToday = d.iso === today;
          return (
            <button
              key={d.iso} type="button" data-day data-selected={selected} data-today={isToday} onClick={() => pick(d.iso)}
              aria-label={d.iso} aria-pressed={selected}
              className={cn("flex h-10 flex-col items-center justify-center rounded text-sm hover:bg-blue-50", selected && "bg-primary text-white hover:bg-primary", !selected && isToday && "ring-1 ring-primary")}
            >
              <span className="num leading-none">{d.day}</span>
              {d.other !== null && <span className={cn("num text-[9px] leading-none", selected ? "text-blue-100" : "text-muted-foreground")}>{d.other}</span>}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between">
        <button type="button" className="rounded px-2 py-1 text-xs text-primary hover:bg-blue-50" onClick={() => pick(today)}>{t("Go to today")}</button>
        <button type="button" className="rounded px-2 py-1 text-xs hover:bg-muted" onClick={onClose}>{t("Close")}</button>
      </div>
    </div>
  );
}
