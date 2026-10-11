"use client";
import { useTransition } from "react";
import { Languages } from "lucide-react";
import { setLanguage } from "@/actions/lang";
import { useLang, useSetLang } from "@/lib/i18n/client";
import { stashForms } from "@/lib/form-stash";
import { cn } from "@/lib/utils";

/** One-click switch between English and Nepali. Instant for everything on screen; no page reload. */
export function LanguageToggle({ className, dark }: { className?: string; dark?: boolean }) {
  const lang = useLang();
  const setLang = useSetLang();
  const [pending, start] = useTransition();
  const next = lang === "ne" ? "en" : "ne";
  return (
    <button
      type="button"
      onClick={() => {
        setLang(next); // instant: all client text switches now and the cookie is set
        // Server-rendered text (headings, tables, reports) needs a fresh page; keep any half-typed values across it.
        start(async () => {
          await setLanguage(next, window.location.pathname);
          stashForms();
          window.location.reload();
        });
      }}
      disabled={pending}
      lang={next}
      aria-label={next === "ne" ? "Switch to Nepali" : "Switch to English"}
      className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium disabled:opacity-60", dark ? "border-white/20 text-slate-200 hover:bg-white/10" : "bg-white hover:bg-muted", className)}
    >
      <Languages className="h-4 w-4" aria-hidden /> {next === "ne" ? "नेपाली" : "English"}
    </button>
  );
}
