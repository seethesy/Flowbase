import { Dropdown } from "../../components/ui/Dropdown";
import { useState } from "react";
import { eventStatusSchema, type EventInput, type FlowEvent } from "../../../shared/core-records";
import { allPages, clientsApi, eventsApi, venuesApi } from "../../services/core";
import { StaleReload, isStale } from "../../components/stale-reload";
import { useResource } from "../../app/useResource";
import { useDebounced } from "../../app/paging";
import { Button, DetailDrawer, FormField } from "../../components/shared";
import { LoadError } from "../../components/record-display";

import { ListSelect, ListSuggestions } from "../common/list-fields";
import { type ListKey } from "../../../shared/settings";
import { T, useCopy } from "../../app/copy";
import { StatusSelect } from "../../components/ui/status-pill";

// The event create/edit form (FLOW-25).

type Draft = Omit<EventInput, "guestCount" | "servingsCount"> & {
  guestCount: string;
  servingsCount: string;
};

const draftOf = (event?: FlowEvent, clientId = ""): Draft => ({
  title: event?.title ?? "",
  date: event?.date ?? "",
  startTime: event?.startTime ?? "",
  endTime: event?.endTime ?? null,
  clientId: event?.client?.id ?? clientId,
  pocContactId: event?.pocContactId ?? null,
  venueId: event?.venue?.id ?? null,
  address: event?.address ?? "",
  eventType: event?.eventType ?? "",
  serviceType: event?.serviceType ?? "",
  foodServiceStyle: event?.foodServiceStyle ?? "",
  guestCount: event?.guestCount?.toString() ?? "",
  servingsCount: event?.servingsCount?.toString() ?? "",
  dressCode: event?.dressCode ?? "",
  arrivalTime: event?.arrivalTime ?? null,
  transportationNotes: event?.transportationNotes ?? "",
  internalNotes: event?.internalNotes ?? "",
  status: event?.status ?? "inquiry",
});

const countOf = (value: string) =>
  value.trim() === "" ? null : Math.max(0, Math.round(Number(value)));

type EventFormProps = {
  event?: FlowEvent;
  clientId?: string;
  // Which optional fields to show: the event page's visible field boxes (FLOW-255).
  shows?: (field: string) => boolean;
  onClose: () => void;
  onSaved: (event: FlowEvent) => void;
};

// Edits reload the current version when the save was made from a stale copy
// (FLOW-186).
export function EventForm(props: EventFormProps) {
  return (
    <StaleReload
      record={props.event}
      load={(id) => eventsApi.get(id)}
      what="event"
    >
      {({ record, conflict, onStale }) => (
        <EventFormFields
          key={record?.updatedAt ?? "new"}
          {...props}
          event={record}
          conflict={conflict}
          onStale={onStale}
        />
      )}
    </StaleReload>
  );
}

