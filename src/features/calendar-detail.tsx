import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CalendarEvent } from "../../shared/calendar";
import { Button, DetailDrawer } from "../components/shared";
import { StatusPill } from "../components/ui/status-pill";
import { usePermissions } from "../app/permissions";
import { T } from "../app/copy";
import { calendarWhen } from "./calendar-entries";

// The calendar's side panel (FLOW-265): the clicked event's status, date and
// time, client, venue, guests, owner and proposal, with ways into the event, its
// proposal (whoever may read proposals: Admin and sales by default), its BEO and
// its lead. A link whose record doesn't exist yet is left out.
export function CalendarEventPanel({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const { can } = usePermissions();
  const rows: [string, ReactNode, ReactNode][] = [
    ["date-time", <T id="calendar.event-panel.date-time">{"Date & time"}</T>, calendarWhen(event)],
    ["client", <T id="calendar.event-panel.client">Client</T>, event.clientName || "—"],
    ["venue", <T id="calendar.event-panel.venue">Venue</T>, event.venueName ?? "—"],
    ["guests", <T id="calendar.event-panel.guests">Guests</T>, event.guestCount ?? "—"],
    ["owner", <T id="calendar.event-panel.owner">Owner</T>, event.salespersonName ?? "—"],
    ...(can("proposals.read")
      ? [["proposal", <T id="calendar.event-panel.proposal">Proposal</T>, event.proposal?.title ?? "—"] as [string, ReactNode, ReactNode]]
      : []),
  ];
  return (
    <DetailDrawer open onClose={onClose} title={event.title} description={<StatusPill status={event.status} />}>
      <dl className="panel-details">
        {rows.map(([key, label, value]) => (
          <div key={key}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="panel-actions">
        <Button asChild><Link to={`/events/${event.id}`}><T id="calendar.event-panel.open-event">Open event</T></Link></Button>
        {event.proposal && can("proposals.read") && (
          <Button variant="outline" asChild><Link to={`/events/${event.id}?proposal=${event.proposal.id}`}><T id="calendar.event-panel.open-proposal">Open Proposal</T></Link></Button>
        )}
        {event.beoId && (
          <Button variant="outline" asChild><Link to={`/events/${event.id}/beo/${event.beoId}`}><T id="calendar.event-panel.open-beo">Open BEO</T></Link></Button>
        )}
        {event.leadId && can("leads.read") && (
          <Button variant="outline" asChild><Link to={`/leads/${event.leadId}`}><T id="calendar.event-panel.open-lead">Open lead</T></Link></Button>
        )}
      </div>
    </DetailDrawer>
  );
}
