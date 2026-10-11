import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/auth/server";
import { canWrite } from "@/lib/auth/context";
import { db } from "@/lib/db";
import { getBusiness } from "@/lib/services/periods";
import { getAuditTrail, getTransaction } from "@/lib/services/transactions";
import { AppError } from "@/lib/errors";
import { formatDate, toIso } from "@/lib/dates";
import { EntryForm } from "@/components/entry-form";
import { EntryActions } from "@/components/entry-actions";
import { PageHeader } from "@/components/ui/states";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Amt } from "@/components/amount";
import { getT } from "@/lib/i18n/server";

export const metadata: Metadata = { title: "Entry" };
export const dynamic = "force-dynamic";

export default async function EntryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t: tr } = await getT();
  const ctx = await requireCtx();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  let t;
  try {
    t = await getTransaction(ctx, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const biz = await getBusiness(ctx.businessId);
  const cal = biz.displayCalendar;
  const g = biz.numberGrouping;
  const [categories, trail, users] = await Promise.all([
    db.category.findMany({ where: { businessId: ctx.businessId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
    getAuditTrail(ctx, "Transaction", id),
    db.user.findMany({ where: { businessId: ctx.businessId }, select: { id: true, name: true } }),
  ]);
  const name = (uid: string | null) => users.find((u) => u.id === uid)?.name ?? "Unknown";
  const editable = canWrite(ctx.role) && t.status !== "VOID" && !t.reversalOfId;
  const dateText = formatDate(toIso(t.transactionDate), t.enteredCalendar === "BS" ? "BS" : cal);
  const tone = t.status === "POSTED" ? "green" : t.status === "DRAFT" ? "amber" : "red";

  return (
    <>
      <PageHeader
        title={`${tr("Bill Number")} ${t.billNumber || "-"}`}
        description={<span className="flex items-center gap-2"><Badge tone={tone}>{t.status === "VOID" ? tr("Deleted") : t.status === "DRAFT" ? tr("Draft") : tr("Saved")}</Badge>{t.reversalOfId && <Badge tone="blue">{tr("Reversal entry")}</Badge>}</span>}
        actions={editable && t.status === "POSTED" ? <EntryActions id={t.id} /> : editable ? <EntryActions id={t.id} draft /> : undefined}
      />
      {t.status === "VOID" && <Alert tone="error" className="mb-4" title={tr("This entry was deleted")}>{tr("Reason (kept in the history)")}: {t.voidReason}. {tr("It no longer affects any balance or report, but is kept in the history below.")}</Alert>}
      {t.reversalOfId && <Alert tone="info" className="mb-4">{tr("This is a reversal. It offsets an earlier entry and cannot be edited.")}</Alert>}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardContent className="p-5">
            {editable ? (
              <EntryForm
                mode="edit" calendar={cal} grouping={g} symbol={biz.currencySymbol} categories={categories}
                edit={{
                  id: t.id, version: t.version, status: t.status === "DRAFT" ? "DRAFT" : "POSTED",
                  initial: {
                    dateText, calendar: t.enteredCalendar === "BS" ? "BS" : cal, billNumber: t.billNumber,
                    debit: t.debitAmount.isZero() ? "" : t.debitAmount.toFixed(2), credit: t.creditAmount.isZero() ? "" : t.creditAmount.toFixed(2),
                    description: t.description, categoryId: t.categoryId ?? "",
                  },
                }}
              />
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">{tr("Date")}</dt><dd className="font-medium">{formatDate(toIso(t.transactionDate), cal)} {cal}</dd></div>
                <div><dt className="text-muted-foreground">{tr("Bill Number")}</dt><dd className="font-medium">{t.billNumber}</dd></div>
                <div><dt className="text-muted-foreground">{tr("Debit")}</dt><dd><Amt v={t.debitAmount.toFixed(2)} grouping={g} blankZero /></dd></div>
                <div><dt className="text-muted-foreground">{tr("Credit")}</dt><dd><Amt v={t.creditAmount.toFixed(2)} grouping={g} blankZero /></dd></div>
                <div className="sm:col-span-2"><dt className="text-muted-foreground">{tr("Description / Notes")}</dt><dd>{t.description || "-"}</dd></div>
              </dl>
            )}
          </CardContent>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>{tr("Record details")}</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p><span className="text-muted-foreground">Entered as: </span>{t.enteredDateText || "-"} {t.enteredDateText ? t.enteredCalendar : ""}</p>
              <p><span className="text-muted-foreground">Stored date (AD): </span>{toIso(t.transactionDate)}</p>
              <p><span className="text-muted-foreground">Created by </span>{name(t.createdBy)} on {t.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p>
              {t.updatedBy && <p><span className="text-muted-foreground">Last changed by </span>{name(t.updatedBy)} on {t.updatedAt.toISOString().slice(0, 16).replace("T", " ")} UTC</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{tr("History")}</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-3 text-sm">
                {trail.map((a) => (
                  <li key={a.id} className="border-l-2 pl-3">
                    <p className="font-medium">{a.action.replace("_", " ").toLowerCase()} <span className="font-normal text-muted-foreground">by {a.userName}</span></p>
                    <p className="text-xs text-muted-foreground">{a.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC{a.note ? ` - ${a.note}` : ""}</p>
                  </li>
                ))}
                {trail.length === 0 && <li className="text-muted-foreground">No history.</li>}
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
