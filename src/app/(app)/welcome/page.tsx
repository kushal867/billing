import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { ensureCurrentFinancialYear, getBusiness } from "@/lib/services/periods";
import { getSetupStatus } from "@/lib/services/onboarding";
import { suggestNextBillNumber } from "@/lib/services/transactions";
import { toIso } from "@/lib/dates";
import { OnboardingWizard } from "@/components/onboarding-wizard";
import { Card, CardContent } from "@/components/ui/card";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Welcome" };
export const dynamic = "force-dynamic";

export default async function WelcomePage() {
  const ctx = await requireCtx();
  if (!canWrite(ctx.role)) redirect("/dashboard");
  const { t } = await getT();
  const [biz, status, nextBill] = await Promise.all([getBusiness(ctx.businessId), getSetupStatus(ctx.businessId), suggestNextBillNumber(ctx)]);
  const fy = await ensureCurrentFinancialYear(ctx);
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-navy">{t("Welcome to KusBill")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("Let's get you set up in three quick steps.")}</p>
      </div>
      <Card>
        <CardContent className="p-6">
          <OnboardingWizard
            initial={{ name: biz.name, calendar: biz.displayCalendar, fyStart: toIso(fy.startDate), nextBill, isOwner: ctx.role === "OWNER", hasName: status.nameSet, hasOpening: status.openingSet, hasEntry: status.entryAdded }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
