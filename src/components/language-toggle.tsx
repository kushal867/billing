"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { setLanguage } from "@/actions/lang";
import { useLang } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/** One-click switch between English and Nepali. */
export function LanguageToggle({ className, dark }: { className?: string; dark?: boolean }) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const next = lang === "ne" ? "en" : "ne";
  return (
    <button
      type="button"
      onClick={() => start(async () => {
        await setLanguage(next);
        router.refresh(); // a soft refresh keeps anything already typed in a form
        // The root layout sets <html lang>. If it has not switched shortly after, the soft refresh was
        // skipped by the router cache, so fall back to a full reload rather than leave a half-translated page.
        await new Promise((r) => setTimeout(r, 1500));
        if (document.documentElement.lang !== next) window.location.reload();
      })}
      disabled={pending}
      lang={next}
      aria-label={next === "ne" ? "Switch to Nepali" : "Switch to English"}
      className={cn("inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium disabled:opacity-60", dark ? "border-white/20 text-slate-200 hover:bg-white/10" : "bg-white hover:bg-muted", className)}
    >
      <Languages className="h-4 w-4" aria-hidden /> {next === "ne" ? "नेपाली" : "English"}
    </button>
  );
}
