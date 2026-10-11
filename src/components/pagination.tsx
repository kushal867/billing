"use client";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

export function Pagination({ page, pageSize, total, params, basePath }: { page: number; pageSize: number; total: number; params: Record<string, string | undefined>; basePath: string }) {
  const t = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const btn = (disabled: boolean) => cn(buttonVariants({ variant: "outline", size: "sm" }), disabled && "pointer-events-none opacity-50");
  return (
    <nav aria-label="Pagination" className="no-print flex flex-wrap items-center justify-between gap-2 border-t px-3 py-3 text-sm">
      <span className="text-muted-foreground">{t("Showing {from}-{to} of {total}", { from, to, total })}</span>
      <div className="flex items-center gap-2">
        <Link href={href(page - 1)} className={btn(page <= 1)} aria-disabled={page <= 1} tabIndex={page <= 1 ? -1 : undefined}><ChevronLeft className="h-4 w-4" /> {t("Previous")}</Link>
        <span className="px-1">{t("Page {page} of {pages}", { page: Math.min(page, pages), pages })}</span>
        <Link href={href(page + 1)} className={btn(page >= pages)} aria-disabled={page >= pages} tabIndex={page >= pages ? -1 : undefined}>{t("Next")} <ChevronRight className="h-4 w-4" /></Link>
      </div>
    </nav>
  );
}
