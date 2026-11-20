import { Allowed } from "../app/permissions";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import {
  assignedElsewhereMessage,
  leadChannelLabels,
  leadDuplicateReasonLabels,
  type Lead,
  type LeadStatus,
} from "../../shared/leads";
import { leadsApi } from "../services/leads";
import { useResource } from "../app/useResource";
import { beoStatusLabels } from "../../shared/beo";
import { useOpenFor, useStateFor } from "../app/useOpenFor";
import {
  Button,
  Section,
  FormField,
  LoadingSkeleton,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { StatusSelect } from "../components/ui/status-pill";
import "./leads.css";
import { ConvertLeadForm } from "./lead-convert";
import { CommunicationLog } from "./communications";
import { summaryLine } from "./lead-inbox";
import {
  AssignForm,
  businessDate,
  duration,
  eventDay,
  leadTitle,
  money,
} from "./lead-shared";
import { T } from "../app/copy";
import type { JSONContent } from "@tiptap/core";
import { RichTextEditor } from "../components/rich-text/RichTextEditor";
import { RichTextView } from "../components/rich-text/RichTextView";
import { emptyRichText } from "../components/rich-text/extensions";

export function LeadDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const lead = useResource(
    ["leads", id],
    () => leadsApi.get(id),
  );
  const [error, setError] = useStateFor(id, "");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newEvent, setNewEvent] = useState(false);
  const [draft, setDraft] = useState({ name: "", email: "", phone: "", eventName: "", eventDate: "" });
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState<JSONContent>(emptyRichText);
  const [convert, setConvert] = useOpenFor(id);
  const [linkClientId, setLinkClientId] = useStateFor(id, "");
  const [eventTitle, setEventTitle] = useStateFor(`${id}-event-title`, "");
  const [eventDate, setEventDate] = useStateFor(`${id}-event-date`, "");
  const [eventTime, setEventTime] = useStateFor(`${id}-event-time`, "");
  const events = useResource(["lead-events", id], () => leadsApi.events(id));
  const beos = useResource(["lead-beos", id], () => leadsApi.beos(id));
  if (lead.error)
    return (
      <>
        <Link to="/leads" className="back-link">
          <T id="lead-detail.lead-detail.all-leads">← All leads</T>
        </Link>
        <LoadError message={lead.error} />
      </>
    );
  const l = lead.data;
  if (!l) return <LoadingSkeleton />;
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
  return (
    <>
      <Link to="/leads" className="back-link">
        <T id="lead-detail.lead-detail.all-leads">← All leads</T>
      </Link>
      <div className="record-heading">
        <div>
          <h1>{editing ? <input aria-label="Lead name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /> : leadTitle(l)}</h1>
          <p>
            <StatusSelect label="Lead status" value={l.status}
              onChange={(value) => void move(value as LeadStatus)} disabled={busy} />
            {l.needsReview && (
              <span className="badge warning"><T id="lead-detail.lead-detail.needs-review">Needs review</T></span>
            )}
            {l.purchased && <span className="badge neutral"><T id="lead-detail.lead-detail.purchased">Purchased</T></span>}
          </p>
        </div>
        <div className="page-actions">
          <Allowed action="leads.update">{editing ? <>
            <Button variant="outline" onClick={() => {
              const original = { name: l.name, email: l.email, phone: l.phone,
                eventName: l.eventName ?? "", eventDate: l.eventDate ?? "" };
              if (JSON.stringify(draft) !== JSON.stringify(original) && !window.confirm("Discard changes?")) return;
              setEditing(false);
            }}><T id="lead-detail.edit.cancel">Cancel</T></Button>
            <Button type="submit" form="lead-edit-form" disabled={busy}><T id="lead-detail.edit.save">Save</T></Button>
          </> : <Button variant="outline" onClick={() => { setDraft({ name: l.name,
            email: l.email, phone: l.phone, eventName: l.eventName ?? "", eventDate: l.eventDate ?? "" });
            setEditing(true); }}><T id="lead-detail.edit.edit">Edit</T></Button>}</Allowed>
          <Allowed action="leads.update"><Button onClick={() => setNewEvent(true)}><T id="lead-detail.edit.new-event">New event</T></Button></Allowed>
        </div>
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
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
                  <strong>{leadDuplicateReasonLabels[match.reason]}</strong>
                </p>
                {match.lead ? (
                  <p>
                    <Link to={`/leads/${match.lead.id}`}>
                      {match.lead.name || <T id="lead-detail.lead-detail.unnamed-lead">Unnamed lead</T>}
                    </Link>{" "}
                    <small>{summaryLine(match.lead)}</small>
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
        {editing && <Section title={<T id="lead-detail.edit.title">Edit lead</T>}>
          <form id="lead-edit-form" className="form-grid" onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true); setError("");
            try { lead.replace(await leadsApi.update(id, { ...draft, eventDate: draft.eventDate || null })); setEditing(false); }
            catch (cause) { setError((cause as Error).message); }
            finally { setBusy(false); }
          }}>
            <FormField label="Event"><input value={draft.eventName} onChange={(event) => setDraft({ ...draft, eventName: event.target.value })} /></FormField>
            <FormField label="Phone"><input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></FormField>
            <FormField label="Email"><input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></FormField>
            <FormField label="Time & Date"><input type="date" value={draft.eventDate} onChange={(event) => setDraft({ ...draft, eventDate: event.target.value })} /></FormField>
          </form>
        </Section>}
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
        <section id="notes"><Section title={<T id="lead-detail.notes.title">Notes</T>}>
          {editingNotes ? <form onSubmit={async (event) => {
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
        <Section title={<T id="lead-detail.lead-detail.contact">Contact</T>}>
          <div className="info-grid">
            <div>
              <small><T id="lead-detail.lead-detail.name">Name</T></small>
              <strong>{l.name || "—"}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.email">Email</T></small>
              <strong>{l.email || "—"}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.phone">Phone</T></small>
              <strong>{l.phone || "—"}</strong>
            </div>
          </div>
        </Section>
        <Section title={<T id="lead-detail.lead-detail.event">Event</T>}>
          <div className="info-grid">
            <div>
              <small><T id="lead-detail.lead-detail.event-date">Event date</T></small>
              <strong>{eventDay(l.eventDate)}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.guests">Guests</T></small>
              <strong>{l.guestCount ?? "—"}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.event-type">Event type</T></small>
              <strong>{l.eventType || "—"}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.location">Location</T></small>
              <strong>{l.location || "—"}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.budget">Budget</T></small>
              <strong>{money(l.budgetCents)}</strong>
            </div>
          </div>
          <h3 className="form-subheading"><T id="lead-detail.lead-detail.message">Message</T></h3>
          <p>{l.message || <T id="lead-detail.lead-detail.no-message">No message.</T>}</p>
        </Section>
        <Section title={<T id="lead-detail.lead-detail.source">Source</T>}>
          <div className="info-grid">
            <div>
              <small><T id="lead-detail.lead-detail.source">Source</T></small>
              <strong>{l.source}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.channel">Channel</T></small>
              <strong>{leadChannelLabels[l.channel]}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.received">Received</T></small>
              <strong>{businessDate(l.receivedAt)}</strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.first-response">First response</T></small>
              <strong>
                {l.firstResponseSeconds === null
                  ? <T id="lead-detail.lead-detail.not-yet">Not yet</T>
                  : duration(l.firstResponseSeconds)}
              </strong>
            </div>
            <div>
              <small><T id="lead-detail.lead-detail.source-lead">Source lead</T></small>
              <strong>
                {l.sourceLeadUrl ? (
                  <a href={l.sourceLeadUrl} target="_blank" rel="noreferrer">
                    {l.sourceLeadId || <T id="lead-detail.lead-detail.open-on-source">Open on source</T>}
                  </a>
                ) : (
                  l.sourceLeadId || "—"
                )}
              </strong>
            </div>
          </div>
          {l.status === "lost" && (
            <>
              <h3 className="form-subheading"><T id="lead-detail.lead-detail.lost-reason-2">Lost reason</T></h3>
              <p>{l.lostReason}</p>
            </>
          )}
        </Section>
        {(l.sourceLinks?.length ?? 0) > 1 && (
          <Section title={<T id="lead-detail.lead-detail.source-links">Source links</T>}>
            <ul aria-label="Source links">
              {l.sourceLinks!.map((link) => (
                <li key={link.leadId}>
                  {link.source} · {leadChannelLabels[link.channel]} ·{" "}
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
        )}
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
