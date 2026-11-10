import { useState, type ReactNode } from "react";
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
import { beoApi } from "../services/beo";
import "./event-beo.css";

// The banquet event order (FLOW-143, 144, 148): the ten sections in order, what is
// still open or TBD marked, and what changed since approval marked until the next
// approval. Contacts arrive already limited to what this role may see.

const Tbd = () => <span className="beo-tbd">TBD</span>;
const Open = () => <span className="beo-open">OPEN</span>;
const when = (iso: string) => new Date(iso).toLocaleString();

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

export function EventBeoSection({ event }: { event: FlowEvent }) {
  const beo = useResource(["event-beo", event.id], () => beoApi.get(event.id));
  const [error, setError] = useState("");
  const [notes, setNotes] = useState<{ setup: string; cleanup: string; extra: string } | null>(null);
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
    timeline: (
      <>
        {content.timeline.map((day) => (
          <div key={day.date}>
            <h4>
              {day.date}
              {day.isEventDay && " · Event day"}
            </h4>
            {day.entries.length === 0 ? (
              <p className="muted">Nothing scheduled.</p>
            ) : (
              <ul className="beo-list">
                {day.entries.map((entry, i) => (
                  <li key={i}>
                    {entry.startTime}–{entry.endTime} {entry.activity}
                    <small>{[entry.who, entry.where].filter(Boolean).join(" · ")}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </>
    ),
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
        <p>Areas: {content.layout.areas.join(", ") || "None named"}</p>
        {content.layout.loadInNotes && <p>Load-in: {content.layout.loadInNotes}</p>}
        {content.layout.parkingNotes && <p>Parking: {content.layout.parkingNotes}</p>}
      </>
    ),
    setup_cleanup: (
      <>
        {content.setupCleanup.transportationNotes && <p>Transportation: {content.setupCleanup.transportationNotes}</p>}
        <p>{content.setupCleanup.setupDetails || <span className="muted">No setup details yet.</span>}</p>
        {content.setupCleanup.cleanupChecklist.length > 0 && (
          <ul className="beo-list" aria-label="Cleanup checklist">
            {content.setupCleanup.cleanupChecklist.map((item, i) => (
              <li key={i}>☐ {item}</li>
            ))}
          </ul>
        )}
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
          <Button variant="outline" onClick={() => window.print()}>
            <Printer size={14} />
            Print
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
                    cleanupChecklist: notes.cleanup
                      .split("\n")
                      .map((line) => line.trim())
                      .filter(Boolean),
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
                <span>Cleanup checklist (one item per line)</span>
                <textarea value={notes.cleanup} onChange={(e) => setNotes({ ...notes, cleanup: e.target.value })} />
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
                  cleanup: content.setupCleanup.cleanupChecklist.join("\n"),
                  extra: content.notes.additionalNotes,
                })
              }
            >
              Edit setup, cleanup and notes
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
