import { Block, PageGrid } from "../../app/live-edit/page-grid";
import type { HistoryEntry } from "../../../shared/audit";
import { eventStatusDetailLabels, type EventStatus } from "../../../shared/core-records";
import { BUSINESS_TIME_ZONE } from "../../../shared/time";
import { LoadMore, usePagedList } from "../../app/paging";
import { LoadingSkeleton, Section, ErrorText } from "../../components/shared";
import { eventsApi } from "../../services/core";
import { LabelT, T } from "../../app/copy";
import type { ReactNode } from "react";
import "./event-activity.css";

// The event hub's history section (FLOW-166): the event's status history
// (FLOW-56, here since FLOW-350) and change history, for anyone who can open
// the event. (The tasks section is FLOW-59's, in task-lists.)

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
function shown(field: string, value: unknown): ReactNode {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "status" && typeof value === "string") {
    const label = eventStatusDetailLabels[value as EventStatus];
    return label ? <LabelT id="labels.pipeline-status" value={value}>{label}</LabelT> : value;
  }
  if (Array.isArray(value)) return value.length ? value.map((v) => (typeof v === "boolean" ? (v ? "Yes" : "No") : String(shown("", v)))).join(", ") : "—";
  if (typeof value === "object")
    return "name" in value ? String((value as { name: unknown }).name) : JSON.stringify(value);
  if (typeof value === "boolean")
    return value ? <T id="event-activity.event-history-section.yes">Yes</T> : <T id="event-activity.event-history-section.no">No</T>;
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
  const statuses = usePagedList(["event-status-history", eventId, version], (cursor) =>
    eventsApi.statusHistory(eventId, cursor),
  );
  if (list.error)
    return (
      <Section title={<T id="event-activity.event-history-section.history">History</T>}>
        <ErrorText message={list.error} />
      </Section>
    );
  if (!list.data) return <LoadingSkeleton />;
  return (
    <Section title={<T id="event-activity.event-history-section.history">History</T>}>
      <PageGrid pageKey="events.activity">
      {/* FLOW-350 A1: the status history, moved here from the removed Status card. */}
      <Block id="status-history" name="Status history" h={8}>
      <h3><T id="events.event-status-panel.status-history">Status history</T></h3>
      {statuses.error ? (
        <ErrorText message={statuses.error} />
      ) : (
        <ul aria-label="Status history" className="event-activity-list">
          {statuses.data?.map((entry) => (
            <li key={entry.id}>
              <strong>
                {entry.from
                  ? <><LabelT id="labels.pipeline-status" value={entry.from}>{eventStatusDetailLabels[entry.from]}</LabelT> → <LabelT id="labels.pipeline-status" value={entry.to}>{eventStatusDetailLabels[entry.to]}</LabelT></>
                  : <T id="events.event-status-panel.created-as" values={{ eventStatusDetailLabels: <LabelT id="labels.pipeline-status" value={entry.to}>{eventStatusDetailLabels[entry.to]}</LabelT> }}>{"Created as {eventStatusDetailLabels}"}</T>}
              </strong>{" "}
              <small>
                {stamp(entry.at)}
                {entry.manual ? "" : <T id="events.event-status-panel.automatic">{" · automatic"}</T>}
              </small>
              {entry.reason && <p>{entry.reason}</p>}
            </li>
          ))}
        </ul>
      )}
      <LoadMore list={statuses} label={<T id="events.event-status-panel.show-older-changes">Show older changes</T>} />
      </Block>
      <Block id="history" name="Event history" h={16}>
      {list.data.length ? (
        <ul aria-label="Event history" className="event-activity-list">
          {list.data.map((entry) => {
            const changes = Object.entries(entry.changes);
            return (
              <li key={entry.id}>
                <strong><LabelT id="event-activity.action" value={entry.action}>{actionLabels[entry.action]}</LabelT></strong>{" "}
                <small>
                  {entry.actorName || (entry.actorId ? <T id="event-activity.event-history-section.someone">Someone</T> : <T id="event-activity.event-history-section.flowbase">Flowbase</T>)} ·{" "}
                  {stamp(entry.at)}
                </small>
                {entry.action === "update" && changes.length > 0 && (
                  <ul>
                    {changes.map(([field, change]) => (
                      <li key={field}>
                        {fieldLabels[field] ? <LabelT id="event-activity.field" value={field}>{fieldLabels[field]}</LabelT> : field}
                        {byId(field)
                          ? <T id="event-activity.event-history-section.changed">{" changed"}</T>
                          : <>: {shown(field, change.before)} → {shown(field, change.after)}</>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="muted"><T id="event-activity.event-history-section.no-changes-recorded-yet">No changes recorded yet.</T></p>
      )}
      <LoadMore list={list} label={<T id="event-activity.event-history-section.show-older-changes">Show older changes</T>} />
      </Block>
      </PageGrid>
    </Section>
  );
}
