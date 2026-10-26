import { useState } from "react";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import {
  activityLabels,
  IDLE_CUTOFF_MS,
  type EffortRow,
  type WorkloadRow,
} from "../../shared/time-tracking";
import { utcToBusinessTime } from "../../shared/time";
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
import { LoadError } from "./clients";
import { useAuth } from "../app/auth";
import "./time-tracking.css";

// Automatic activity time tracking (FLOW-119): the notice that it's on, the
// Settings entry and the reports.

const idleMinutes = IDLE_CUTOFF_MS / 60_000;
export const trackingNoticeText = `Flowbase records how long you actively work on each screen, so the team can see the effort behind each booking and everyone's workload. Only time inside Flowbase counts: time stops when this tab is hidden or after ${idleMinutes} minutes without typing or clicking.`;

const NOTICE_KEY = "flowbase.trackingNoticeSeen";
const noticeSeen = () => {
  try {
    return window.localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
};

// Shown on first use. Until sign-in (FLOW-36) it's remembered per browser; then
// it becomes the first sign-in notice.
export function TrackingNotice() {
  const [open, setOpen] = useState(() => !noticeSeen());
  if (!open) return null;
  return (
    <aside className="demo-callout tracking-notice" aria-label="Time tracking">
      <p>
        <strong>Time tracking is on.</strong> {trackingNoticeText}{" "}
        <Link to="/settings">More about time tracking</Link>
      </p>
      <Button
        variant="outline"
        onClick={() => {
          try {
            window.localStorage.setItem(NOTICE_KEY, "1");
          } catch {
            // Storage blocked: the notice just shows again next time.
          }
          setOpen(false);
        }}
      >
        Got it
      </Button>
    </aside>
  );
}

export function SettingsPage() {
  const auth = useAuth();
  return (
    <>
      <PageHeader title="Settings" subtitle="How Flowbase works for you." />
      {auth?.user.role === "admin" && (
        <Section title="Staff access">
          <Link to="/settings/users">Manage users</Link>
        </Section>
      )}
      <Section title="Time tracking">
        <p>
          <strong>Time tracking is on.</strong> {trackingNoticeText}
        </p>
        <p>
          Time is credited to the lead, client or event on screen and to the
          kind of work the screen is for. Admin and Sales Managers see
          everyone's time in <Link to="/reports">Reports</Link>; everyone else
          sees only their own.
        </p>
      </Section>
    </>
  );
}

export const duration = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
};
const daysAgo = (days: number) =>
  utcToBusinessTime(new Date(Date.now() - days * 24 * 60 * 60_000)).date;

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
