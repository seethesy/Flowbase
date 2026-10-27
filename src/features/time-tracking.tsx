import { useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import {
  activityLabels,
  type EffortRow,
  type WorkloadRow,
} from "../../shared/time-tracking";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { timeApi } from "../services/time-tracking";
import { useResource } from "../app/useResource";
import {
  Button,
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

// The time tracking section of the Settings screen.
export function TimeTrackingSettings() {
  const idleMinutes = useBusinessSettings().defaults.idleCutoffMinutes;
  return (
    <Section title="Time tracking">
      <p>
        <strong>Time tracking is on.</strong> {trackingNoticeText(idleMinutes)}
      </p>
      <p>
        Time is credited to the lead, client or event on screen and to the kind
        of work the screen is for. Admin and Sales Managers see everyone's time
        in <Link to="/reports">Reports</Link>; everyone else sees only their
        own.
      </p>
    </Section>
  );
}

export const duration = (seconds: number) => {
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
  const report = useResource(() => timeApi.report({ from, to }), [from, to]);
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
        title="Time tracking"
        subtitle={
          data?.scope === "own"
            ? "Your own active time in Flowbase."
            : "Active time in Flowbase per booking and per person."
        }
        eyebrow="Reports"
      />
      <FilterBar>
        <FormField label="From">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => e.target.value && setFrom(e.target.value)}
          />
        </FormField>
        <FormField label="To">
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
          <Section title="Effort per booking">
            {data.effort.length ? (
              <DataTable
                data={data.effort}
                columns={effortColumns}
                label="events"
                exportName="time by event"
              />
            ) : (
              <EmptyState
                title="No event time yet"
                description="Time spent on event pages in this range shows here."
              />
            )}
          </Section>
          <Section title="Workload">
            {data.workload.length ? (
              <DataTable
                data={data.workload}
                columns={workloadColumns}
                label="rows"
                exportName="workload"
              />
            ) : (
              <EmptyState
                title="No time recorded"
                description="Active time in this range shows here."
              />
            )}
          </Section>
        </>
      )}
    </>
  );
}
