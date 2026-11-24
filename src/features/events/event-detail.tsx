import { Allowed } from "../../app/permissions";
import { Fragment, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil, Archive, RotateCcw } from "lucide-react";
import { eventStatusDetailLabels, contactRoleLabels, eventStatusSchema, type EventStatus, type FlowEvent } from "../../../shared/core-records";
import { type HubSection } from "../../../shared/event-hub";
import { eventsApi } from "../../services/core";
import { useResource } from "../../app/useResource";
import { useOpenFor } from "../../app/useOpenFor";
import { LoadMore, usePagedList } from "../../app/paging";
import { Button, Section, ConfirmationDialog, FormField, LoadingSkeleton } from "../../components/shared";
import { hidden, initials, LoadError } from "../../components/record-display";
import { Attachments } from "../common/attachments";
import { CommunicationLog } from "../common/communications";
import { time } from "./event-format";
import { EventPlanningSection } from "./event-planning";
import { EventTruckSection } from "./event-trucks";
import { EventProductionSection } from "./production";
import { EventCloseoutSection } from "./event-closeout";
import { EventBeoSection } from "../beo/event-beo";
import { EventPaymentsSection } from "./event-payments";
import { EventStaffSection } from "./event-staff";
import { EventTimelineSection } from "./event-timeline";
import { EventKitchenMenuSection, EventPlanningProgressSection, EventPullListSection } from "./event-preparation";
import { EventProposalsSection } from "./event-proposals";
import { EventTasksSection } from "../tasks/task-lists";
import { EventHistorySection } from "./event-activity";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { FieldCard, useShownFields } from "../../app/live-edit/field-card";
import { T, LabelT } from "../../app/copy";
import { copySlug } from "../../../shared/copy";
import { StatusPill, StatusSelect } from "../../components/ui/status-pill";
import { statusLabels, when } from "./event-list";
import { EventForm } from "./event-form";

// Manual status changes (FLOW-56): Admin or the event's salesperson may pick any
// status; the reason is optional. Everyone who can open the event sees the history.
function EventStatusPanel({
  event,
  canChange,
  onChanged,
}: {
  event: FlowEvent;
  canChange: boolean;
  onChanged: (event: FlowEvent) => void;
}) {
  const history = usePagedList(
    ["event-status-history", event.id, event.status],
    (cursor) => eventsApi.statusHistory(event.id, cursor),
  );
  const others = eventStatusSchema.options.filter(
    (status) => status !== event.status,
  );
  const [to, setTo] = useState<EventStatus>(others[0]);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const target = others.includes(to) ? to : others[0];
  const change = async () => {
    setSaving(true);
    setError("");
    try {
      onChanged(
        await eventsApi.setStatus(event.id, { status: target, reason }),
      );
      setReason("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Section title={<T id="events.event-status-panel.status">Status</T>}>
      {canChange && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void change();
          }}
        >
          {error && (
            <p role="alert" className="error-message">
              {error}
            </p>
          )}
          <FormField label={<T id="events.event-status-panel.new-status">New status</T>}>
            <StatusSelect value={target} includeEventStages options={others} onChange={(value) => setTo(eventStatusSchema.parse(value))} />
          </FormField>
          <FormField label={<T id="events.event-status-panel.why-optional">Why (optional)</T>}>
            <textarea
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </FormField>
          <Button type="submit" disabled={saving}>
            <T id="events.event-status-panel.change-status">Change status</T>
          </Button>
        </form>
      )}
      <h3><T id="events.event-status-panel.status-history">Status history</T></h3>
      {history.error ? (
        <LoadError message={history.error} />
      ) : (
        <ul aria-label="Status history">
          {history.data?.map((entry) => (
            <li key={entry.id}>
              <strong>
                {entry.from
                  ? <><LabelT id="labels.pipeline-status" value={entry.from}>{eventStatusDetailLabels[entry.from]}</LabelT> → <LabelT id="labels.pipeline-status" value={entry.to}>{eventStatusDetailLabels[entry.to]}</LabelT></>
                  : <T id="events.event-status-panel.created-as" values={{ eventStatusDetailLabels: <LabelT id="labels.pipeline-status" value={entry.to}>{eventStatusDetailLabels[entry.to]}</LabelT> }}>{"Created as {eventStatusDetailLabels}"}</T>}
              </strong>{" "}
              <small>
                {new Date(entry.at).toLocaleString("en-US")}
                {entry.manual ? "" : <T id="events.event-status-panel.automatic">{" · automatic"}</T>}
              </small>
              {entry.reason && <p>{entry.reason}</p>}
            </li>
          ))}
        </ul>
      )}
      <LoadMore list={history} label={<T id="events.event-status-panel.show-older-changes">Show older changes</T>} />
    </Section>
  );
}

