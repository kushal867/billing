import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { getBusiness } from "@/lib/services/periods";
import { suggestNextBillNumber } from "@/lib/services/transactions";
import { BulkGrid } from "@/components/bulk-grid";
import { PageHeader } from "@/components/ui/states";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Bulk Entry" };
export const dynamic = "force-dynamic";

export default async function BulkPage() {
  const ctx = await requireCtx();
  if (!canWrite(ctx.role)) redirect("/ledger");
  const { t } = await getT();
  const [biz, nextBill] = await Promise.all([getBusiness(ctx.businessId), suggestNextBillNumber(ctx)]);
  return (
    <>
      <PageHeader title={t("Bulk Entry")} description={t("Enter many bills at once, like filling a page of your billpad. Paste rows from Excel if you have them.")} />
      <BulkGrid calendar={biz.displayCalendar} nextBill={nextBill} />
    </>
  );
}
