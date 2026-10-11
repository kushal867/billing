import type { Metadata } from "next";
import { ReportPage } from "@/components/report-page";

export const metadata: Metadata = { title: "Billpad Print" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ReportPage slug="billpad" title="Billpad Print" description="Print on paper like your billpad: Date, Bill No., Debit, Credit, Balance, with page totals." sp={await searchParams} />;
}
