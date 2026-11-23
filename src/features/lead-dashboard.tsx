import { useState } from "react";
import { Block, PageGrid } from "../app/page-grid";
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
import { T, LabelT } from "../app/copy";

// Lead dashboard (FLOW-113): which lead sources are worth paying for. Dollar
// figures are estimates until proposals exist (FLOW-122): each closed lead counts at
// its stated budget, or the average budget when it gave none.
const money = (cents: number) =>
  `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const percent = (rate: number | null) =>
  rate === null ? "—" : `${Math.round(rate * 100)}%`;
const responseTime = (seconds: number | null) => {
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
  {
    id: "channel",
    header: "Channel",
    accessorFn: (row) => leadChannelLabels[row.channel],
    cell: ({ row }) => <LabelT id="labels.lead-channel" value={row.original.channel}>{leadChannelLabels[row.original.channel]}</LabelT>,
  },
  ...rowColumns<ChannelRow>(),
];

export function LeadDashboardPage() {
  const navigate = useNavigate();
  const [range, setRange] = useState<{ from?: string; to?: string }>({});
  const dashboard = useResource(
    ["lead-dashboard", range.from, range.to],
    () => leadsApi.dashboard(range),
    { keepPrevious: true },
  );
  const data = dashboard.data;
  return (
    <>
      <Link to="/leads" className="back-link">
        <T id="lead-dashboard.lead-dashboard-page.all-leads">← All leads</T>
      </Link>
      <PageHeader
        title={<T id="lead-dashboard.lead-dashboard-page.lead-dashboard">Lead dashboard</T>}
        subtitle={
          data?.scope === "own"
            ? <T id="lead-dashboard.lead-dashboard-page.your-leads-by-source-channel">Your leads by source, channel and status.</T>
            : <T id="lead-dashboard.lead-dashboard-page.which-lead-sources-are-worth">Which lead sources are worth paying for.</T>
        }
        eyebrow={<T id="lead-dashboard.lead-dashboard-page.leads">Leads</T>}
      />
      <PageGrid pageKey="leads.dashboard">
      <Block id="filters" name="Dates" h={4}>
      <FilterBar>
        <FormField label={<T id="lead-dashboard.lead-dashboard-page.from">From</T>}>
          <input
            type="date"
            value={range.from ?? data?.from ?? ""}
            onChange={(e) => setRange((current) => ({ ...current, from: e.target.value || undefined }))}
          />
        </FormField>
        <FormField label={<T id="lead-dashboard.lead-dashboard-page.to">To</T>}>
          <input
            type="date"
            value={range.to ?? data?.to ?? ""}
            onChange={(e) => setRange((current) => ({ ...current, to: e.target.value || undefined }))}
          />
        </FormField>
      </FilterBar>
      </Block>
      <Block id="totals" name="Totals" h={8}>
      {dashboard.error ? (
        <LoadError message={dashboard.error} />
      ) : !data ? (
        <LoadingSkeleton />
      ) : (
        <>
          <div className="kpi-grid">
            <KpiCard
              label={<T id="lead-dashboard.lead-dashboard-page.leads">Leads</T>}
              value={data.totals.leads}
              icon={<Inbox size={19} />}
              comparison={<T id="lead-dashboard.lead-dashboard-page.awaiting-action" values={{ awaitingAction: data.totals.awaitingAction }}>{"{awaitingAction} awaiting action"}</T>}
              onClick={() => navigate("/leads")}
            />
            <KpiCard
              label={<T id="lead-dashboard.lead-dashboard-page.conversion-rate">Conversion rate</T>}
              value={percent(data.totals.conversionRate)}
              icon={<TrendingUp size={19} />}
              comparison={<T id="lead-dashboard.lead-dashboard-page.converted-closed" values={{ converted: data.totals.converted, closed: data.totals.closed }}>{"{converted} converted · {closed} closed"}</T>}
              onClick={() => navigate("/leads")}
            />
            <KpiCard
              label={<T id="lead-dashboard.lead-dashboard-page.est-closed-value">Est. closed value</T>}
              value={money(data.totals.estimatedClosedCents)}
              icon={<CircleDollarSign size={19} />}
              comparison={
                data.averageBudgetCents === null
                  ? <T id="lead-dashboard.lead-dashboard-page.no-budgets-yet-to-estimate">No budgets yet to estimate from</T>
                  : <T id="lead-dashboard.lead-dashboard-page.average-budget-where-none-given" values={{ averageBudgetCents: money(data.averageBudgetCents) }}>{"Average budget {averageBudgetCents} where none given"}</T>
              }
              onClick={() => navigate("/events")}
            />
            <KpiCard
              label={<T id="lead-dashboard.lead-dashboard-page.median-first-response">Median first response</T>}
              value={responseTime(data.totals.medianFirstResponseSeconds)}
              icon={<Clock size={19} />}
              comparison={<T id="lead-dashboard.lead-dashboard-page.received-to-first-contact">Received to first contact</T>}
              onClick={() => navigate("/leads")}
            />
          </div>
          <p role="note" className="muted">
            <T id="lead-dashboard.lead-dashboard-page.dollar-figures-are-estimates-a">Dollar figures are estimates: a closed lead counts at its stated budget, or at the average budget when it gave none, until proposals carry real totals.</T>
          </p>
        </>
      )}
      </Block>
      {data && (
        <Block id="by-source" name="By source" h={18}>
          <Section title={<T id="lead-dashboard.lead-dashboard-page.by-source">By source</T>}>
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
            <DataTable copyKey="lead-dashboard.lead-dashboard-page"
              data={data.bySource}
              columns={sourceColumns}
              label={<T id="lead-dashboard.lead-dashboard-page.sources">sources</T>}
              exportName="lead sources"
            />
          </Section>
        </Block>
      )}
      {data && (
        <Block id="by-channel-status" name="By channel and status" h={12}>
          <div className="detail-grid">
            <Section title={<T id="lead-dashboard.lead-dashboard-page.by-channel">By channel</T>}>
              <DataTable copyKey="lead-dashboard.lead-dashboard-page" data={data.byChannel} columns={channelColumns} label={<T id="lead-dashboard.lead-dashboard-page.channels">channels</T>} />
            </Section>
            <Section title={<T id="lead-dashboard.lead-dashboard-page.by-status">By status</T>}>
              <ul aria-label="Leads by status">
                {data.byStatus.map((row) => (
                  <li key={row.status}>
                    <LabelT id="labels.pipeline-status" value={row.status}>{leadStatusLabels[row.status]}</LabelT>: <strong>{row.leads}</strong>
                  </li>
                ))}
              </ul>
            </Section>
          </div>
        </Block>
      )}
          {data?.scope === "all" && (
            <Block id="by-salesperson" name="By salesperson" h={12}>
            <Section title={<T id="lead-dashboard.lead-dashboard-page.by-salesperson">By salesperson</T>}>
              <DataTable copyKey="lead-dashboard.lead-dashboard-page"
                data={data.bySalesperson}
                columns={salespersonColumns}
                label={<T id="lead-dashboard.lead-dashboard-page.salespeople">salespeople</T>}
              />
            </Section>
            </Block>
          )}
      </PageGrid>
    </>
  );
}
