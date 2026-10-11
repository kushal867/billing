import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDays, CalendarRange, FileSpreadsheet, Scale, TrendingUp, BookOpen } from "lucide-react";
import { requireCtx } from "@/lib/auth/server";
import { PageHeader } from "@/components/ui/states";
import { Card } from "@/components/ui/card";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Reports" };

const REPORTS = [
  { href: "/reports/daily", title: "Daily Report", icon: CalendarDays, text: "Transactions, total debit and credit, opening and closing balance for a day." },
  { href: "/reports/monthly", title: "Monthly Report", icon: CalendarRange, text: "Month-by-month totals and balances for the year." },
  { href: "/reports/annual", title: "Annual Ledger Report", icon: BookOpen, text: "All transactions in a financial year with a reconciliation summary." },
  { href: "/reports/profit-loss", title: "Profit & Loss", icon: TrendingUp, text: "Revenue, expenses and net profit from classified entries." },
  { href: "/reports/trial-balance", title: "Trial Balance", icon: Scale, text: "Account-by-account debits and credits from the accounting ledger." },
  { href: "/reports/billpad", title: "Billpad Print", icon: BookOpen, text: "Print on paper like your billpad: Date, Bill No., Debit, Credit, Balance, with page totals." },
  { href: "/ledger", title: "Ledger Statement", icon: FileSpreadsheet, text: "Search and filter the ledger, then print or export exactly what you see." },
];

export default async function ReportsIndex() {
  await requireCtx();
  const { t } = await getT();
  return (
    <>
      <PageHeader title={t("Reports")} description={t("Every report is calculated from your saved entries. Each can be printed or downloaded as PDF, Excel or CSV.")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map(({ href, title, icon: Icon, text }) => (
          <Link key={href} href={href} className="group">
            <Card className="h-full p-5 transition-colors group-hover:border-primary">
              <Icon className="mb-3 h-6 w-6 text-primary" aria-hidden />
              <h2 className="font-semibold text-navy">{t(title)}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{t(text)}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