function EventFormFields({
  event,
  clientId,
  shows = () => true,
  onClose,
  onSaved,
  conflict,
  onStale,
}: EventFormProps & { conflict: string; onStale: () => Promise<void> }) {
  const typeAClientOrContactPlaceholder = useCopy("events.event-form-fields.type-a-client-or-contact.placeholder", "Type a client or contact name");
  const [draft, setDraft] = useState<Draft>(() => draftOf(event, clientId));
  // Left untouched, areas follow the venue: the API copies a newly picked venue's.
  const [areas, setAreas] = useState<string | undefined>(
    event ? event.areas.map((area) => area.name).join("\n") : undefined,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // The client picker searches the server as you type (FLOW-179); the chosen
  // client stays selectable even when it isn't in the current matches.
  const [clientSearch, setClientSearch] = useState("");
  const clientTerm = useDebounced(clientSearch.trim());
  const clients = useResource(
    ["clients", "search", clientTerm],
    async () =>
      (await clientsApi.list({ search: clientTerm || undefined })).rows,
    { reference: true, keepPrevious: true },
  );
  const listed = clients.data?.find((client) => client.id === draft.clientId);
  const fetched = useResource(
    ["clients", draft.clientId],
    () => clientsApi.get(draft.clientId),
    { enabled: Boolean(draft.clientId && !listed) },
  );
  const chosen =
    listed ?? (fetched.data?.id === draft.clientId ? fetched.data : undefined);
  const clientOptions = [
    ...(chosen && !listed ? [chosen] : []),
    ...(clients.data ?? []),
  ];
  const venues = useResource(
    ["venues", "all"],
    () => allPages((cursor) => venuesApi.list({}, cursor)),
    { reference: true },
  );
  const contacts = chosen?.contacts ?? [];
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const text = (key: keyof Draft, label: string, type = "text") => (
    <FormField label={label}>
      <input
        type={type}
        value={String(draft[key] ?? "")}
        onChange={(e) =>
          set(
            key,
            (e.target.value ||
              (key === "endTime" || key === "arrivalTime" ? null : "")) as never,
          )
        }
      />
    </FormField>
  );
  // Choices come from business settings (FLOW-45).
  const list = (
    key: "eventType" | "serviceType" | "foodServiceStyle",
    label: string,
    listKey: ListKey,
  ) => (
    <FormField label={label}>
      <ListSelect
        list={listKey}
        value={draft[key] ?? ""}
        onChange={(value) => set(key, value)}
      />
    </FormField>
  );
  const save = async () => {
    if (!draft.title.trim() || !draft.date || !draft.startTime || !draft.clientId)
      return setError("Title, date, start time and client are required.");
    const input: EventInput = {
      ...draft,
      guestCount: countOf(draft.guestCount),
      servingsCount: countOf(draft.servingsCount),
      areas:
        areas === undefined
          ? undefined
          : areas
              .split("\n")
              .map((area) => area.trim())
              .filter(Boolean),
    };
    setSaving(true);
    setError("");
    try {
      onSaved(
        event
          ? await eventsApi.update(event.id, {
              ...input,
              updatedAt: event.updatedAt,
            })
          : await eventsApi.create(input),
      );
      onClose();
    } catch (e) {
      if (event && isStale(e)) {
        await onStale();
        return;
      }
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={event ? <T id="events.event-form-fields.edit-event">Edit event</T> : <T id="events.event-form-fields.new-event">New event</T>}
      description={<T id="events.event-form-fields.only-title-date-start-time">Only title, date, start time and client are required.</T>}
      wide
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {conflict && (
          <p role="alert" className="error-message">
            {conflict}
          </p>
        )}
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        {(clients.error || venues.error) && (
          <LoadError message={clients.error ?? venues.error ?? ""} />
        )}
        <FormField label={<T id="events.event-form-fields.title">Title *</T>}>
          <input
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            autoFocus
          />
        </FormField>
        <div className="form-grid">
          {text("date", "Date *", "date")}
          <FormField label={<T id="events.event-form-fields.find-client">Find client</T>}>
            <input
              type="search"
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              placeholder={typeAClientOrContactPlaceholder} data-copy-id="events.event-form-fields.type-a-client-or-contact.placeholder"
            />
          </FormField>
          <FormField label={<T id="events.event-form-fields.client">Client *</T>}>
            <Dropdown
              value={draft.clientId}
              onChange={(e) => {
                set("clientId", e.target.value);
                set("pocContactId", null);
              }}
            >
              <option value="">Choose a client</option>
              {clientOptions.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Dropdown>
          </FormField>
          {text("startTime", "Start time *", "time")}
          {text("endTime", "End time", "time")}
          <FormField label={<T id="events.event-form-fields.point-of-contact">Point of contact</T>}>
            <Dropdown
              value={draft.pocContactId ?? ""}
              onChange={(e) => set("pocContactId", e.target.value || null)}
            >
              <option value="">None</option>
              {contacts.map((contact) => (
                <option key={contact.id} value={contact.id}>
                  {contact.name}
                </option>
              ))}
            </Dropdown>
          </FormField>
          {/* Any status on create; afterwards it changes on the event page. */}
          {!event && (
            <FormField label={<T id="events.event-form-fields.status">Status</T>}>
              <StatusSelect value={draft.status ?? "inquiry"} includeEventStages onChange={(value) => set("status", eventStatusSchema.parse(value))} />
            </FormField>
          )}
          <FormField label={<T id="events.event-form-fields.venue">Venue</T>}>
            <Dropdown
              value={draft.venueId ?? ""}
              onChange={(e) => set("venueId", e.target.value || null)}
            >
              <option value="">No venue (use an address)</option>
              {venues.data?.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </Dropdown>
          </FormField>
          {shows("address") && <FormField label={<T id="events.event-form-fields.address">Address</T>} hint={<T id="events.event-form-fields.leave-empty-to-use-the">{"Leave empty to use the venue's."}</T>}>
            <input
              value={draft.address}
              onChange={(e) => set("address", e.target.value)}
            />
          </FormField>}
          {shows("eventType") && list("eventType", "Event type", "event_type")}
          {shows("serviceType") && list("serviceType", "Service type", "service_type")}
          {shows("foodServiceStyle") && list("foodServiceStyle", "Food service style", "food_service_style")}
          {shows("dressCode") && <FormField label={<T id="events.event-form-fields.dress-code">Dress code</T>} hint={<T id="events.event-form-fields.pick-a-preset-or-type">Pick a preset or type your own.</T>}>
            <input
              list="dress-code-presets"
              value={draft.dressCode ?? ""}
              onChange={(e) => set("dressCode", e.target.value)}
            />
            <ListSuggestions id="dress-code-presets" list="dress_code" />
          </FormField>}
          {shows("arrivalTime") && text("arrivalTime", "Arrival time at venue", "time")}
          {shows("guestCount") && text("guestCount", "Guest count", "number")}
          {shows("servingsCount") && text("servingsCount", "Servings count", "number")}
        </div>
        <FormField
          label={<T id="events.event-form-fields.areas">Areas</T>}
          hint={<T id="events.event-form-fields.one-per-line-left-unchanged">{"One per line. Left unchanged, a newly picked venue's areas are used."}</T>}
        >
          <textarea
            rows={3}
            value={areas ?? ""}
            onChange={(e) => setAreas(e.target.value)}
          />
        </FormField>
        {shows("transportationNotes") && <FormField label={<T id="events.event-form-fields.transportation-notes">Transportation notes</T>}>
          <textarea
            rows={2}
            value={draft.transportationNotes}
            onChange={(e) => set("transportationNotes", e.target.value)}
          />
        </FormField>}
        {shows("internalNotes") && <FormField label={<T id="events.event-form-fields.internal-notes">Internal notes</T>}>
          <textarea
            rows={3}
            value={draft.internalNotes}
            onChange={(e) => set("internalNotes", e.target.value)}
          />
        </FormField>}
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            <T id="events.event-form-fields.cancel">Cancel</T>
          </Button>
          <Button type="submit" disabled={saving}>
            <T id="events.event-form-fields.save-event">Save event</T>
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}
