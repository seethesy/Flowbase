import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { CircleDollarSign, Clock, Inbox, TrendingUp } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  leadChannelLabels,
  leadStatusLabels,
  type LeadDashboard,
  type LeadDashboardRow,
} from "../../shared/leads";
import { leadsApi } from "../services/leads";
import { useResource } from "../app/useResource";
import {
  DataTable,
  FilterBar,
  FormField,
  KpiCard,
  LoadingSkeleton,
  PageHeader,
  Section,
} from "../components/shared";
import { LoadError } from "../components/record-display";

// Lead dashboard (FLOW-113): which lead sources are worth paying for. Dollar
// figures are estimates until proposals exist (FLOW-122): each closed lead counts at
// its stated budget, or the average budget when it gave none.
const money = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const percent = (rate: number | null) =>
  rate === null ? "—" : `${Math.round(rate * 100)}%`;
export const responseTime = (seconds: number | null) => {
  if (seconds === null) return "—";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

type SourceRow = LeadDashboard["bySource"][number];
const rowColumns = <T extends LeadDashboardRow>(): ColumnDef<T, unknown>[] => [
  { id: "leads", header: "Leads", accessorFn: (row) => row.leads },
  { id: "converted", header: "Converted", accessorFn: (row) => row.converted },
  {
    id: "rate",
    header: "Conversion",
    accessorFn: (row) => row.conversionRate ?? -1,
    cell: (c) => percent(c.row.original.conversionRate),
  },
  { id: "closed", header: "Closed", accessorFn: (row) => row.closed },
  {
    id: "value",
    header: "Est. closed value",
    accessorFn: (row) => row.estimatedClosedCents,
    cell: (c) => money(c.row.original.estimatedClosedCents),
  },
  {
    id: "response",
    header: "Median first response",
    accessorFn: (row) => row.medianFirstResponseSeconds ?? Number.MAX_SAFE_INTEGER,
    cell: (c) => responseTime(c.row.original.medianFirstResponseSeconds),
  },
  { id: "awaiting", header: "Awaiting action", accessorFn: (row) => row.awaitingAction },
];
const sourceColumns: ColumnDef<SourceRow, unknown>[] = [
  { id: "source", header: "Source", accessorFn: (row) => row.source },
  ...rowColumns<SourceRow>(),
  {
    id: "purchased",
    header: "Purchased / not",
    accessorFn: (row) => row.purchased,
    cell: (c) =>
      c.row.original.hasPurchased
        ? `${c.row.original.purchased} / ${c.row.original.leads - c.row.original.purchased}`
        : "—",
  },
];
type SalespersonRow = LeadDashboard["bySalesperson"][number];
const salespersonColumns: ColumnDef<SalespersonRow, unknown>[] = [
  {
    id: "salesperson",
    header: "Salesperson",
    accessorFn: (row) => row.salespersonId ?? "Unassigned",
  },
  ...rowColumns<SalespersonRow>(),
];
type ChannelRow = LeadDashboard["byChannel"][number];
const channelColumns: ColumnDef<ChannelRow, unknown>[] = [
  { id: "channel", header: "Channel", accessorFn: (row) => leadChannelLabels[row.channel] },
  ...rowColumns<ChannelRow>(),
];

export function LeadDashboardPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const dashboard = useResource(() => leadsApi.dashboard(range), [range.from, range.to]);
  const data = dashboard.data;
  return (
    <>
      <Link to="/leads" className="back-link">
        ← All leads
      </Link>
      <PageHeader
        title="Lead dashboard"
        subtitle={
          data?.scope === "own"
            ? "Your leads by source, channel and status."
            : "Which lead sources are worth paying for."
        }
        eyebrow="Leads"
      />
      <FilterBar>
        <FormField label="From">
          <input
            type="date"
            value={range.from ?? data?.from ?? ""}
            onChange={(e) => setRange((current) => ({ ...current, from: e.target.value || undefined }))}
          />
        </FormField>
        <FormField label="To">
          <input
            type="date"
            value={range.to ?? data?.to ?? ""}
            onChange={(e) => setRange((current) => ({ ...current, to: e.target.value || undefined }))}
          />
        </FormField>
      </FilterBar>
      {dashboard.error ? (
        <LoadError message={dashboard.error} />
      ) : !data ? (
        <LoadingSkeleton />
      ) : (
        <>
          <div className="kpi-grid">
            <KpiCard
              label="Leads"
              value={data.totals.leads}
              icon={<Inbox size={19} />}
              comparison={`${data.totals.awaitingAction} awaiting action`}
              onClick={() => navigate("/leads")}
            />
            <KpiCard
              label="Conversion rate"
              value={percent(data.totals.conversionRate)}
              icon={<TrendingUp size={19} />}
              comparison={`${data.totals.converted} converted · ${data.totals.closed} closed`}
              onClick={() => navigate("/leads")}
            />
            <KpiCard
              label="Est. closed value"
              value={money(data.totals.estimatedClosedCents)}
              icon={<CircleDollarSign size={19} />}
              comparison={
                data.averageBudgetCents === null
                  ? "No budgets yet to estimate from"
                  : `Average budget ${money(data.averageBudgetCents)} where none given`
              }
              onClick={() => navigate("/events")}
            />
            <KpiCard
              label="Median first response"
              value={responseTime(data.totals.medianFirstResponseSeconds)}
              icon={<Clock size={19} />}
              comparison="Received to first contact"
              onClick={() => navigate("/leads")}
            />
          </div>
          <p role="note" className="muted">
            Dollar figures are estimates: a closed lead counts at its stated budget, or
            at the average budget when it gave none, until proposals carry real totals.
          </p>
          <Section title="By source">
            {data.bySource.length > 0 && (
              <div className="lead-source-chart" aria-hidden="true">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={data.bySource}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="source" tick={{ fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="leads" name="Leads" fill="var(--soft)" stroke="var(--primary)" />
                    <Bar dataKey="converted" name="Converted" fill="var(--primary)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <DataTable
              data={data.bySource}
              columns={sourceColumns}
              label="sources"
              exportName="lead sources"
            />
          </Section>
          <div className="detail-grid">
            <Section title="By channel">
              <DataTable data={data.byChannel} columns={channelColumns} label="channels" />
            </Section>
            <Section title="By status">
              <ul aria-label="Leads by status">
                {data.byStatus.map((row) => (
                  <li key={row.status}>
                    {leadStatusLabels[row.status]}: <strong>{row.leads}</strong>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
          {data.scope === "all" && (
            <Section title="By salesperson">
              <DataTable
                data={data.bySalesperson}
                columns={salespersonColumns}
                label="salespeople"
              />
            </Section>
          )}
        </>
      )}
    </>
  );
}
