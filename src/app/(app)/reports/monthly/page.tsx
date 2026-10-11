import type { Metadata } from "next";
import { ReportPage } from "@/components/report-page";

export const metadata: Metadata = { title: "Monthly Report" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ReportPage slug="monthly" title="Monthly Report" description="Month-by-month totals with opening and closing balances carried forward." sp={await searchParams} />;
}
