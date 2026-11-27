import { Allowed } from "../../app/permissions";
import { Fragment, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Pencil, Archive, RotateCcw } from "lucide-react";
import { eventStatusDetailLabels, contactRoleLabels, eventStatusSchema, type EventStatus, type FlowEvent } from "../../../shared/core-records";
import { type HubSection } from "../../../shared/event-hub";
import { allPages, clientsApi, eventsApi, venuesApi } from "../../services/core";
import { useResource } from "../../app/useResource";
import { useOpenFor } from "../../app/useOpenFor";
import { LoadMore, useDebounced, usePagedList } from "../../app/paging";
import { Button, Section, ConfirmationDialog, FormField, InfoItem, LoadingSkeleton, ErrorText, UnsavedLeaveGuard } from "../../components/shared";
import { Dropdown } from "../../components/ui/Dropdown";
import { isStale } from "../../components/stale-reload";
import { ListSelect, ListSuggestions } from "../common/list-fields";
import type { ListKey } from "../../../shared/settings";
import { hidden, initials } from "../../components/record-display";
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
import { T, LabelT, useCopy } from "../../app/copy";
import { copySlug } from "../../../shared/copy";
import { StatusPill, StatusSelect } from "../../components/ui/status-pill";
import { statusLabels, when } from "./event-list";
import { countOf, draftOf, type EventDraft } from "./event-form";

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
          <ErrorText message={error} />
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
        <ErrorText message={history.error} />
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

