import type { HistoryEntry } from "../../shared/audit";
import { eventStatusDetailLabels, type EventStatus } from "../../shared/core-records";
import { BUSINESS_TIME_ZONE } from "../../shared/time";
import { LoadMore, usePagedList } from "../app/paging";
import { LoadingSkeleton, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { eventsApi } from "../services/core";
import "./event-activity.css";

// The event hub's history section (FLOW-166): the event's change history, for
// anyone who can open the event. (The tasks section is FLOW-59's, in task-lists.)

const stamp = (at: string) =>
  new Date(at).toLocaleString("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });

// Field names as the event form labels them.
const fieldLabels: Record<string, string> = {
  title: "Title",
  date: "Date",
  startTime: "Start time",
  endTime: "End time",
  client: "Client",
  pocContactId: "Point of contact",
  venue: "Venue",
  address: "Address",
  areas: "Areas",
  eventType: "Event type",
  serviceType: "Service type",
  foodServiceStyle: "Food service style",
  guestCount: "Guests",
  servingsCount: "Servings",
  assignedSalespersonId: "Salesperson",
  productionLeadId: "Production Lead",
  assistantLeadIds: "Assistant Leads",
  dressCode: "Dress code",
  arrivalTime: "Arrival at venue",
  transportationNotes: "Transportation notes",
  internalNotes: "Internal notes",
  status: "Status",
  bookedAt: "Booked",
  archivedAt: "Archived",
};
const actionLabels: Record<HistoryEntry["action"], string> = {
  create: "Created",
  update: "Changed",
  archive: "Archived",
  restore: "Restored",
};

// A stored value as a person reads it. People and contacts are stored by id,
// which means nothing on screen, so those only say that they changed.
function shown(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "status" && typeof value === "string")
    return eventStatusDetailLabels[value as EventStatus] ?? value;
  if (Array.isArray(value)) return value.length ? value.map((v) => shown("", v)).join(", ") : "—";
  if (typeof value === "object")
    return "name" in value ? String((value as { name: unknown }).name) : JSON.stringify(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}
const byId = (field: string) => field.endsWith("Id") || field.endsWith("Ids");

export function EventHistorySection({
  eventId,
  version,
}: {
  eventId: string;
  // The event's updatedAt: an edit on the page loads the history again.
  version: string;
}) {
  const list = usePagedList(["event-history", eventId, version], (cursor) =>
    eventsApi.history(eventId, cursor),
  );
  if (list.error)
    return (
      <Section title="History">
        <LoadError message={list.error} />
      </Section>
    );
  if (!list.data) return <LoadingSkeleton />;
  return (
    <Section title="History">
      {list.data.length ? (
        <ul aria-label="Event history" className="event-activity-list">
          {list.data.map((entry) => {
            const changes = Object.entries(entry.changes);
            return (
              <li key={entry.id}>
                <strong>{actionLabels[entry.action]}</strong>{" "}
                <small>
                  {entry.actorName || (entry.actorId ? "Someone" : "Flowbase")} ·{" "}
                  {stamp(entry.at)}
                </small>
                {entry.action === "update" && changes.length > 0 && (
                  <ul>
                    {changes.map(([field, change]) => (
                      <li key={field}>
                        {fieldLabels[field] ?? field}
                        {byId(field)
                          ? " changed"
                          : `: ${shown(field, change.before)} → ${shown(field, change.after)}`}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted">No changes recorded yet.</p>
      )}
      <LoadMore list={list} label="Show older changes" />
    </Section>
  );
}
