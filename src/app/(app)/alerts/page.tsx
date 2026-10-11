import type { Metadata } from "next";
import { requireCtx } from "@/lib/auth/server";
import { getAlerts } from "@/lib/services/alerts";
import { AlertList } from "@/components/alert-list";
import { PageHeader } from "@/components/ui/states";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Alerts" };
export const dynamic = "force-dynamic";

export default async function AlertsPage() {
  const ctx = await requireCtx();
  const { t } = await getT();
  const alerts = await getAlerts(ctx);
  return (
    <>
      <PageHeader title={t("Alerts and reminders")} description={t("Things worth a look. Nothing here is an error, they are gentle reminders.")} />
      <AlertList alerts={alerts} />
    </>
  );
}