// The event hub (FLOW-57): one page per event with a section for each part of it.
// Hub sections as page blocks (FLOW-253), named for the edit chrome.
const hubSectionNames: Record<HubSection, string> = {
  details: "Details",
  client: "Client",
  proposal: "Proposals",
  booking: "Booking",
  payments: "Payments",
  beo: "BEO",
  planning: "Planning progress",
  pull_list: "Pull list",
  kitchen_menu: "Kitchen menu",
  inventory: "Inventory",
  tasks: "Tasks",
  production: "Production",
  timeline: "Timeline",
  staff: "Staff",
  trucks: "Trucks",
  closeout: "Closeout",
  files: "Files",
  history: "History",
};

// The API decides which sections the user may see; a section whose module doesn't
// exist yet is never listed.
export function EventDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const hub = useResource(
    ["event-hub", id],
    () => eventsApi.hub(id),
  );
  const [edit, setEdit] = useOpenFor(id);
  const [archive, setArchive] = useOpenFor(id);
  // Edit shows the fields the page shows (FLOW-255). Notes live in their own
  // block, so they stay in Edit.
  const shownFacts = useShownFields("events.detail", "event-facts");
  const shows = (field: string) => field === "transportationNotes" || field === "internalNotes" || shownFacts(field);
  const back = (
    <Link to="/events" className="back-link">
      <T id="events.event-detail.all-events">← All events</T>
    </Link>
  );
  if (hub.error)
    return (
      <>
        {back}
        <LoadError message={hub.error} />
      </>
    );
  if (!hub.data) return <LoadingSkeleton />;
  const { event: e, client, sections, canEdit, canChangeStatus } = hub.data;
  const setEvent = (event: FlowEvent) => hub.replace({ ...hub.data!, event });
  const facts: [string, ReactNode][] = [
    ["When", when(e)],
    ["Client", e.client?.name ?? "—"],
    ["Venue", e.venue?.name ?? <T id="events.event-detail.no-venue">No venue</T>],
    ["Address", e.address || "—"],
    ["Areas", e.areas.map((area) => area.name).join(", ") || "—"],
    ["Event type", e.eventType || "—"],
    ["Service type", e.serviceType || "—"],
    ["Food service style", e.foodServiceStyle || "—"],
    ["Guests", e.guestCount?.toString() ?? "—"],
    ["Servings", e.servingsCount?.toString() ?? "—"],
    ["Dress code", e.dressCode || "—"],
    ["Arrival at venue", e.arrivalTime ? time(e.arrivalTime) : "—"],
    ["Status", <LabelT id="labels.pipeline-status" value={e.status}>{statusLabels[e.status]}</LabelT>],
    ...(e.planningStaleAt ? [["Planning outputs", <T id="events.event-detail.needs-refresh-since" values={{ date: new Date(e.planningStaleAt).toLocaleDateString() }}>{"Needs refresh since {date}"}</T>] as [string, ReactNode]] : []),
  ];
  const render: Partial<Record<HubSection, () => ReactNode>> = {
    details: () => (
      <Fragment key="details">
        <div className="detail-grid">
          <FieldCard cardKey="event-facts" source="events" row={e as unknown as Record<string, unknown>}
            title={<T id="events.event-detail.event-details">Event details</T>}
            fields={["title", "date", "client", "venue", "address", "eventType", "serviceType", "foodServiceStyle", "guestCount", "servingsCount", "dressCode", "arrivalTime", "status"]}>
          <Section title={<T id="events.event-detail.event-details">Event details</T>}>
            <div className="info-grid">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <small><T id={`events.event-detail.${copySlug(label)}`}>{label}</T></small>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
            {e.venue && (
              <p>
                <Link to={`/venues/${e.venue.id}`}><T id="events.event-detail.open-venue">Open venue</T></Link>
              </p>
            )}
          </Section>
          </FieldCard>
          <Section title={<T id="events.event-detail.notes">Notes</T>}>
            <small><T id="events.event-detail.transportation">Transportation</T></small>
            <p>{e.transportationNotes || "—"}</p>
            <small><T id="events.event-detail.internal">Internal</T></small>
            <p>{e.internalNotes || "—"}</p>
          </Section>
        </div>
        <EventStatusPanel
          event={e}
          canChange={canChangeStatus}
          onChanged={setEvent}
        />
        <Allowed action="clients.read">
          <CommunicationLog target={{ eventId: e.id }} />
        </Allowed>
      </Fragment>
    ),
    client: () =>
      client && (
        <Section
          key="client"
          title={<T id="events.event-detail.client">Client</T>}
          action={<Link to={`/clients/${client.id}`}><T id="events.event-detail.open-client">Open client</T></Link>}
        >
          <div className="contact-profile">
            <span className="avatar">{initials(client.name)}</span>
            <div>
              <strong>{client.name}</strong>
              <small>
                {client.kind === "organization" ? <T id="events.event-detail.organization" values={{ value: client.tags.length ? ` · ${client.tags.join(", ")}` : "" }}>{"Organization{value}"}</T> : <T id="events.event-detail.person" values={{ value: client.tags.length ? ` · ${client.tags.join(", ")}` : "" }}>{"Person{value}"}</T>}
              </small>
            </div>
          </div>
          {client.contacts.map((contact) => (
            <div className="contact-profile" key={contact.id}>
              <span className="avatar">{initials(contact.name)}</span>
              <div>
                <strong>
                  {contact.name}
                  {contact.id === e.pocContactId && <T id="events.event-detail.point-of-contact">{" (point of contact)"}</T>}
                </strong>
                <small>
                  <LabelT id="labels.contact-role" value={contact.role}>{contactRoleLabels[contact.role]}</LabelT> · {hidden(contact.email)} ·{" "}
                  {hidden(contact.phone)}
                </small>
              </div>
            </div>
          ))}
        </Section>
      ),
    proposal: () => (
      <EventProposalsSection
        key={`proposal:${e.id}`}
        event={e}
        onEventChanged={() => hub.reload()}
      />
    ),
    inventory: () => (
      <EventPlanningSection key={`planning:${e.id}`} event={e} canEdit={canEdit} />
    ),
    tasks: () => <EventTasksSection key={`tasks:${e.id}`} event={e} />,
    production: () => <EventProductionSection key={`production:${e.id}`} eventId={e.id} />,
    staff: () => (
      <EventStaffSection
        key={`staff:${e.id}`}
        event={e}
        onEventChanged={() => hub.reload()}
      />
    ),
    timeline: () => <EventTimelineSection key={`timeline:${e.id}`} event={e} />,
    planning: () => (
      <EventPlanningProgressSection
        key={`planning-progress:${e.id}`}
        event={e}
        onStarted={() => hub.reload()}
      />
    ),
    pull_list: () => <EventPullListSection key={`pull-list:${e.id}`} event={e} />,
    trucks: () => <EventTruckSection key={`trucks:${e.id}`} event={e} />,
    closeout: () => <EventCloseoutSection key={`closeout:${e.id}`} event={e} />,
    kitchen_menu: () => (
      <EventKitchenMenuSection key={`kitchen-menu:${e.id}`} event={e} />
    ),
    beo: () => <EventBeoSection key={`beo:${e.id}`} event={e} />,
    payments: () => <EventPaymentsSection key={`payments:${e.id}`} event={e} />,
    files: () => (
      <Attachments
        key="files"
        recordType="event"
        recordId={e.id}
        title="Event files"
      />
    ),
    history: () => (
      <EventHistorySection
        key={`history:${e.id}`}
        eventId={e.id}
        version={e.updatedAt}
      />
    ),
  };
  return (
    <>
      {back}
      <div className="record-heading">
        <div>
          <h1>{e.title}</h1>
          <p>
            <StatusPill status={e.status} />
            {e.archivedAt && <span className="badge error"><T id="events.event-detail.archived">Archived</T></span>}
            <span>{when(e)}</span>
          </p>
        </div>
        {canEdit && (
          <div className="page-actions">
            <Allowed action="events.write">
              <Button variant="outline" onClick={() => setEdit(true)}>
                <Pencil size={14} />
                <T id="events.event-detail.edit">Edit</T>
              </Button>
            </Allowed>
            {e.archivedAt ? (
              <Allowed action="events.write">
                <Button
                  variant="outline"
                  onClick={async () =>
                    setEvent(await eventsApi.setArchived(e.id, false))
                  }
                >
                  <RotateCcw size={14} />
                  <T id="events.event-detail.restore">Restore</T>
                </Button>
              </Allowed>
            ) : (
              <Allowed action="events.write">
                <Button variant="outline" onClick={() => setArchive(true)}>
                  <Archive size={14} />
                  <T id="events.event-detail.archive">Archive</T>
                </Button>
              </Allowed>
            )}
          </div>
        )}
      </div>
      <PageGrid
        pageKey="events.detail"
        record={{ source: "events", id: e.id, row: e as unknown as Record<string, unknown> }}
        // The hub's sections, as block ids (FLOW-277 key manifest).
        blockIds={["details", "client", "proposal", "booking", "payments", "beo", "planning", "pull-list", "kitchen-menu", "inventory", "tasks", "production", "timeline", "staff", "trucks", "closeout", "files", "history"]}
      >
        {sections.filter((section) => render[section]).map((section) => (
          <Block key={section} id={section.replace(/_/g, "-")} name={hubSectionNames[section]} h={section === "details" ? 18 : 12}>
            {render[section]!()}
          </Block>
        ))}
      </PageGrid>
      {edit && (
        <EventForm
          event={e}
          shows={shows}
          onClose={() => setEdit(false)}
          // The client may have changed, so reload the whole hub.
          onSaved={() => hub.reload()}
        />
      )}
      <ConfirmationDialog
        open={archive}
        onClose={() => setArchive(false)}
        title={<T id="events.event-detail.archive-this-event">Archive this event?</T>}
        onConfirm={async () => {
          await eventsApi.setArchived(e.id, true);
          setArchive(false);
          navigate("/events");
        }}
      >
        <T id="events.event-detail.will-be-hidden-from-the" values={{ title: e.title }}>{"{title} will be hidden from the event list."}</T>
      </ConfirmationDialog>
    </>
  );
}
