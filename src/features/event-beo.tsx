import { useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Printer, Send } from "lucide-react";
import type { FlowEvent } from "../../shared/core-records";
import {
  beoSectionLabels,
  beoSections,
  beoStatusLabels,
  type BeoContact,
  type BeoSection,
  type BeoView,
} from "../../shared/beo";
import { useResource } from "../app/useResource";
import { Button, LoadingSkeleton, Section } from "../components/shared";
import { LoadError } from "../components/record-display";
import { cachedBeo, isNetworkError } from "../offline/db";
import { beoApi } from "../services/beo";
import { eventsApi } from "../services/core";
import { BeoAreaList, BeoCleanup } from "./beo-areas";
import { BeoSchedule } from "./beo-schedule";
import "./event-beo.css";

// The banquet event order (FLOW-143, 144, 148): the ten sections in order, what is
// still open or TBD marked, and what changed since approval marked until the next
// approval. Contacts arrive already limited to what this role may see.

const Tbd = () => <span className="beo-tbd">TBD</span>;
const Open = () => <span className="beo-open">OPEN</span>;
const when = (iso: string) => new Date(iso).toLocaleString();

// Says the BEO is saved on this device for reading offline, and when it was last
// saved (FLOW-150).
function OfflineStatus({ eventId }: { eventId: string }) {
  const saved = useResource(["offline-copy", eventId], () => cachedBeo(eventId));
  if (!saved.data) return null;
  return (
    <p className="muted" data-testid="offline-status">
      Available offline · last synced {when(saved.data.syncedAt)}
    </p>
  );
}

function Contact({ contact, hidden }: { contact: BeoContact; hidden: boolean }) {
  return (
    <li>
      <strong>{contact.name}</strong> <small>{contact.role}</small>
      {!hidden && (contact.phone || contact.email) && (
        <small>{[contact.phone, contact.email].filter(Boolean).join(" · ")}</small>
      )}
    </li>
  );
}

