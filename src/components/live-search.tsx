"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useT } from "@/lib/i18n/client";

/** Search box that filters the page as you type (debounced), keeping all other filters. */
export function LiveSearch({ placeholder = "Search bill number or description" }: { placeholder?: string }) {
  const t = useT();
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") ?? "");
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);
  const apply = (q: string) => {
    const next = new URLSearchParams(params.toString());
    if (q.trim()) next.set("q", q.trim()); else next.delete("q");
    next.delete("page");
    start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
  };
  const onChange = (v: string) => {
    setValue(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(v), 350);
  };

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        name="q" value={value} onChange={(e) => onChange(e.target.value)} placeholder={t(placeholder)} aria-label={t("Search")} className="px-9"
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(timer.current); apply(value); } }}
      />
      {pending ? <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" aria-label="Searching" />
        : value ? <button type="button" aria-label={t("Clear search")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-muted" onClick={() => { setValue(""); apply(""); }}><X className="h-4 w-4" /></button> : null}
    </div>
  );
}
