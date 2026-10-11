"use client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { formatAmount, type Grouping } from "@/lib/format";
import { useT } from "@/lib/i18n/client";

type Row = { label: string; debit: number; credit: number; balance: number; income: number; expense: number };

const compact = (n: number) => (Math.abs(n) >= 1e7 ? `${(n / 1e7).toFixed(1)}Cr` : Math.abs(n) >= 1e5 ? `${(n / 1e5).toFixed(1)}L` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n));

function ChartCard({ title, description, children, empty }: { title: string; description: string; children: React.ReactNode; empty: boolean }) {
  const t = useT();
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent>
        {empty ? <EmptyState title={t("Nothing to chart yet")}>{t("Data for this period will appear here.")}</EmptyState> : <div className="h-64 w-full" role="img" aria-label={title}>{children}</div>}
      </CardContent>
    </Card>
  );
}

export function DashboardCharts({ data, grouping, hasClassified }: { data: Row[]; grouping: Grouping; hasClassified: boolean }) {
  const t = useT();
  const fmt = (v: unknown) => formatAmount(Number(v).toFixed(2), grouping);
  const hasActivity = data.some((d) => d.debit || d.credit);
  const common = { margin: { top: 8, right: 8, left: 0, bottom: 0 } };
  const axis = { tick: { fontSize: 11, fill: "#64748b" }, tickLine: false, axisLine: { stroke: "#cbd5e1" } } as const;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <ChartCard title={t("Monthly balance trend")} description={t("Closing balance at the end of each month")} empty={!data.length}>
          <ResponsiveContainer>
            <LineChart data={data} {...common}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" {...axis} />
              <YAxis {...axis} tickFormatter={compact} width={48} />
              <Tooltip formatter={(v) => fmt(v)} />
              <Line type="monotone" dataKey="balance" name={t("Closing Balance")} stroke="#1d4ed8" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
      <ChartCard title={t("Debit versus credit")} description={t("Totals by month")} empty={!hasActivity}>
        <ResponsiveContainer>
          <BarChart data={data} {...common}>
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} tickFormatter={compact} width={48} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Legend />
            <Bar dataKey="debit" name={t("Debit")} fill="#1d4ed8" radius={[3, 3, 0, 0]} />
            <Bar dataKey="credit" name={t("Credit")} fill="#94a3b8" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
      <ChartCard title={t("Income versus expenses")} description={hasClassified ? t("From entries classified with a category") : t("Classify entries with a category to see this chart")} empty={!hasClassified}>
        <ResponsiveContainer>
          <BarChart data={data} {...common}>
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" {...axis} />
            <YAxis {...axis} tickFormatter={compact} width={48} />
            <Tooltip formatter={(v) => fmt(v)} />
            <Legend />
            <Bar dataKey="income" name={t("Income")} fill="#15803d" radius={[3, 3, 0, 0]} />
            <Bar dataKey="expense" name={t("Expenses")} fill="#dc2626" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  );
}
