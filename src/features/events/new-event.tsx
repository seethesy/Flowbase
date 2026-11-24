import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { FlowEvent } from "../../../shared/core-records";
import type { Lead } from "../../../shared/leads";
import { leadsApi } from "../../services/leads";
import { useResource } from "../../app/useResource";
import { useDebounced } from "../../app/paging";
import { Button, FormDrawer, FormField } from "../../components/shared";
import { Dropdown } from "../../components/ui/Dropdown";
import { Allowed } from "../../app/permissions";
import { T, useCopy } from "../../app/copy";
import { EventForm } from "./event-form";

// New event on Events › Overview (FLOW-336). The lead is optional (A1): with a
// lead, the event is created from it as on the lead page (title, date, start
// time); without one, the full event form asks for the client. Either way the
// new event opens.
export function NewEventButton() {
  const [open, setOpen] = useState(false);
  return (
    <Allowed action="events.write">
      <Button onClick={() => setOpen(true)}><T id="events-screen.calendar.new-event">New event</T></Button>
      {open && <NewEventDrawer onClose={() => setOpen(false)} />}
    </Allowed>
  );
}

const leadName = (lead: Lead) => lead.name || "Unnamed lead";

export function NewEventDrawer({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const placeholder = useCopy("events.new-event.find-lead.placeholder", "Type a lead name, email or phone");
  const [withoutLead, setWithoutLead] = useState(false);
  const [search, setSearch] = useState("");
  const term = useDebounced(search.trim());
  const leads = useResource(
    ["leads", "picker", term],
    async () => (await leadsApi.list({ search: term || undefined })).rows,
    { reference: true, keepPrevious: true },
  );
  const [leadId, setLeadId] = useState("");
  const [draft, setDraft] = useState({ title: "", date: "", startTime: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const opened = (event: FlowEvent) => navigate(`/events/${event.id}`);

  if (withoutLead) return <EventForm onClose={onClose} onSaved={opened} />;

  const rows = leads.data ?? [];
  const chosen = rows.find((lead) => lead.id === leadId);
  const save = async () => {
    if (!leadId) return setWithoutLead(true);
    if (!draft.title.trim() || !draft.date || !draft.startTime)
      return setError("Event name, date and start time are required.");
    setSaving(true);
    setError("");
    try {
      opened(await leadsApi.createEvent(leadId, draft));
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDrawer
      onClose={onClose}
      title={<T id="events.new-event.title">New event</T>}
      description={<T id="events.new-event.description">Pick the lead the event is for, or continue without a lead and choose its client.</T>}
      onSubmit={save}
      error={error || leads.error}
      saving={saving}
      saveLabel={leadId ? <T id="events.new-event.save">Save event</T> : <T id="events.new-event.continue-without-lead">Continue without a lead</T>}
      cancelLabel={<T id="events.new-event.cancel">Cancel</T>}
    >
      <FormField label={<T id="events.new-event.find-lead">Find lead</T>}>
        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={placeholder} data-copy-id="events.new-event.find-lead.placeholder" autoFocus />
      </FormField>
      <FormField label={<T id="events.new-event.lead">Lead</T>}>
        <Dropdown
          aria-label="Lead"
          value={leadId}
          options={[
            { value: "", label: <T id="events.new-event.no-lead">No lead</T>, text: "No lead" },
            ...rows.map((lead) => ({
              value: lead.id,
              label: lead.status === "lost" ? `${leadName(lead)} (lost)` : leadName(lead),
              text: leadName(lead),
              disabled: lead.status === "lost",
            })),
          ]}
          onValueChange={(id) => {
            setLeadId(id);
            const lead = rows.find((row) => row.id === id);
            // The lead's event details, when it has them, start the form.
            if (lead) setDraft((current) => ({
              title: current.title || lead.eventName || "",
              date: current.date || lead.eventDate || "",
              startTime: current.startTime,
            }));
          }}
        />
      </FormField>
      {chosen && <>
        <FormField label={<T id="events.new-event.event-name">Event name *</T>}>
          <input value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </FormField>
        <div className="form-grid">
          <FormField label={<T id="events.new-event.date">Date *</T>}>
            <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
          </FormField>
          <FormField label={<T id="events.new-event.start-time">Start time *</T>}>
            <input type="time" value={draft.startTime} onChange={(e) => setDraft({ ...draft, startTime: e.target.value })} />
          </FormField>
        </div>
      </>}
    </FormDrawer>
  );
}
