import type { Metadata } from "next";
import { ReportPage } from "@/components/report-page";

export const metadata: Metadata = { title: "Annual Ledger Report" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ReportPage slug="annual" title="Annual Ledger Report" description="Every transaction in the financial year with a reconciliation summary." sp={await searchParams} fySelector />;
}
