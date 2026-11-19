import { useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import {
  activityLabels,
  type EffortRow,
  type ProposalEffortRow,
  type WorkloadRow,
} from "../../shared/time-tracking";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { timeApi } from "../services/time-tracking";
import { useResource } from "../app/useResource";
import {
  DataTable,
  EmptyState,
  FilterBar,
  FormField,
  LoadingSkeleton,
  PageHeader,
  Section,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { useBusinessSettings } from "../services/settings";
import "./time-tracking.css";

// Automatic activity time tracking (FLOW-119): the notice that it's on, the
// Settings entry and the reports.

import { trackingNoticeText } from "../components/TrackingNotice";
import { T } from "../app/live-copy";

// The time tracking section of the Settings screen.
export function TimeTrackingSettings() {
  const idleMinutes = useBusinessSettings().defaults.idleCutoffMinutes;
  return (
    <Section title={<T id="time-tracking.time-tracking-settings.time-tracking">Time tracking</T>}>
      <p>
        <strong><T id="time-tracking.time-tracking-settings.time-tracking-is-on">Time tracking is on.</T></strong> {trackingNoticeText(idleMinutes)}
      </p>
      <p>
        <T id="time-tracking.time-tracking-settings.time-is-credited-to-the-lead">{"Time is credited to the lead, client, event, proposal or task on screen and to the kind of work the screen is for. Admin and Sales Managers see everyone's time in "}</T><Link to="/reports"><T id="time-tracking.time-tracking-settings.reports">Reports</T></Link><T id="time-tracking.time-tracking-settings.everyone-else-sees-only-their-own">; everyone else sees only their own.</T>
      </p>
    </Section>
  );
}

// The booking's booked total (FLOW-221); a dash when none is recorded or the viewer
// may not see it.
const bookedTotal = (cents: number | null) =>
  cents === null
    ? "—"
    : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
const duration = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
};
// Calendar days back from today in New York, whatever the day lengths (FLOW-200).
const daysAgo = (days: number) =>
  addLocalDays(utcToBusinessTime(new Date()).date, -days);

export function TimeReports() {
  const [from, setFrom] = useState(() => daysAgo(29));
  const [to, setTo] = useState(() => daysAgo(0));
  const report = useResource(
    ["time-report", from, to],
    () => timeApi.report({ from, to }),
    { keepPrevious: true },
  );
  const effortColumns: ColumnDef<EffortRow, unknown>[] = [
    {
      accessorKey: "title",
      header: "Event",
      cell: (c) => (
        <Link to={`/events/${c.row.original.eventId}`}>
          {c.row.original.title}
        </Link>
      ),
    },
    { accessorKey: "date", header: "Date" },
    { accessorKey: "clientName", header: "Client" },
    {
      accessorKey: "bookedTotalCents",
      header: "Booked total",
      cell: (c) => bookedTotal(c.row.original.bookedTotalCents),
      meta: { csv: (row) => bookedTotal(row.bookedTotalCents) },
    },
    { accessorKey: "people", header: "People" },
    {
      accessorKey: "seconds",
      header: "Time",
      cell: (c) => duration(c.row.original.seconds),
      meta: { csv: (row) => duration(row.seconds) },
    },
  ];
  // FLOW-167: a proposal's time also counts toward its event's row above.
  const proposalColumns: ColumnDef<ProposalEffortRow, unknown>[] = [
    {
      accessorKey: "title",
      header: "Proposal",
      cell: (c) => (
        <Link
          to={`/events/${c.row.original.eventId}?proposal=${c.row.original.proposalId}`}
        >
          {c.row.original.title}
        </Link>
      ),
    },
    { accessorKey: "eventTitle", header: "Event" },
    { accessorKey: "people", header: "People" },
    {
      accessorKey: "seconds",
      header: "Time",
      cell: (c) => duration(c.row.original.seconds),
      meta: { csv: (row) => duration(row.seconds) },
    },
  ];
  const workloadColumns: ColumnDef<WorkloadRow, unknown>[] = [
    {
      id: "user",
      accessorFn: (row) => row.userName ?? row.userId,
      header: "User",
    },
    {
      id: "activity",
      header: "Activity",
      accessorFn: (row) => activityLabels[row.activity],
    },
    {
      accessorKey: "seconds",
      header: "Time",
      cell: (c) => duration(c.row.original.seconds),
      meta: { csv: (row) => duration(row.seconds) },
    },
  ];
  const data = report.data;
  return (
    <>
      <PageHeader
        title={<T id="time-tracking.time-reports.time-tracking">Time tracking</T>}
        subtitle={
          data?.scope === "own"
            ? <T id="time-tracking.time-reports.your-own-active-time-in-flowbase">Your own active time in Flowbase.</T>
            : <T id="time-tracking.time-reports.active-time-in-flowbase-per-booking">Active time in Flowbase per booking and per person.</T>
        }
        eyebrow={<T id="time-tracking.time-reports.reports">Reports</T>}
      />
      <FilterBar>
        <FormField label={<T id="time-tracking.time-reports.from">From</T>}>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </FormField>
        <FormField label={<T id="time-tracking.time-reports.to">To</T>}>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => e.target.value && setTo(e.target.value)}
          />
        </FormField>
      </FilterBar>
      {report.error ? (
        <LoadError message={report.error} />
      ) : !data ? (
        <LoadingSkeleton />
      ) : (
        <>
          <Section title={<T id="time-tracking.time-reports.effort-per-booking">Effort per booking</T>}>
            {data.effort.length ? (
              <DataTable
                data={data.effort}
                columns={effortColumns}
                label="events"
                exportName="time by event"
              />
            ) : (
              <EmptyState
                title={<T id="time-tracking.time-reports.no-event-time-yet">No event time yet</T>}
                description={<T id="time-tracking.time-reports.time-spent-on-an-event-its">Time spent on an event, its proposals and its tasks in this range shows here.</T>}
              />
            )}
          </Section>
          {data.proposals.length > 0 && (
            <Section title={<T id="time-tracking.time-reports.effort-per-proposal">Effort per proposal</T>}>
              <DataTable
                data={data.proposals}
                columns={proposalColumns}
                label="proposals"
                exportName="time by proposal"
              />
            </Section>
          )}
          <Section title={<T id="time-tracking.time-reports.workload">Workload</T>}>
            {data.workload.length ? (
              <DataTable
                data={data.workload}
                columns={workloadColumns}
                label="rows"
                exportName="workload"
              />
            ) : (
              <EmptyState
                title={<T id="time-tracking.time-reports.no-time-recorded">No time recorded</T>}
                description={<T id="time-tracking.time-reports.active-time-in-this-range-shows">Active time in this range shows here.</T>}
              />
            )}
          </Section>
        </>
      )}
    </>
  );
}
