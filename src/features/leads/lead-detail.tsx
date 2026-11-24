import { Allowed } from "../../app/permissions";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import {
  assignedElsewhereMessage,
  defaultLeadSources,
  leadChannelLabels,
  leadChannelSchema,
  leadDuplicateReasonLabels,
  lostReasonRequired,
  type Lead,
  type LeadChannel,
  type LeadStatus,
  type LeadUpdateInput,
} from "../../../shared/leads";
import { businessTimeToUtc, utcToBusinessTime } from "../../../shared/time";
import { leadsApi } from "../../services/leads";
import { useResource } from "../../app/useResource";
import { beoStatusLabels } from "../../../shared/beo";
import { useOpenFor, useStateFor } from "../../app/useOpenFor";
import {
  Button,
  Section,
  FormField,
  InfoItem,
  LoadingSkeleton,
  ErrorText,
  UnsavedLeaveGuard,
} from "../../components/shared";
import { StatusSelect } from "../../components/ui/status-pill";
import { Dropdown } from "../../components/ui/Dropdown";
import { useListLabels } from "../common/list-fields";
import "./leads.css";
import { ConvertLeadForm } from "./lead-convert";
import { CommunicationLog } from "../common/communications";
import { SummaryLine } from "./lead-inbox";
import {
  AssignForm,
  businessDate,
  duration,
  eventDay,
  leadTitle,
  money,
} from "./lead-shared";
import { T, LabelT } from "../../app/copy";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { FieldCard, useShownFields } from "../../app/live-edit/field-card";
import type { JSONContent } from "@tiptap/core";
import { RichTextEditor } from "../../components/rich-text/RichTextEditor";
import { RichTextView } from "../../components/rich-text/RichTextView";
import { emptyRichText } from "../../components/rich-text/extensions";

// The lead page's Edit mode (FLOW-334): every stored field the page shows, as
// typed. Saved together; only what changed is sent.
type LeadDraft = {
  name: string;
  email: string;
  phone: string;
  eventName: string;
  eventDate: string;
  eventTime: string;
  guestCount: string;
  eventType: string;
  location: string;
  budget: string;
  message: string;
  source: string;
  channel: LeadChannel;
  // "YYYY-MM-DDTHH:mm", New York time.
  received: string;
  sourceLeadId: string;
  sourceLeadUrl: string;
  lostReason: string;
  status: LeadStatus;
  notes: JSONContent | null;
};
const wallClock = (iso: string) => {
  const { date, time } = utcToBusinessTime(new Date(iso));
  return { date, time };
};
export const leadDraft = (lead: Lead): LeadDraft => {
  const received = wallClock(lead.receivedAt);
  return {
    name: lead.name,
    email: lead.email ?? "",
    phone: lead.phone ?? "",
    eventName: lead.eventName ?? "",
    eventDate: lead.eventDate ?? "",
    eventTime: lead.latestEvent ? wallClock(lead.latestEvent.startsAt).time : "",
    guestCount: lead.guestCount === null ? "" : String(lead.guestCount),
    eventType: lead.eventType,
    location: lead.location,
    budget: lead.budgetCents === null ? "" : String(lead.budgetCents / 100),
    message: lead.message,
    source: lead.source,
    channel: lead.channel,
    received: `${received.date}T${received.time}`,
    sourceLeadId: lead.sourceLeadId,
    sourceLeadUrl: lead.sourceLeadUrl,
    lostReason: lead.lostReason,
    status: lead.status,
    notes: lead.notes ?? null,
  };
};
// The fields that changed, as PUT /api/leads/:id takes them. The status is
// saved through its own route.
export function leadChanges(before: LeadDraft, after: LeadDraft): LeadUpdateInput {
  const changed = (key: keyof LeadDraft) => JSON.stringify(before[key]) !== JSON.stringify(after[key]);
  const input: LeadUpdateInput = {};
  for (const key of ["name", "email", "phone", "eventName", "eventType", "location", "message", "source", "sourceLeadId", "sourceLeadUrl"] as const)
    if (changed(key)) input[key] = after[key].trim();
  if (changed("channel")) input.channel = after.channel;
  if (changed("eventDate")) input.eventDate = after.eventDate || null;
  if (changed("eventTime") && after.eventTime) input.eventTime = after.eventTime;
  if (changed("guestCount")) input.guestCount = after.guestCount.trim() === "" ? null : Number(after.guestCount);
  if (changed("budget")) input.budgetCents = after.budget.trim() === "" ? null : Math.round(Number(after.budget) * 100);
  if (changed("received") && after.received) {
    const [date, time] = after.received.split("T");
    input.receivedAt = businessTimeToUtc(date, time).toISOString();
  }
  // A lost lead's reason; a lead moving to Lost takes it with the status.
  if (changed("lostReason") && before.status === "lost") input.lostReason = after.lostReason.trim();
  if (changed("notes")) input.notes = after.notes;
  return input;
}

