import type { Metadata } from "next";
import { ReportPage } from "@/components/report-page";

export const metadata: Metadata = { title: "Trial Balance" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ReportPage slug="trial-balance" title="Trial Balance" description="Debit and credit totals by account, from classified accounting data." sp={await searchParams} />;
}
