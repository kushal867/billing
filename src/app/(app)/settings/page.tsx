import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { getBusiness, listFinancialYears } from "@/lib/services/periods";
import { listUsers, recentAudit } from "@/lib/services/settings";
import { toIso, financialYearStartFor, todayIso } from "@/lib/dates";
import { conventionText } from "@/lib/services/reports";
import { AddFinancialYear, ConventionForm, OpeningBalanceForm, PasswordForm, PreferencesForm, ProfileForm, UserManager } from "@/components/settings-forms";
import { PageHeader } from "@/components/ui/states";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-20">
      <CardHeader><CardTitle>{title}</CardTitle>{description && <CardDescription>{description}</CardDescription>}</CardHeader>
      <CardContent className="pt-3">{children}</CardContent>
    </Card>
  );
}

export default async function SettingsPage() {
  const ctx = await requireCtx();
  const owner = ctx.role === "OWNER";
  const biz = await getBusiness(ctx.businessId);
  const [years, entries, users, audit, me] = await Promise.all([
    listFinancialYears(ctx.businessId),
    db.transaction.count({ where: { businessId: ctx.businessId, status: "POSTED" } }),
    owner ? listUsers(ctx) : Promise.resolve([]),
    owner ? recentAudit(ctx, 50) : Promise.resolve([]),
    db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } }),
  ]);
  const fyRows = years.map((y) => ({
    id: y.id, label: y.label, start: toIso(y.startDate), end: toIso(y.endDate),
    opening: y.openingBalance ? { amount: y.openingBalance.amount.toFixed(2), effectiveDate: toIso(y.openingBalance.effectiveDate), notes: y.openingBalance.notes } : null,
  }));
  const defaultYear = years.length
    ? Number(years[years.length - 1].label.split("/")[0].replace(/\D/g, "")) + 1
    : financialYearStartFor(todayIso(), biz.fyCalendar, biz.fyStartMonth, biz.fyStartDay);

  return (
    <>
      <PageHeader title="Settings" description="Business details, dates, financial years, opening balance and users." />
      {!owner && <Alert tone="info" className="mb-4">Only the owner can change business settings. You can set opening balances and change your own password.</Alert>}
      <div className="space-y-5">
        <Section id="business" title="Business" description="Shown at the top of reports and printed statements. All optional.">
          <ProfileForm biz={biz} readOnly={!owner} />
        </Section>
        <Section id="dates" title="Dates, numbers and sorting">
          <PreferencesForm biz={biz} readOnly={!owner} />
        </Section>
        <Section id="convention" title="Balance rule" description="How the Balance column is calculated. Shown on every ledger and report.">
          <p className="mb-3 text-sm">Current rule: <strong>{conventionText(biz.balanceConvention)}</strong></p>
          <ConventionForm current={biz.balanceConvention} entries={entries} readOnly={!owner} />
        </Section>
        <Section id="financial-years" title="Financial years" description="Reports and carry-forward follow these year boundaries.">
          <div className="mb-4 overflow-x-auto rounded-md border">
            <table className="tbl">
              <thead><tr><th>Year</th><th>From (AD)</th><th>To (AD)</th><th className="text-right">Opening balance</th></tr></thead>
              <tbody>
                {fyRows.map((y) => <tr key={y.id}><td className="font-medium">{y.label}</td><td className="num">{y.start}</td><td className="num">{y.end}</td><td className="r">{y.opening ? y.opening.amount : <span className="text-muted-foreground">not set</span>}</td></tr>)}
                {fyRows.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-muted-foreground">No financial years yet. Add one below.</td></tr>}
              </tbody>
            </table>
          </div>
          <AddFinancialYear defaultYear={defaultYear} calendar={biz.fyCalendar} readOnly={!canWrite(ctx.role)} />
        </Section>
        <Section id="opening-balance" title="Opening balance" description="The balance brought forward from your old billpad. Stored as its own record, not as a transaction.">
          <OpeningBalanceForm years={fyRows} calendar={biz.displayCalendar} readOnly={!canWrite(ctx.role)} />
        </Section>
        <Section id="account" title="My account">
          <PasswordForm name={me.name} />
        </Section>
        {owner && (
          <Section id="users" title="Users" description="Owners manage everything. Accountants can add and edit entries. Viewers can only read and print.">
            <UserManager users={users} meId={ctx.userId} />
          </Section>
        )}
        {owner && (
          <Section id="backup" title="Backup and recovery" description="Download all your financial data. See the README for full PostgreSQL backup and restore instructions.">
            <Button asChild variant="outline"><a href="/api/backup" download><Download className="h-4 w-4" aria-hidden /> Download full backup (JSON)</a></Button>
          </Section>
        )}
        {owner && (
          <Section id="audit" title="Recent activity" description="The last 50 changes to financial records and settings.">
            <div className="overflow-x-auto rounded-md border">
              <table className="tbl">
                <thead><tr><th>When (UTC)</th><th>Who</th><th>Action</th><th>What</th><th>Note</th></tr></thead>
                <tbody>
                  {audit.map((a) => (
                    <tr key={a.id}><td className="whitespace-nowrap num">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td><td>{a.userName}</td><td>{a.action.toLowerCase().replace("_", " ")}</td><td>{a.entityType}</td><td className="max-w-xs truncate">{a.note}</td></tr>
                  ))}
                  {audit.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Nothing yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>
    </>
  );
}