export function LeadDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const lead = useResource(
    ["leads", id],
    () => leadsApi.get(id),
  );
  const [error, setError] = useStateFor(id, "");
  const [busy, setBusy] = useState(false);
  const [newEvent, setNewEvent] = useState(false);
  const [draft, setDraft] = useState<LeadDraft | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState<JSONContent>(emptyRichText);
  const [convert, setConvert] = useOpenFor(id);
  const [linkClientId, setLinkClientId] = useStateFor(id, "");
  const [eventTitle, setEventTitle] = useStateFor(`${id}-event-title`, "");
  const [eventDate, setEventDate] = useStateFor(`${id}-event-date`, "");
  const [eventTime, setEventTime] = useStateFor(`${id}-event-time`, "");
  const events = useResource(["lead-events", id], () => leadsApi.events(id));
  const beos = useResource(["lead-beos", id], () => leadsApi.beos(id));
  // Edit shows the fields the page shows (FLOW-255): every one with the code
  // default, else the card's visible boxes.
  const shows = useShownFields("leads.detail", "lead-facts");
  const listedSources = useListLabels("lead_source");
  if (lead.error)
    return (
      <>
        <Link to="/leads" className="back-link">
          <T id="lead-detail.lead-detail.all-leads">← All leads</T>
        </Link>
        <ErrorText message={lead.error} />
      </>
    );
  const l = lead.data;
  if (!l) return <LoadingSkeleton />;
  const editing = draft !== null;
  const original = leadDraft(l);
  const dirty = editing && JSON.stringify(draft) !== JSON.stringify(original);
  const set = <K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  // A text input bound to a draft field.
  const field = (key: "name" | "email" | "phone" | "eventName" | "eventType" | "location" | "sourceLeadId", label: string, type = "text") => (
    <input aria-label={label} type={type} value={draft?.[key] ?? ""} onChange={(event) => set(key, event.target.value)} />
  );
  // Contact details the viewer may not see come back empty (null): not editable.
  const contactHidden = (l.email as string | null) === null || (l.phone as string | null) === null;
  const sources = [...new Set([...(listedSources.length ? listedSources : defaultLeadSources), l.source, ...(draft ? [draft.source] : [])])];
  const startEditing = () => {
    setError("");
    setDraft(leadDraft(l));
  };
  const cancelEditing = () => {
    if (dirty && !window.confirm("Discard your unsaved changes?")) return;
    setDraft(null);
  };
  const saveEditing = async () => {
    if (!draft) return;
    const movesTo = draft.status !== l.status ? draft.status : null;
    if (movesTo === "lost" && !draft.lostReason.trim()) return setError(lostReasonRequired);
    if ((draft.status === "lost" && l.status === "lost") && !draft.lostReason.trim()) return setError(lostReasonRequired);
    setBusy(true);
    setError("");
    try {
      const changes = leadChanges(original, draft);
      let saved = Object.keys(changes).length ? await leadsApi.update(l.id, changes) : l;
      if (movesTo && movesTo !== "closing")
        saved = await leadsApi.setStatus(l.id, { status: movesTo, reason: movesTo === "lost" ? draft.lostReason.trim() : "" });
      lead.replace(saved);
      setDraft(null);
      // Closing creates the client and event: its own dialog takes over.
      if (movesTo === "closing") setConvert(true);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const move = async (status: LeadStatus, why = "") => {
    if (status === "closing") { setConvert(true); return; }
    if (status === "lost" && !why) {
      const prompted = window.prompt("Why was this lead lost?");
      if (!prompted?.trim()) return;
      why = prompted.trim();
    }
    setBusy(true);
    setError("");
    try {
      lead.replace(await leadsApi.setStatus(l.id, { status, reason: why }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const resolve = async (run: () => Promise<Lead | null>) => {
    setBusy(true);
    setError("");
    try {
      const kept = await run();
      if (kept && kept.id !== l.id) navigate(`/leads/${kept.id}`);
      else if (kept) lead.replace(kept);
      else lead.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const duplicates = l.duplicates ?? [];
  const factCards = (
      <>
        <Section title={<T id="lead-detail.lead-detail.contact">Contact</T>}>
          <div className="info-grid">
            <InfoItem label={<T id="lead-detail.lead-detail.name">Name</T>} editing={editing} input={field("name", "Name")}>{l.name || "—"}</InfoItem>
            {shows("email") && <InfoItem label={<T id="lead-detail.lead-detail.email">Email</T>} editing={editing} input={contactHidden ? undefined : field("email", "Email", "email")}>{l.email || "—"}</InfoItem>}
            {shows("phone") && <InfoItem label={<T id="lead-detail.lead-detail.phone">Phone</T>} editing={editing} input={contactHidden ? undefined : field("phone", "Phone", "tel")}>{l.phone || "—"}</InfoItem>}
          </div>
        </Section>
        <Section title={<T id="lead-detail.lead-detail.event">Event</T>}>
          <div className="info-grid">
            {shows("eventName") && <InfoItem label={<T id="lead-detail.lead-detail.event-name">Event name</T>} editing={editing} input={field("eventName", "Event name")}>{l.eventName || "—"}</InfoItem>}
            {shows("eventDate") && <InfoItem label={<T id="lead-detail.lead-detail.event-date">Event date</T>} editing={editing}
              input={<input aria-label="Event date" type="date" value={draft?.eventDate ?? ""} onChange={(event) => set("eventDate", event.target.value)} />}>{eventDay(l.eventDate)}</InfoItem>}
            {/* The time is the start time of the lead's latest event, when it has one. */}
            {l.latestEvent && shows("eventDate") && <InfoItem label={<T id="lead-detail.lead-detail.event-time">Event time</T>} editing={editing}
              input={<input aria-label="Event time" type="time" value={draft?.eventTime ?? ""} onChange={(event) => set("eventTime", event.target.value)} />}>{original.eventTime || "—"}</InfoItem>}
            {shows("guestCount") && <InfoItem label={<T id="lead-detail.lead-detail.guests">Guests</T>} editing={editing}
              input={<input aria-label="Guests" type="number" min={0} value={draft?.guestCount ?? ""} onChange={(event) => set("guestCount", event.target.value)} />}>{l.guestCount ?? "—"}</InfoItem>}
            {shows("eventType") && <InfoItem label={<T id="lead-detail.lead-detail.event-type">Event type</T>} editing={editing} input={field("eventType", "Event type")}>{l.eventType || "—"}</InfoItem>}
            {shows("location") && <InfoItem label={<T id="lead-detail.lead-detail.location">Location</T>} editing={editing} input={field("location", "Location")}>{l.location || "—"}</InfoItem>}
            {shows("budgetCents") && <InfoItem label={<T id="lead-detail.lead-detail.budget">Budget</T>} editing={editing}
              input={<input aria-label="Budget" type="number" min={0} step="0.01" value={draft?.budget ?? ""} onChange={(event) => set("budget", event.target.value)} />}>{money(l.budgetCents)}</InfoItem>}
            {shows("message") && <InfoItem wide label={<T id="lead-detail.lead-detail.message">Message</T>} editing={editing}
              input={<textarea aria-label="Message" rows={4} value={draft?.message ?? ""} onChange={(event) => set("message", event.target.value)} />}>
              {l.message || <T id="lead-detail.lead-detail.no-message">No message.</T>}</InfoItem>}
          </div>
        </Section>
      </>
  );
  return (
    <>
      <Link to="/leads" className="back-link">
        <T id="lead-detail.lead-detail.all-leads">← All leads</T>
      </Link>
      <div className="record-heading">
        <div>
          <h1>{draft ? draft.name || leadTitle(l) : leadTitle(l)}</h1>
          <p>
            {/* In Edit mode the status is part of the draft, saved with the rest. */}
            <StatusSelect label="Lead status" value={draft?.status ?? l.status}
              onChange={(value) => (draft ? set("status", value as LeadStatus) : void move(value as LeadStatus))} disabled={busy} />
            {l.needsReview && (
              <span className="badge warning"><T id="lead-detail.lead-detail.needs-review">Needs review</T></span>
            )}
            {l.purchased && <span className="badge neutral"><T id="lead-detail.lead-detail.purchased">Purchased</T></span>}
          </p>
        </div>
        <div className="page-actions">
          <Allowed action="leads.update">{editing ? <>
            <Button variant="outline" onClick={cancelEditing}><T id="lead-detail.edit.cancel">Cancel</T></Button>
            <Button disabled={busy} onClick={() => void saveEditing()}><T id="lead-detail.edit.save">Save</T></Button>
          </> : <Button variant="outline" onClick={startEditing}><T id="lead-detail.edit.edit">Edit</T></Button>}</Allowed>
          <Allowed action="leads.update"><Button onClick={() => setNewEvent(true)}><T id="lead-detail.edit.new-event">New event</T></Button></Allowed>
        </div>
      </div>
      <ErrorText message={error} />
      {editing && <UnsavedLeaveGuard dirty={dirty} />}
      {l.assignedElsewhere && (
        <p role="note" className="demo-callout">
          <TriangleAlert size={14} /> {assignedElsewhereMessage}
        </p>
      )}
      {duplicates.length > 0 && (
        <Section title={<T id="lead-detail.lead-detail.possible-duplicates">Possible duplicates</T>}>
          <ul className="duplicate-list">
            {duplicates.map((match) => (
              <li key={match.duplicateId} className="duplicate-pair">
                <p>
                  <strong><LabelT id="labels.lead-duplicate-reason" value={match.reason}>{leadDuplicateReasonLabels[match.reason]}</LabelT></strong>
                </p>
                {match.lead ? (
                  <p>
                    <Link to={`/leads/${match.lead.id}`}>
                      {match.lead.name || <T id="lead-detail.lead-detail.unnamed-lead">Unnamed lead</T>}
                    </Link>{" "}
                    <small><SummaryLine lead={match.lead} /></small>
                  </p>
                ) : (
                  match.client && (
                    <p>
                      <T id="lead-detail.lead-detail.client">{"Client "}</T>
                      <Link to={`/clients/${match.client.id}`}>
                        {match.client.name}
                      </Link>
                    </p>
                  )
                )}
                <div className="page-actions">
                  {match.lead && (
                    <Allowed action="leads.merge">
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void resolve(() =>
                            leadsApi.merge(match.duplicateId, l.id),
                          )
                        }
                      >
                        <T id="lead-detail.lead-detail.merge-into-this-lead">Merge into this lead</T>
                      </Button>
                    </Allowed>
                  )}
                  {match.client && l.status !== "closed" && l.status !== "lost" && (
                    <Allowed action="leads.convert">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setLinkClientId(match.client!.id);
                          setConvert(true);
                        }}
                      >
                        <T id="lead-detail.lead-detail.convert-and-link-to" values={{ name: match.client.name }}>{"Convert and link to {name}"}</T>
                      </Button>
                    </Allowed>
                  )}
                  <Allowed action="leads.merge">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void resolve(() => leadsApi.dismiss(match.duplicateId))
                      }
                    >
                      <T id="lead-detail.lead-detail.not-a-duplicate">Not a duplicate</T>
                    </Button>
                  </Allowed>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {(l.status === "closing" || l.status === "closed") && (
        <p role="note" className="demo-callout">
          <T id="lead-detail.lead-detail.converted">{"Converted. "}</T>
          {l.convertedClientId && (
            <Link to={`/clients/${l.convertedClientId}`}><T id="lead-detail.lead-detail.view-client">View client</T></Link>
          )}{" "}
          {l.convertedEventId && (
            <Link to={`/events/${l.convertedEventId}`}><T id="lead-detail.lead-detail.view-event">View event</T></Link>
          )}
        </p>
      )}
      <div className="detail-grid">
        <PageGrid pageKey="leads.detail" record={{ source: "leads", id: l.id, row: l as unknown as Record<string, unknown> }}>
        <Block id="linked-events" name="Linked events" w={6} h={8}>
        <Section title={<T id="lead-detail.events.title">Linked events</T>}>
          <ul>{events.data?.map((event) => {
            const beo = beos.data?.find((item) => item.eventId === event.id);
            return <li key={event.id}><Link to={`/events/${event.id}`}>{event.title}</Link> · {eventDay(event.date)}
              {beo && <>{" · "}<Link to={`/events/${event.id}/beo/${beo.id}`}><T id="lead-detail.events.beo-version" values={{ version: beo.version, status: beoStatusLabels[beo.status] }}>{"BEO: v{version} ({status})"}</T></Link></>}</li>;
          })}</ul>
          {newEvent && l.status !== "lost" && <form onSubmit={async (event) => {
            event.preventDefault(); setBusy(true); setError("");
            try { await leadsApi.createEvent(id, { title: eventTitle, date: eventDate, startTime: eventTime });
              setEventTitle(""); setEventDate(""); setEventTime(""); setNewEvent(false); events.reload(); }
            catch (cause) { setError((cause as Error).message); }
            finally { setBusy(false); }
          }}><FormField label="Event name"><input required value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} /></FormField>
            <FormField label="Date"><input required type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></FormField>
            <FormField label="Start time"><input required type="time" value={eventTime} onChange={(event) => setEventTime(event.target.value)} /></FormField>
            <Button disabled={busy}><T id="lead-detail.events.add">Add event</T></Button><Button variant="outline" type="button" onClick={() => setNewEvent(false)}><T id="lead-detail.events.cancel">Cancel</T></Button></form>}
        </Section>
        </Block>
        <Block id="notes" name="Notes" w={6} h={10}>
        <section id="notes"><Section title={<T id="lead-detail.notes.title">Notes</T>}>
          {draft ? <RichTextEditor label="Lead notes" value={draft.notes ?? emptyRichText} onChange={(value) => set("notes", value)} />
          : editingNotes ? <form onSubmit={async (event) => {
            event.preventDefault(); setBusy(true); setError("");
            try { lead.replace(await leadsApi.update(id, { notes })); setEditingNotes(false); }
            catch (cause) { setError((cause as Error).message); }
            finally { setBusy(false); }
          }}><RichTextEditor label="Lead notes" value={notes} onChange={setNotes} />
            <Button type="submit" disabled={busy}><T id="lead-detail.notes.save">Save notes</T></Button>
            <Button type="button" variant="outline" onClick={() => setEditingNotes(false)}><T id="lead-detail.notes.cancel">Cancel</T></Button>
          </form> : <>{l.notes ? <RichTextView doc={l.notes} /> : <p><T id="lead-detail.notes.empty">No notes yet.</T></p>}
            <Button variant="outline" onClick={() => { setNotes(l.notes ?? emptyRichText); setEditingNotes(true); }}><T id="lead-detail.notes.edit">Edit notes</T></Button></>}
        </Section></section>
        </Block>
        <Block id="lead-facts" name="Contact and event" h={14}>
        {/* In Edit mode the facts show as inputs whatever the card's saved boxes;
            only the fields the card shows (FLOW-255). */}
        {editing ? factCards : (
        <FieldCard cardKey="lead-facts" source="leads" row={l as unknown as Record<string, unknown>}
          title={<T id="lead-detail.lead-facts.title">Lead details</T>}
          fields={["name", "email", "phone", "eventName", "eventDate", "guestCount", "eventType", "location", "budgetCents", "source", "message"]}>
          {factCards}
        </FieldCard>
        )}
        </Block>
        <Block id="source" name="Source" w={6} h={10}>
        <Section title={<T id="lead-detail.lead-detail.source">Source</T>}>
          <div className="info-grid">
            <InfoItem label={<T id="lead-detail.lead-detail.source">Source</T>} editing={editing}
              input={<Dropdown aria-label="Source" variant="field" value={draft?.source ?? l.source}
                options={sources.map((value) => ({ value, label: value }))} onValueChange={(value) => set("source", value)} />}>{l.source}</InfoItem>
            <InfoItem label={<T id="lead-detail.lead-detail.channel">Channel</T>} editing={editing}
              input={<Dropdown aria-label="Channel" variant="field" value={draft?.channel ?? l.channel}
                options={leadChannelSchema.options.map((value) => ({
                  value,
                  label: <LabelT id="labels.lead-channel" value={value}>{leadChannelLabels[value]}</LabelT>,
                  text: leadChannelLabels[value],
                }))}
                onValueChange={(value) => set("channel", value as LeadChannel)} />}>
              <LabelT id="labels.lead-channel" value={l.channel}>{leadChannelLabels[l.channel]}</LabelT>
            </InfoItem>
            <InfoItem label={<T id="lead-detail.lead-detail.received">Received</T>} editing={editing}
              input={<input aria-label="Received" type="datetime-local" value={draft?.received ?? ""} onChange={(event) => set("received", event.target.value)} />}>
              {businessDate(l.receivedAt)}
            </InfoItem>
            {/* Calculated from Received and the first move to Contacted: never an input. */}
            <InfoItem label={<T id="lead-detail.lead-detail.first-response">First response</T>} editing={editing}>
              {l.firstResponseSeconds === null
                ? <T id="lead-detail.lead-detail.not-yet">Not yet</T>
                : duration(l.firstResponseSeconds)}
            </InfoItem>
            <InfoItem label={<T id="lead-detail.lead-detail.source-lead">Source lead</T>} editing={editing}
              input={field("sourceLeadId", "Source lead")}>
              {l.sourceLeadUrl ? (
                <a href={l.sourceLeadUrl} target="_blank" rel="noreferrer">
                  {l.sourceLeadId || <T id="lead-detail.lead-detail.open-on-source">Open on source</T>}
                </a>
              ) : (
                l.sourceLeadId || "—"
              )}
            </InfoItem>
            {editing && <InfoItem label={<T id="lead-detail.lead-detail.source-lead-link">Source lead link</T>} editing
              input={<input aria-label="Source lead link" type="url" value={draft?.sourceLeadUrl ?? ""} onChange={(event) => set("sourceLeadUrl", event.target.value)} />}>
              {l.sourceLeadUrl || "—"}
            </InfoItem>}
            {(draft?.status ?? l.status) === "lost" && (
              <InfoItem wide label={<T id="lead-detail.lead-detail.lost-reason-2">Lost reason</T>} editing={editing}
                input={<textarea aria-label="Lost reason" rows={2} value={draft?.lostReason ?? ""} onChange={(event) => set("lostReason", event.target.value)} />}>
                {l.lostReason}
              </InfoItem>
            )}
          </div>
        </Section>
        </Block>
        {(l.sourceLinks?.length ?? 0) > 1 && (
          <Block id="source-links" name="Source links" w={6} h={8}>
          <Section title={<T id="lead-detail.lead-detail.source-links">Source links</T>}>
            <ul aria-label="Source links">
              {l.sourceLinks!.map((link) => (
                <li key={link.leadId}>
                  {link.source} · <LabelT id="labels.lead-channel" value={link.channel}>{leadChannelLabels[link.channel]}</LabelT> ·{" "}
                  {link.sourceLeadUrl ? (
                    <a
                      href={link.sourceLeadUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {link.sourceLeadId || <T id="lead-detail.lead-detail.open-on-source">Open on source</T>}
                    </a>
                  ) : (
                    link.sourceLeadId || "—"
                  )}{" "}
                  <small>
                    {link.mergedAt
                      ? <T id="lead-detail.lead-detail.merged-by" values={{ businessDate: businessDate(link.mergedAt), value: link.mergedBy ?? "—" }}>{"merged {businessDate} by {value}"}</T>
                      : <T id="lead-detail.lead-detail.received-2" values={{ businessDate: businessDate(link.receivedAt) }}>{"received {businessDate}"}</T>}
                  </small>
                </li>
              ))}
            </ul>
          </Section>
          </Block>
        )}
        <Block id="assignment" name="Assignment" w={6} h={8}>
        <Section title={<T id="lead-detail.lead-detail.assignment">Assignment</T>}>
          <p>
            <T id="lead-detail.lead-detail.salesperson">{"Salesperson: "}</T>
            <strong>{l.assignedSalespersonId ?? <T id="lead-detail.lead-detail.unassigned">Unassigned</T>}</strong>
          </p>
          <Allowed action="leads.assign">
            <AssignForm
              label={<T id="lead-detail.lead-detail.assign-to-user-id">Assign to (user ID)</T>}
              button={l.assignedSalespersonId ? <T id="lead-detail.lead-detail.reassign">Reassign</T> : <T id="lead-detail.lead-detail.assign">Assign</T>}
              onAssign={async (salespersonId) =>
                lead.replace(await leadsApi.assign(l.id, salespersonId))
              }
            />
          </Allowed>
        </Section>
        </Block>
        </PageGrid>
      </div>
      <CommunicationLog target={{ leadId: l.id }} />
      {l.rawPayload !== null && l.rawPayload !== undefined && (
        <Section title={<T id="lead-detail.lead-detail.raw-payload">Raw payload</T>}>
          <pre className="muted">{JSON.stringify(l.rawPayload, null, 2)}</pre>
        </Section>
      )}
      {convert && (
        <ConvertLeadForm
          lead={l}
          linkClientId={linkClientId}
          onClose={() => {
            setConvert(false);
            setLinkClientId("");
          }}
          onConverted={(result) => navigate(`/events/${result.event.id}`)}
        />
      )}
    </>
  );
}
