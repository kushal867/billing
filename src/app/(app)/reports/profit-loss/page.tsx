import type { Metadata } from "next";
import { ReportPage } from "@/components/report-page";

export const metadata: Metadata = { title: "Profit & Loss" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <ReportPage slug="profit-loss" title="Profit & Loss" description="Revenue minus expenses, from entries classified with income or expense categories." sp={await searchParams} />;
}
