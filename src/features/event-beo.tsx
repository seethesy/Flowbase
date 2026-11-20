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
import { T } from "../app/copy";
import "./event-beo.css";

// The banquet event order (FLOW-143, 144, 148): the ten sections in order, what is
// still open or TBD marked, and what changed since approval marked until the next
// approval. Contacts arrive already limited to what this role may see.

const Tbd = () => <span className="beo-tbd"><T id="event-beo.tbd.tbd">TBD</T></span>;
const Open = () => <span className="beo-open"><T id="event-beo.open.open">OPEN</T></span>;
const when = (iso: string) => new Date(iso).toLocaleString();

// Says the BEO is saved on this device for reading offline, and when it was last
// saved (FLOW-150).
function OfflineStatus({ eventId }: { eventId: string }) {
  const saved = useResource(["offline-copy", eventId], () => cachedBeo(eventId));
  if (!saved.data) return null;
  return (
    <p className="muted" data-testid="offline-status">
      <T id="event-beo.offline-status.available-offline-last-synced" values={{ when: when(saved.data.syncedAt) }}>{"Available offline · last synced {when}"}</T>
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
      <Section title={<T id="event-beo.event-beo-section.banquet-event-order">Banquet event order</T>}>
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
        <T id="event-beo.marks.changed-since-approval">{"Changed since approval: "}</T>{changed(section).map((field) => field.label).join(", ")}
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
          <T id="event-beo.event-beo-section.client">{"Client: "}</T><strong>{content.event.client}</strong>
        </p>
        {content.event.pointOfContact && (
          <ul className="beo-list">
            <Contact contact={content.event.pointOfContact} hidden={hidden} />
          </ul>
        )}
        <p>
          <T id="event-beo.event-beo-section.venue">{"Venue: "}</T>{content.event.venue || <T id="event-beo.event-beo-section.no-venue">No venue</T>}
          {content.event.address && ` · ${content.event.address}`}
        </p>
        {hidden && <p className="muted"><T id="event-beo.event-beo-section.phone-numbers-and-emails-are">Phone numbers and emails are for full-time staff.</T></p>}
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
        <dt><T id="event-beo.event-beo-section.when">When</T></dt>
        <dd>
          {content.summary.date} {content.summary.startTime}
          {content.summary.endTime && `–${content.summary.endTime}`}
        </dd>
        <dt><T id="event-beo.event-beo-section.crew-arrives">Crew arrives</T></dt>
        <dd>{content.summary.arrivalTime ?? <Tbd />}</dd>
        <dt><T id="event-beo.event-beo-section.guests">Guests</T></dt>
        <dd>{content.summary.guestCount ?? <Tbd />}</dd>
        <dt><T id="event-beo.event-beo-section.servings">Servings</T></dt>
        <dd>{content.summary.servings ?? <Tbd />}</dd>
        <dt><T id="event-beo.event-beo-section.service">Service</T></dt>
        <dd>
          {[content.summary.eventType, content.summary.serviceType, content.summary.foodServiceStyle]
            .filter(Boolean)
            .join(" · ") || "—"}
        </dd>
        <dt><T id="event-beo.event-beo-section.dress-code">Dress code</T></dt>
        <dd>{content.summary.dressCode || "—"}</dd>
      </dl>
    ),
    food_setup: (
      <>
        {content.foodSetup.leavesKitchenTime && <p><T id="event-beo.event-beo-section.food-leaves-the-kitchen-at" values={{ leavesKitchenTime: content.foodSetup.leavesKitchenTime }}>{"Food leaves the kitchen at {leavesKitchenTime}."}</T></p>}
        {content.foodSetup.courses.length === 0 && <p className="muted"><T id="event-beo.event-beo-section.no-dishes-yet">No dishes yet.</T></p>}
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
            <strong><T id="event-beo.event-beo-section.allergens">Allergens:</T></strong> {content.foodSetup.allergens.join(", ")}
          </p>
        )}
        {content.foodSetup.dietaryTags.length > 0 && (
          <p>
            <strong><T id="event-beo.event-beo-section.dietary">Dietary:</T></strong> {content.foodSetup.dietaryTags.join(", ")}
          </p>
        )}
      </>
    ),
    staff: (
      <>
        <p>
          <T id="event-beo.event-beo-section.production-lead">{"Production lead: "}</T>{content.staff.productionLead ?? <Open />}
          {content.staff.assistantLeads.length > 0 && <T id="event-beo.event-beo-section.assistants" values={{ join: content.staff.assistantLeads.join(", ") }}>{" · Assistants: {join}"}</T>}
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
        {content.staff.openSlots > 0 && <p className="beo-open"><T id="event-beo.event-beo-section.open" values={{ openSlots: content.staff.openSlots }}>{"{openSlots} open"}</T></p>}
      </>
    ),
    timeline: <BeoSchedule eventId={event.id} data={data} onChange={beo.replace} />,
    equipment: (
      <>
        {content.equipment.groups.length === 0 && <p className="muted"><T id="event-beo.event-beo-section.no-equipment-on-the-pull">No equipment on the pull list yet.</T></p>}
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
        {content.layout.loadInNotes && <p><T id="event-beo.event-beo-section.load-in" values={{ loadInNotes: content.layout.loadInNotes }}>{"Load-in: {loadInNotes}"}</T></p>}
        {content.layout.parkingNotes && <p><T id="event-beo.event-beo-section.parking" values={{ parkingNotes: content.layout.parkingNotes }}>{"Parking: {parkingNotes}"}</T></p>}
      </>
    ),
    setup_cleanup: (
      <>
        {content.setupCleanup.transportationNotes && <p><T id="event-beo.event-beo-section.transportation" values={{ transportationNotes: content.setupCleanup.transportationNotes }}>{"Transportation: {transportationNotes}"}</T></p>}
        <p>{content.setupCleanup.setupDetails || <span className="muted"><T id="event-beo.event-beo-section.no-setup-details-yet">No setup details yet.</T></span>}</p>
        <BeoAreaList kind="setup" event={event} data={data} areas={content.setupCleanup.areas} onChange={beo.replace} />
        <BeoCleanup eventId={event.id} data={data} onChange={beo.replace} />
      </>
    ),
    notes: <p>{content.notes.additionalNotes || <span className="muted"><T id="event-beo.event-beo-section.none">None.</T></span>}</p>,
  };

  return (
    <Section
      title={<T id="event-beo.event-beo-section.banquet-event-order">Banquet event order</T>}
      action={
        <span className="page-actions">
          {data.status && <span className={`badge ${data.status === "approved" ? "success" : "neutral"}`}>{beoStatusLabels[data.status]}</span>}
          {!standalone && data.id && (
            <Button variant="outline" asChild>
              <Link to={`/events/${event.id}/beo/${data.id}`}><T id="event-beo.event-beo-section.open-beo-page">Open BEO page</T></Link>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to={`/print/events/${event.id}/beo`}>
              <Printer size={14} />
              <T id="event-beo.event-beo-section.print">Print</T>
            </Link>
          </Button>
          {!data.exists && data.canEdit && (
            <Button onClick={() => void run(() => beoApi.generate(event.id))}><T id="event-beo.event-beo-section.generate-beo">Generate BEO</T></Button>
          )}
          {data.canRequestApproval && !data.canApprove && (
            <Button variant="outline" onClick={() => void run(() => beoApi.requestApproval(event.id))}>
              <Send size={14} />
              <T id="event-beo.event-beo-section.request-approval">Request approval</T>
            </Button>
          )}
          {data.exists && data.status !== "approved" && data.canApprove && (
            <Button onClick={() => void run(() => beoApi.approve(event.id))}>
              <Check size={14} />
              <T id="event-beo.event-beo-section.approve">Approve</T>
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
      {!data.exists && <p className="muted"><T id="event-beo.event-beo-section.this-is-a-preview-generate">This is a preview. Generate the BEO to start working on it.</T></p>}
      {data.approvedAt && (
        <p className="muted">
          <T id="event-beo.event-beo-section.approved" values={{ when: when(data.approvedAt) }}>{"Approved {when}"}</T>
          {data.approvedBy && <T id="event-beo.event-beo-section.by" values={{ name: data.approvedBy.name }}>{" by {name}"}</T>}.
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
                <span><T id="event-beo.event-beo-section.setup-details">Setup details</T></span>
                <textarea value={notes.setup} onChange={(e) => setNotes({ ...notes, setup: e.target.value })} />
              </label>
              <label className="form-field">
                <span><T id="event-beo.event-beo-section.additional-notes">Additional notes</T></span>
                <textarea value={notes.extra} onChange={(e) => setNotes({ ...notes, extra: e.target.value })} />
              </label>
              <Button type="submit"><T id="event-beo.event-beo-section.save">Save</T></Button>
              <Button type="button" variant="ghost" onClick={() => setNotes(null)}>
                <T id="event-beo.event-beo-section.cancel">Cancel</T>
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
              <T id="event-beo.event-beo-section.edit-setup-details-and-notes">Edit setup details and notes</T>
            </Button>
          )}
        </div>
      )}
      {data.changes.length > 0 && (
        <div className="beo-log">
          <h3><T id="event-beo.event-beo-section.changes-after-approval">Changes after approval</T></h3>
          <ul className="beo-list">
            {data.changes.map((change) => (
              <li key={change.id} data-marked={change.marked || undefined}>
                <strong>{change.fieldLabel}</strong>: {change.from || <T id="event-beo.event-beo-section.empty">(empty)</T>} → {change.to || <T id="event-beo.event-beo-section.empty">(empty)</T>}
                <small>
                  {change.changedBy?.name ?? <T id="event-beo.event-beo-section.someone">Someone</T>} · {when(change.changedAt)}
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
      <T id="event-beo.event-beo-page.back-to-event">← Back to event</T>
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
