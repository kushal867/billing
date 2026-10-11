import type { Metadata } from "next";
import { ReportPage } from "@/components/report-page";

export const metadata: Metadata = { title: "Daily Report" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ReportPage slug="daily" title="Daily Report" description="Transactions, totals and opening and closing balance for a day or a date range." sp={await searchParams} />;
}