// standalone: shown on the BEO's own page (/events/<id>/beo/<beo id>, FLOW-221),
// where time is credited to the BEO; the hub's copy links to that page.
export function EventBeoSection({
  event,
  standalone = false,
}: {
  event: FlowEvent;
  standalone?: boolean;
}) {
  const beo = useResource(["event-beo", event.id], () => beoApi.get(event.id));
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<{ setup: string; extra: string } | null>(null);
  if (beo.error)
    return (
      <Section title="Banquet event order">
        <LoadError message={beo.error} />
      </Section>
    );
  if (!beo.data) return <LoadingSkeleton />;
  const data: BeoView = beo.data;
  const { content } = data;
  const run = async (action: () => Promise<BeoView>) => {
    setError("");
    try {
      beo.replace(await action());
      setNotes(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const changed = (section: BeoSection) => data.changedFields.filter((field) => field.section === section);
  const marks = (section: BeoSection) =>
    changed(section).length > 0 && (
      <p className="beo-changed" role="note">
        Changed since approval: {changed(section).map((field) => field.label).join(", ")}
      </p>
    );
  const part = (section: BeoSection, body: ReactNode) => (
    <div className="beo-section" key={section} data-section={section}>
      <h3>
        {beoSections.indexOf(section) + 1}. {beoSectionLabels[section]}
      </h3>
      {marks(section)}
      {body}
    </div>
  );
  const hidden = content.event.contactHidden;
  const sectionBodies: Record<BeoSection, ReactNode> = {
    header: (
      <p>
        <strong>{content.event.title}</strong> · {content.header.eventDate}
      </p>
    ),
    event: (
      <>
        <p>
          Client: <strong>{content.event.client}</strong>
        </p>
        {content.event.pointOfContact && (
          <ul className="beo-list">
            <Contact contact={content.event.pointOfContact} hidden={hidden} />
          </ul>
        )}
        <p>
          Venue: {content.event.venue || "No venue"}
          {content.event.address && ` · ${content.event.address}`}
        </p>
        {hidden && <p className="muted">Phone numbers and emails are for full-time staff.</p>}
        {content.event.clientContacts.length > 0 && (
          <ul className="beo-list" aria-label="Client contacts">
            {content.event.clientContacts.map((c, i) => (
              <Contact key={`c${i}`} contact={c} hidden={hidden} />
            ))}
          </ul>
        )}
        {content.event.venueContacts.length > 0 && (
          <ul className="beo-list" aria-label="Venue contacts">
            {content.event.venueContacts.map((c, i) => (
              <Contact key={`v${i}`} contact={c} hidden={hidden} />
            ))}
          </ul>
        )}
      </>
    ),
    summary: (
      <dl className="beo-facts">
        <dt>When</dt>
        <dd>
          {content.summary.date} {content.summary.startTime}
          {content.summary.endTime && `–${content.summary.endTime}`}
        </dd>
        <dt>Crew arrives</dt>
        <dd>{content.summary.arrivalTime ?? <Tbd />}</dd>
        <dt>Guests</dt>
        <dd>{content.summary.guestCount ?? <Tbd />}</dd>
        <dt>Servings</dt>
        <dd>{content.summary.servings ?? <Tbd />}</dd>
        <dt>Service</dt>
        <dd>
          {[content.summary.eventType, content.summary.serviceType, content.summary.foodServiceStyle]
            .filter(Boolean)
            .join(" · ") || "—"}
        </dd>
        <dt>Dress code</dt>
        <dd>{content.summary.dressCode || "—"}</dd>
      </dl>
    ),
    food_setup: (
      <>
        {content.foodSetup.leavesKitchenTime && <p>Food leaves the kitchen at {content.foodSetup.leavesKitchenTime}.</p>}
        {content.foodSetup.courses.length === 0 && <p className="muted">No dishes yet.</p>}
        {content.foodSetup.courses.map((course) => (
          <div key={course.course}>
            <h4>{course.course}</h4>
            <ul className="beo-list">
              {course.lines.map((line, i) => (
                <li key={`${line.name}${i}`}>
                  <strong>{line.name}</strong> × {line.tbd ? <Tbd /> : line.quantity}
                  <small>
                    {[line.dietaryTags.join(", "), line.allergens.length ? `Allergens: ${line.allergens.join(", ")}` : "", line.notes]
                      .filter(Boolean)
                      .join(" · ")}
                  </small>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {content.foodSetup.allergens.length > 0 && (
          <p>
            <strong>Allergens:</strong> {content.foodSetup.allergens.join(", ")}
          </p>
        )}
        {content.foodSetup.dietaryTags.length > 0 && (
          <p>
            <strong>Dietary:</strong> {content.foodSetup.dietaryTags.join(", ")}
          </p>
        )}
      </>
    ),
    staff: (
      <>
        <p>
          Production lead: {content.staff.productionLead ?? <Open />}
          {content.staff.assistantLeads.length > 0 && ` · Assistants: ${content.staff.assistantLeads.join(", ")}`}
        </p>
        {content.staff.shifts.map((shift, i) => (
          <div key={`${shift.kind}${i}`}>
            <h4>
              {shift.kindLabel} · {shift.date} {shift.startTime}–{shift.endTime}
            </h4>
            {shift.activities && <p>{shift.activities}</p>}
            <ul className="beo-list">
              {shift.slots.map((slot, j) => (
                <li key={`${slot.label}${j}`}>
                  {slot.label}: {slot.assignee ?? <Open />}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {content.staff.openSlots > 0 && <p className="beo-open">{content.staff.openSlots} open</p>}
      </>
    ),
    timeline: <BeoSchedule eventId={event.id} data={data} onChange={beo.replace} />,
    equipment: (
      <>
        {content.equipment.groups.length === 0 && <p className="muted">No equipment on the pull list yet.</p>}
        {content.equipment.groups.map((group) => (
          <div key={group.label}>
            <h4>{group.label}</h4>
            <ul className="beo-list">
              {group.lines.map((line, i) => (
                <li key={`${line.name}${i}`}>
                  {line.name} × {line.tbd ? <Tbd /> : line.quantity}
                  {line.notes && <small>{line.notes}</small>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </>
    ),
    layout: (
      <>
        <BeoAreaList kind="layout" event={event} data={data} areas={content.layout.areas} onChange={beo.replace} />
        {content.layout.loadInNotes && <p>Load-in: {content.layout.loadInNotes}</p>}
        {content.layout.parkingNotes && <p>Parking: {content.layout.parkingNotes}</p>}
      </>
    ),
    setup_cleanup: (
      <>
        {content.setupCleanup.transportationNotes && <p>Transportation: {content.setupCleanup.transportationNotes}</p>}
        <p>{content.setupCleanup.setupDetails || <span className="muted">No setup details yet.</span>}</p>
        <BeoAreaList kind="setup" event={event} data={data} areas={content.setupCleanup.areas} onChange={beo.replace} />
        <BeoCleanup eventId={event.id} data={data} onChange={beo.replace} />
      </>
    ),
    notes: <p>{content.notes.additionalNotes || <span className="muted">None.</span>}</p>,
  };

  return (
    <Section
      title="Banquet event order"
      action={
        <span className="page-actions">
          {data.status && <span className={`badge ${data.status === "approved" ? "success" : "neutral"}`}>{beoStatusLabels[data.status]}</span>}
          {!standalone && data.id && (
            <Button variant="outline" asChild>
              <Link to={`/events/${event.id}/beo/${data.id}`}>Open BEO page</Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to={`/print/events/${event.id}/beo`}>
              <Printer size={14} />
              Print
            </Link>
          </Button>
          {!data.exists && data.canEdit && (
            <Button onClick={() => void run(() => beoApi.generate(event.id))}>Generate BEO</Button>
          )}
          {data.canRequestApproval && !data.canApprove && (
            <Button variant="outline" onClick={() => void run(() => beoApi.requestApproval(event.id))}>
              <Send size={14} />
              Request approval
            </Button>
          )}
          {data.exists && data.status !== "approved" && data.canApprove && (
            <Button onClick={() => void run(() => beoApi.approve(event.id))}>
              <Check size={14} />
              Approve
            </Button>
          )}
        </span>
      }
    >
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <OfflineStatus eventId={event.id} />
      {!data.exists && <p className="muted">This is a preview. Generate the BEO to start working on it.</p>}
      {data.approvedAt && (
        <p className="muted">
          Approved {when(data.approvedAt)}
          {data.approvedBy && ` by ${data.approvedBy.name}`}.
        </p>
      )}
      {beoSections.map((section) => part(section, sectionBodies[section]))}
      {data.exists && data.canEdit && (
        <div className="beo-edit">
          {notes ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(() =>
                  beoApi.saveNotes(event.id, {
                    setupDetails: notes.setup,
                    additionalNotes: notes.extra,
                  }),
                );
              }}
            >
              <label className="form-field">
                <span>Setup details</span>
                <textarea value={notes.setup} onChange={(e) => setNotes({ ...notes, setup: e.target.value })} />
              </label>
              <label className="form-field">
                <span>Additional notes</span>
                <textarea value={notes.extra} onChange={(e) => setNotes({ ...notes, extra: e.target.value })} />
              </label>
              <Button type="submit">Save</Button>
              <Button type="button" variant="ghost" onClick={() => setNotes(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            <Button
              variant="outline"
              onClick={() =>
                setNotes({
                  setup: content.setupCleanup.setupDetails,
                  extra: content.notes.additionalNotes,
                })
              }
            >
              Edit setup details and notes
            </Button>
          )}
        </div>
      )}
      {data.changes.length > 0 && (
        <div className="beo-log">
          <h3>Changes after approval</h3>
          <ul className="beo-list">
            {data.changes.map((change) => (
              <li key={change.id} data-marked={change.marked || undefined}>
                <strong>{change.fieldLabel}</strong>: {change.from || "(empty)"} → {change.to || "(empty)"}
                <small>
                  {change.changedBy?.name ?? "Someone"} · {when(change.changedAt)}
                </small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Section>
  );
}

// The BEO's own page, /events/<event id>/beo/<beo id> (FLOW-221): the same order as
// the event hub shows, on a screen where time is credited to the BEO with the BEO
// editing activity. The beo id in the address must belong to the event.
export function EventBeoPage() {
  const { id = "", beoId = "" } = useParams();
  const event = useResource(["beo-page-event", id], async () => {
    try {
      return await eventsApi.get(id);
    } catch (error) {
      // With no signal, the event saved with the offline BEO (FLOW-150).
      const saved = isNetworkError(error) ? await cachedBeo(id) : undefined;
      if (!saved) throw error;
      return saved.event;
    }
  });
  const beo = useResource(["event-beo", id], () => beoApi.get(id));
  const back = (
    <Link to={`/events/${id}`} className="back-link">
      ← Back to event
    </Link>
  );
  if (event.error || beo.error)
    return (
      <>
        {back}
        <LoadError message={(event.error ?? beo.error)!} />
      </>
    );
  if (!event.data || !beo.data) return <LoadingSkeleton />;
  if (beo.data.id !== beoId.toLowerCase())
    return (
      <>
        {back}
        <LoadError message="BEO not found." />
      </>
    );
  return (
    <>
      {back}
      <div className="record-heading">
        <h1>{event.data.title}</h1>
      </div>
      <EventBeoSection event={event.data} standalone />
    </>
  );
}
