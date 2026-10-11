"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BookOpen, FileBarChart, Landmark, LayoutDashboard, LogOut, Menu, PlusCircle, Settings, Upload, X } from "lucide-react";
import { logout } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/entries/new", label: "Add Entry", icon: PlusCircle },
  { href: "/ledger", label: "Ledger", icon: BookOpen },
  { href: "/reports", label: "Reports", icon: FileBarChart },
  { href: "/accounts", label: "Accounts", icon: Landmark },
  { href: "/imports", label: "Imports", icon: Upload },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate, canWrite }: { onNavigate?: () => void; canWrite: boolean }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="space-y-1">
      {NAV.filter((n) => canWrite || n.href !== "/entries/new").map(({ href, label, icon: Icon }) => {
        const active = href === "/entries/new" ? path.startsWith("/entries") : path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium", active ? "bg-primary text-white" : "text-slate-200 hover:bg-white/10")}
          >
            <Icon className="h-4 w-4" aria-hidden /> {label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-1">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-sm font-bold text-white">K</span>
      <span className="text-lg font-semibold text-white">KusBill</span>
    </Link>
  );
}

export function AppShell({ user, businessName, canWrite, children }: { user: { name: string; role: string }; businessName: string; canWrite: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);

  const account = (
    <div className="space-y-2 border-t border-white/10 pt-3 text-sm text-slate-300">
      <p className="truncate px-1">{user.name} <span className="text-xs text-slate-400">({user.role.toLowerCase()})</span></p>
      <form action={logout}>
        <button className="flex w-full items-center gap-2 rounded-md px-3 py-2 hover:bg-white/10" type="submit"><LogOut className="h-4 w-4" aria-hidden /> Sign out</button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="no-print hidden w-60 shrink-0 flex-col justify-between bg-navy p-4 lg:flex lg:sticky lg:top-0 lg:h-screen">
        <div className="space-y-6"><Brand /><NavLinks canWrite={canWrite} /></div>
        {account}
      </aside>

      <div className="min-w-0 flex-1">
        <header className="no-print sticky top-0 z-30 flex items-center justify-between gap-3 border-b bg-white px-4 py-2.5 lg:px-8">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}><Menu className="h-5 w-5" /></Button>
            <span className="truncate text-sm font-medium text-navy">{businessName}</span>
          </div>
          {canWrite && (
            <Button asChild size="sm"><Link href="/entries/new"><PlusCircle className="h-4 w-4" aria-hidden /> Add Entry</Link></Button>
          )}
        </header>

        {open && (
          <div className="no-print fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
            <button className="absolute inset-0 bg-navy/50" aria-label="Close menu" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 flex w-64 flex-col justify-between bg-navy p-4">
              <div className="space-y-6">
                <div className="flex items-center justify-between"><Brand /><Button variant="ghost" size="icon" className="text-white hover:bg-white/10" aria-label="Close menu" onClick={() => setOpen(false)}><X className="h-5 w-5" /></Button></div>
                <NavLinks canWrite={canWrite} onNavigate={() => setOpen(false)} />
              </div>
              {account}
            </div>
          </div>
        )}

        <main className="mx-auto w-full max-w-7xl px-4 py-5 lg:px-8 lg:py-6">{children}</main>
      </div>
    </div>
  );
}
