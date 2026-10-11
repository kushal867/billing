import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { getBusiness } from "@/lib/services/periods";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const biz = await getBusiness(user.businessId);
  return (
    <AppShell user={{ id: user.id, name: user.name, role: user.role }} businessName={biz.name} canWrite={canWrite(user.role)}>
      {children}
    </AppShell>
  );
}