// The client and point of contact in the event page's Edit mode (FLOW-335), as
// the event form picks them: a search of the server as you type, the chosen
// client kept selectable, and that client's contacts.
function EventClientInput({
  clientId,
  pocContactId,
  onChange,
}: {
  clientId: string;
  pocContactId: string | null;
  onChange: (change: { clientId: string; pocContactId: string | null }) => void;
}) {
  const searchPlaceholder = useCopy("events.event-form-fields.type-a-client-or-contact.placeholder", "Type a client or contact name");
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const clients = useResource(
    ["clients", "search", term],
    async () => (await clientsApi.list({ search: term || undefined })).rows,
    { reference: true, keepPrevious: true },
  );
  const listed = clients.data?.find((client) => client.id === clientId);
  const fetched = useResource(["clients", clientId], () => clientsApi.get(clientId), { enabled: Boolean(clientId && !listed) });
  const chosen = listed ?? (fetched.data?.id === clientId ? fetched.data : undefined);
  const options = [...(chosen && !listed ? [chosen] : []), ...(clients.data ?? [])];
  return (
    <span className="info-item-inputs">
      <input
        type="search"
        aria-label="Find client"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={searchPlaceholder}
        data-copy-id="events.event-form-fields.type-a-client-or-contact.placeholder"
      />
      <Dropdown aria-label="Client" value={clientId} onChange={(event) => onChange({ clientId: event.target.value, pocContactId: null })}>
        <option value="">Choose a client</option>
        {options.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
      </Dropdown>
      <Dropdown aria-label="Point of contact" value={pocContactId ?? ""} onChange={(event) => onChange({ clientId, pocContactId: event.target.value || null })}>
        <option value="">No point of contact</option>
        {(chosen?.contacts ?? []).map((contact) => <option key={contact.id} value={contact.id}>{contact.name}</option>)}
      </Dropdown>
      <ErrorText message={clients.error ?? ""} />
    </span>
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
  // Edit mode (FLOW-335): the event's own fields as inputs in place, saved
  // together. Null when not editing.
  const [draft, setDraft] = useState<EventDraft | null>(null);
  const [areas, setAreas] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState("");
  const [archive, setArchive] = useOpenFor(id);
  // Edit shows the fields the page shows (FLOW-255): every one with the code
  // default, else the card's visible boxes.
  const shows = useShownFields("events.detail", "event-facts");
  const venues = useResource(["venues", "all"], () => allPages((cursor) => venuesApi.list({}, cursor)), {
    reference: true,
    enabled: draft !== null,
  });
  // A draft belongs to one event: opening another leaves Edit mode.
  const [draftFor, setDraftFor] = useState(id);
  if (draftFor !== id) {
    setDraftFor(id);
    setDraft(null);
    setEditError("");
  }
  const back = (
    <Link to="/events/overview" className="back-link">
      <T id="events.event-detail.all-events">← All events</T>
    </Link>
  );
  if (hub.error)
    return (
      <>
        {back}
        <ErrorText message={hub.error} />
      </>
    );
  if (!hub.data) return <LoadingSkeleton />;
  const { event: e, client, sections, canEdit, canChangeStatus } = hub.data;
  const setEvent = (event: FlowEvent) => hub.replace({ ...hub.data!, event });
  const editing = draft !== null;
  const areaText = e.areas.map((area) => area.name).join("\n");
  const dirty = editing && (JSON.stringify(draft) !== JSON.stringify(draftOf(e)) || (areas !== undefined && areas !== areaText));
  const set = <K extends keyof EventDraft>(key: K, value: EventDraft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  const startEditing = () => {
    setEditError("");
    setAreas(undefined);
    setDraft(draftOf(e));
  };
  const cancelEditing = () => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    setDraft(null);
    setEditError("");
  };
  const saveEditing = async () => {
    if (!draft) return;
    if (!draft.title.trim() || !draft.date || !draft.startTime || !draft.clientId)
      return setEditError("Title, date, start time and client are required.");
    setSaving(true);
    setEditError("");
    try {
      await eventsApi.update(e.id, {
        ...draft,
        guestCount: countOf(draft.guestCount),
        servingsCount: countOf(draft.servingsCount),
        // Left untouched, areas follow a newly picked venue (the API copies its).
        areas: areas === undefined ? undefined : areas.split("\n").map((area) => area.trim()).filter(Boolean),
        updatedAt: e.updatedAt,
      });
      setDraft(null);
      // The client may have changed, so reload the whole hub.
      hub.reload();
    } catch (cause) {
      if (isStale(cause)) {
        // FLOW-186: start again from the current version.
        try {
          const current = await eventsApi.get(e.id);
          setEvent(current);
          setDraft(draftOf(current));
          setAreas(undefined);
          setEditError("This event changed since you opened it, so your changes weren't saved. The page now shows the current version: make your changes again and save.");
        } catch (reload) {
          setEditError((reload as Error).message);
        }
      } else setEditError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const textInput = (key: "address" | "dressCode", label: string) => (
    <input aria-label={label} value={draft?.[key] ?? ""} onChange={(event) => set(key, event.target.value)} />
  );
  const timeInput = (key: "startTime" | "endTime" | "arrivalTime", label: string) => (
    <input aria-label={label} type="time" value={draft?.[key] ?? ""}
      onChange={(event) => set(key, (event.target.value || (key === "startTime" ? "" : null)) as never)} />
  );
  const countInput = (key: "guestCount" | "servingsCount", label: string) => (
    <input aria-label={label} type="number" min={0} value={draft?.[key] ?? ""} onChange={(event) => set(key, event.target.value)} />
  );
  const listInput = (key: "eventType" | "serviceType" | "foodServiceStyle", label: string, list: ListKey) => (
    <ListSelect label={label} list={list} value={draft?.[key] ?? ""} onChange={(value) => set(key, value)} />
  );
  // Each fact: its label, its value, the field box it belongs to (Edit shows
  // only what the card shows, FLOW-255) and, for a stored field, its input in
  // Edit mode. Status changes in the Status panel; Planning outputs is
  // calculated: neither has an input.
  type Fact = { label: string; value: ReactNode; field?: string; input?: ReactNode };
  const facts: Fact[] = [
    { label: "When", value: when(e), field: "date", input: draft && (
      <span className="info-item-inputs">
        <input aria-label="Date" type="date" value={draft.date} onChange={(event) => set("date", event.target.value)} />
        {timeInput("startTime", "Start time")}
        {timeInput("endTime", "End time")}
      </span>
    ) },
    { label: "Client", value: e.client?.name ?? "—", field: "client", input: draft && (
      <EventClientInput clientId={draft.clientId} pocContactId={draft.pocContactId ?? null}
        onChange={(change) => setDraft((current) => (current ? { ...current, ...change } : current))} />
    ) },
    { label: "Venue", value: e.venue?.name ?? <T id="events.event-detail.no-venue">No venue</T>, field: "venue", input: draft && (
      <Dropdown aria-label="Venue" value={draft.venueId ?? ""} onChange={(event) => set("venueId", event.target.value || null)}>
        <option value="">No venue (use an address)</option>
        {venues.data?.map((venue) => <option key={venue.id} value={venue.id}>{venue.name}</option>)}
      </Dropdown>
    ) },
    { label: "Address", value: e.address || "—", field: "address", input: draft && textInput("address", "Address") },
    { label: "Areas", value: e.areas.map((area) => area.name).join(", ") || "—", input: draft && (
      <textarea aria-label="Areas, one per line" rows={3} value={areas ?? areaText} onChange={(event) => setAreas(event.target.value)} />
    ) },
    { label: "Event type", value: e.eventType || "—", field: "eventType", input: draft && listInput("eventType", "Event type", "event_type") },
    { label: "Service type", value: e.serviceType || "—", field: "serviceType", input: draft && listInput("serviceType", "Service type", "service_type") },
    { label: "Food service style", value: e.foodServiceStyle || "—", field: "foodServiceStyle", input: draft && listInput("foodServiceStyle", "Food service style", "food_service_style") },
    { label: "Guests", value: e.guestCount?.toString() ?? "—", field: "guestCount", input: draft && countInput("guestCount", "Guests") },
    { label: "Servings", value: e.servingsCount?.toString() ?? "—", field: "servingsCount", input: draft && countInput("servingsCount", "Servings") },
    { label: "Dress code", value: e.dressCode || "—", field: "dressCode", input: draft && (
      <>
        <input aria-label="Dress code" list="dress-code-presets" value={draft.dressCode ?? ""} onChange={(event) => set("dressCode", event.target.value)} />
        <ListSuggestions id="dress-code-presets" list="dress_code" />
      </>
    ) },
    { label: "Arrival at venue", value: e.arrivalTime ? time(e.arrivalTime) : "—", field: "arrivalTime", input: draft && timeInput("arrivalTime", "Arrival at venue") },
    { label: "Status", value: <LabelT id="labels.pipeline-status" value={e.status}>{statusLabels[e.status]}</LabelT> },
    ...(e.planningStaleAt ? [{ label: "Planning outputs", value: <T id="events.event-detail.needs-refresh-since" values={{ date: new Date(e.planningStaleAt).toLocaleDateString() }}>{"Needs refresh since {date}"}</T> }] : []),
  ];
  const factGrid = (
    <div className="info-grid">
      {facts.filter((fact) => !editing || !fact.field || shows(fact.field)).map((fact) => (
        <InfoItem key={fact.label} label={<T id={`events.event-detail.${copySlug(fact.label)}`}>{fact.label}</T>}
          editing={editing} input={fact.input ?? undefined}>
          {fact.value}
        </InfoItem>
      ))}
    </div>
  );
  const render: Partial<Record<HubSection, () => ReactNode>> = {
    details: () => (
      <Fragment key="details">
        <div className="detail-grid">
          {/* In Edit mode the facts show as inputs whatever the card's saved
              boxes; only the fields the card shows (FLOW-255). */}
          {editing ? (
            <Section title={<T id="events.event-detail.event-details">Event details</T>}>{factGrid}</Section>
          ) : (
          <FieldCard cardKey="event-facts" source="events" row={e as unknown as Record<string, unknown>}
            title={<T id="events.event-detail.event-details">Event details</T>}
            fields={["title", "date", "client", "venue", "address", "eventType", "serviceType", "foodServiceStyle", "guestCount", "servingsCount", "dressCode", "arrivalTime", "status"]}>
          <Section title={<T id="events.event-detail.event-details">Event details</T>}>
            {factGrid}
            {e.venue && (
              <p>
                <Link to={`/venues/${e.venue.id}`}><T id="events.event-detail.open-venue">Open venue</T></Link>
              </p>
            )}
          </Section>
          </FieldCard>
          )}
          <Section title={<T id="events.event-detail.notes">Notes</T>}>
            {draft ? (
              <>
                <FormField label={<T id="events.event-detail.transportation">Transportation</T>}>
                  <textarea rows={2} value={draft.transportationNotes} onChange={(event) => set("transportationNotes", event.target.value)} />
                </FormField>
                <FormField label={<T id="events.event-detail.internal">Internal</T>}>
                  <textarea rows={3} value={draft.internalNotes} onChange={(event) => set("internalNotes", event.target.value)} />
                </FormField>
              </>
            ) : (
              <>
                <small><T id="events.event-detail.transportation">Transportation</T></small>
                <p>{e.transportationNotes || "—"}</p>
                <small><T id="events.event-detail.internal">Internal</T></small>
                <p>{e.internalNotes || "—"}</p>
              </>
            )}
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
          <h1>{draft ? <input aria-label="Title" className="record-title-input" value={draft.title} onChange={(event) => set("title", event.target.value)} /> : e.title}</h1>
          <p>
            <StatusPill status={e.status} />
            {e.archivedAt && <span className="badge error"><T id="events.event-detail.archived">Archived</T></span>}
            <span>{when(e)}</span>
          </p>
        </div>
        {canEdit && editing && (
          <div className="page-actions">
            <Button variant="outline" onClick={cancelEditing}><T id="events.event-detail.cancel">Cancel</T></Button>
            <Button disabled={saving} onClick={() => void saveEditing()}><T id="events.event-detail.save">Save</T></Button>
          </div>
        )}
        {canEdit && !editing && (
          <div className="page-actions">
            <Allowed action="events.write">
              <Button variant="outline" onClick={startEditing}>
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
      <ErrorText message={editError} />
      {editing && <UnsavedLeaveGuard dirty={dirty} />}
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
      <ConfirmationDialog
        open={archive}
        onClose={() => setArchive(false)}
        title={<T id="events.event-detail.archive-this-event">Archive this event?</T>}
        onConfirm={async () => {
          await eventsApi.setArchived(e.id, true);
          setArchive(false);
          navigate("/events/overview");
        }}
      >
        <T id="events.event-detail.will-be-hidden-from-the" values={{ title: e.title }}>{"{title} will be hidden from the event list."}</T>
      </ConfirmationDialog>
    </>
  );
}
