import type { Metadata } from "next";
import Link from "next/link";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { getBusiness } from "@/lib/services/periods";
import { formatDate, toIso } from "@/lib/dates";
import { D } from "@/lib/money";
import { AccountActiveToggle, AddAccountForm, AddCategoryForm, DeleteJournalButton, JournalForm, SettlementPicker } from "@/components/accounts-forms";
import { Amt } from "@/components/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/states";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Accounts" };
export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  const ctx = await requireCtx();
  const { t } = await getT();
  const write = canWrite(ctx.role);
  const biz = await getBusiness(ctx.businessId);
  const g = biz.numberGrouping;
  const [accounts, categories, journals] = await Promise.all([
    db.account.findMany({ where: { businessId: ctx.businessId }, orderBy: { code: "asc" } }),
    db.category.findMany({ where: { businessId: ctx.businessId }, orderBy: [{ kind: "asc" }, { name: "asc" }], include: { account: true, _count: { select: { transactions: true } } } }),
    db.journalEntry.findMany({ where: { businessId: ctx.businessId }, orderBy: [{ entryDate: "desc" }, { createdAt: "desc" }], take: 30, include: { lines: { include: { account: true } } } }),
  ]);
  const opts = accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, isActive: a.isActive }));

  return (
    <>
      <PageHeader
        title={t("Accounts")}
        description={t("Classify billpad entries so Profit & Loss and the Trial Balance can be calculated correctly.")}
        actions={<><Button asChild variant="outline"><Link href="/reports/profit-loss">{t("Profit & Loss")}</Link></Button><Button asChild variant="outline"><Link href="/reports/trial-balance">{t("Trial Balance")}</Link></Button></>}
      />
      <Alert tone="info" className="mb-5" title="Why this is separate from the ledger">
        Your billpad only records a debit or credit amount, which does not say whether money is income or an expense. Give each entry a category (when you add it, or by editing it) and KusBill posts a balanced accounting entry behind the scenes. Entries without a category are never counted as income or expense.
      </Alert>
      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>{t("Categories")}</CardTitle><CardDescription>Choose one on an entry to classify it.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-x-auto rounded-md border">
              <table className="tbl">
                <thead><tr><th>Category</th><th>Counts as</th><th>Account</th><th className="text-right">Entries</th></tr></thead>
                <tbody>{categories.map((c) => <tr key={c.id}><td className="font-medium">{c.name}</td><td><Badge tone={c.kind === "INCOME" ? "green" : "red"}>{c.kind === "INCOME" ? "Income" : "Expense"}</Badge></td><td>{c.account.code} - {c.account.name}</td><td className="r">{c._count.transactions}</td></tr>)}</tbody>
              </table>
            </div>
            {write && <AddCategoryForm accounts={opts} />}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("Chart of accounts")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <SettlementPicker accounts={opts} current={biz.settlementAccountId} readOnly={!write} />
            <div className="overflow-x-auto rounded-md border">
              <table className="tbl">
                <thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {accounts.map((a) => (
                    <tr key={a.id}><td className="num">{a.code}</td><td className="font-medium">{a.name}</td><td>{a.type.charAt(0) + a.type.slice(1).toLowerCase()}</td><td>{a.isActive ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td><td className="text-right">{write && <AccountActiveToggle id={a.id} isActive={a.isActive} />}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            {write && <AddAccountForm />}
          </CardContent>
        </Card>

        {write && (
          <Card>
            <CardHeader><CardTitle>{t("Manual journal entry")}</CardTitle><CardDescription>For items that are not on the billpad, such as owner investment or a bank charge. Total debits must equal total credits.</CardDescription></CardHeader>
            <CardContent><JournalForm accounts={opts} calendar={biz.displayCalendar} grouping={g} /></CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>{t("Recent journal entries")}</CardTitle></CardHeader>
          <CardContent>
            {journals.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No accounting entries yet. They appear here when you classify a billpad entry or post a journal entry.</p> : (
              <div className="overflow-x-auto rounded-md border">
                <table className="tbl">
                  <thead><tr><th>Date</th><th>Description</th><th>Lines</th><th className="text-right">Amount</th><th /></tr></thead>
                  <tbody>
                    {journals.map((j) => {
                      const total = j.lines.reduce((a, l) => a.plus(l.debit), D(0));
                      return (
                        <tr key={j.id}>
                          <td className="num whitespace-nowrap">{formatDate(toIso(j.entryDate), biz.displayCalendar)}</td>
                          <td>{j.memo}{j.reference && <span className="text-muted-foreground"> (ref {j.reference})</span>}{j.transactionId && <Badge className="ml-2" tone="blue">From billpad</Badge>}</td>
                          <td className="text-xs">{j.lines.map((l) => <div key={l.id}>{l.debit.gt(0) ? "Dr" : "Cr"} {l.account.name}</div>)}</td>
                          <td className="r"><Amt v={total.toFixed(2)} grouping={g} /></td>
                          <td className="text-right">{write && !j.transactionId && <DeleteJournalButton id={j.id} />}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
