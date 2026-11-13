import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import {
  ANNOTATED_GROUP,
  areaPhotoGroups,
  beoSectionLabels,
  beoSections,
  beoStatusLabels,
  type BeoArea,
  type BeoContact,
  type BeoSection,
} from "../../shared/beo";
import { useResource } from "../app/useResource";
import { LoadingSkeleton } from "../components/shared";
import { LoadError } from "../components/record-display";
import { PrintLayout } from "../components/print/PrintLayout";
import { attachmentsApi } from "../services/attachments";
import { beoApi } from "../services/beo";
import "./beo-print.css";

// The printable BEO (FLOW-149, ADR-17): generated in the browser from the viewer's
// own role-filtered projection (FLOW-148), so a part-time user's printout never
// holds client or venue contact details. The sections print in the order of
// beoSections; the footer shows the BEO status and when it was printed, so an
// outdated printout can be recognised.

const qty = (quantity: number | null, tbd: boolean) => (tbd || quantity === null ? "TBD" : quantity);

function Contact({ contact, hidden }: { contact: BeoContact; hidden: boolean }) {
  const details = [contact.phone, contact.email].filter(Boolean).join(" · ");
  return (
    <li>
      {contact.name} ({contact.role})
      {!hidden && details && ` · ${details}`}
    </li>
  );
}

// What a layout area prints: its annotated plan when it has one, else its images,
// each at full page width.
function LayoutImages({ area }: { area: BeoArea }) {
  const files = useResource(["attachments", "beo_area", area.id], () => attachmentsApi.list("beo_area", area.id));
  const photos = (files.data ?? []).filter((file) => file.kind === "photo");
  const annotated = photos.filter((file) => file.group === ANNOTATED_GROUP);
  const shown = annotated.length ? annotated : photos.filter((file) => file.group === areaPhotoGroups.layout[0].group);
  return (
    <>
      {shown.map((file) => (
        <img
          key={file.id}
          className="beo-print-image"
          src={file.urls.display ?? file.urls.thumb}
          alt={file.caption || `${area.name}: ${file.fileName}`}
        />
      ))}
    </>
  );
}

const foodNotes = (line: { dietaryTags: string[]; allergens: string[]; notes: string }) =>
  [line.dietaryTags.join(", "), line.allergens.length ? `Allergens: ${line.allergens.join(", ")}` : "", line.notes]
    .filter(Boolean)
    .join(" · ");

export function BeoPrint() {
  const { id = "" } = useParams();
  const beo = useResource(["event-beo", id], () => beoApi.get(id));
  // Taken when the page opens, which is when the printout is made.
  const [printedAt] = useState(() => new Date().toLocaleString());
  if (beo.error) return <LoadError message={beo.error} />;
  if (!beo.data) return <LoadingSkeleton />;
  const { content, status } = beo.data;
  const hidden = content.event.contactHidden;
  const sections: Record<BeoSection, ReactNode> = {
    header: (
      <p>
        <strong>{content.event.title}</strong> · {content.header.eventDate}
      </p>
    ),
    event: (
      <>
        <p>Client: {content.event.client}</p>
        <ul>
          {content.event.pointOfContact && <Contact contact={content.event.pointOfContact} hidden={hidden} />}
          {content.event.clientContacts.map((c, i) => (
            <Contact key={`c${i}`} contact={c} hidden={hidden} />
          ))}
        </ul>
        <p>
          Venue: {content.event.venue || "No venue"}
          {content.event.address && ` · ${content.event.address}`}
        </p>
        <ul>
          {content.event.venueContacts.map((c, i) => (
            <Contact key={`v${i}`} contact={c} hidden={hidden} />
          ))}
        </ul>
        {hidden && <p>Phone numbers and emails are for full-time staff.</p>}
      </>
    ),
    summary: (
      <table className="print-table">
        <tbody>
          <tr>
            <th>When</th>
            <td>
              {content.summary.date} {content.summary.startTime}
              {content.summary.endTime && `–${content.summary.endTime}`}
            </td>
          </tr>
          <tr>
            <th>Crew arrives</th>
            <td>{content.summary.arrivalTime ?? "TBD"}</td>
          </tr>
          <tr>
            <th>Guests</th>
            <td>{content.summary.guestCount ?? "TBD"}</td>
          </tr>
          <tr>
            <th>Servings</th>
            <td>{content.summary.servings ?? "TBD"}</td>
          </tr>
          <tr>
            <th>Service</th>
            <td>
              {[content.summary.eventType, content.summary.serviceType, content.summary.foodServiceStyle]
                .filter(Boolean)
                .join(" · ") || "—"}
            </td>
          </tr>
          <tr>
            <th>Dress code</th>
            <td>{content.summary.dressCode || "—"}</td>
          </tr>
        </tbody>
      </table>
    ),
    food_setup: (
      <>
        {content.foodSetup.leavesKitchenTime && <p>Food leaves the kitchen at {content.foodSetup.leavesKitchenTime}.</p>}
        {content.foodSetup.courses.length === 0 && <p>No dishes yet.</p>}
        {content.foodSetup.courses.map((course) => (
          <div key={course.course}>
            <h3>{course.course}</h3>
            <ul>
              {course.lines.map((line, i) => (
                <li key={`${line.name}${i}`}>
                  {line.name} × {qty(line.quantity, line.tbd)}
                  {foodNotes(line) && ` — ${foodNotes(line)}`}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {content.foodSetup.allergens.length > 0 && <p>Allergens: {content.foodSetup.allergens.join(", ")}</p>}
        {content.foodSetup.dietaryTags.length > 0 && <p>Dietary: {content.foodSetup.dietaryTags.join(", ")}</p>}
      </>
    ),
    staff: (
      <>
        <p>
          Production lead: {content.staff.productionLead ?? "OPEN"}
          {content.staff.assistantLeads.length > 0 && ` · Assistants: ${content.staff.assistantLeads.join(", ")}`}
        </p>
        {content.staff.shifts.map((shift, i) => (
          <div key={`${shift.kind}${i}`}>
            <h3>
              {shift.kindLabel} · {shift.date} {shift.startTime}–{shift.endTime}
            </h3>
            {shift.activities && <p>{shift.activities}</p>}
            <ul>
              {shift.slots.map((slot, j) => (
                <li key={`${slot.label}${j}`}>
                  {slot.label}: {slot.assignee ?? "OPEN"}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </>
    ),
    timeline: (
      <>
        {content.timeline.map((day) => (
          <div key={day.date}>
            <h3>
              {day.date}
              {day.isEventDay ? " (event day)" : ""}
            </h3>
            <ul>
              {day.shifts.map((shift, i) => (
                <li key={`s${i}`}>
                  {shift.kindLabel} {shift.startTime}–{shift.endTime}
                  {shift.activities && ` · ${shift.activities}`}
                  {shift.team.length > 0 && ` · ${shift.team.join(", ")}`}
                </li>
              ))}
              {day.entries.map((entry, i) => (
                <li key={`e${i}`}>
                  {entry.startTime}–{entry.endTime} {entry.activity}
                  {entry.who && ` (${entry.who})`}
                  {entry.where && ` @ ${entry.where}`}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {content.runOfShow.enabled && content.runOfShow.rows.length > 0 && (
          <>
            <h3>Run of show</h3>
            <table className="print-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Cue</th>
                  <th>Owner</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {content.runOfShow.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.time}</td>
                    <td>{row.cue}</td>
                    <td>{row.owner}</td>
                    <td>{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </>
    ),
    equipment: (
      <>
        {content.equipment.groups.length === 0 && <p>No equipment on the pull list yet.</p>}
        {content.equipment.groups.map((group) => (
          <div key={group.label}>
            <h3>{group.label}</h3>
            <ul>
              {group.lines.map((line, i) => (
                <li key={`${line.name}${i}`}>
                  {line.name} × {qty(line.quantity, line.tbd)}
                  {line.notes && ` — ${line.notes}`}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </>
    ),
    layout: (
      <>
        {content.layout.areas.map((area) => (
          <div key={area.id} className="beo-print-area">
            <h3>{area.name}</h3>
            {area.notes && <p>{area.notes}</p>}
            <LayoutImages area={area} />
          </div>
        ))}
        {content.layout.loadInNotes && <p>Load-in: {content.layout.loadInNotes}</p>}
        {content.layout.parkingNotes && <p>Parking: {content.layout.parkingNotes}</p>}
      </>
    ),
    setup_cleanup: (
      <>
        {content.setupCleanup.transportationNotes && <p>Transportation: {content.setupCleanup.transportationNotes}</p>}
        {content.setupCleanup.setupDetails && <p>{content.setupCleanup.setupDetails}</p>}
        {content.setupCleanup.areas.map((area) => (
          <p key={area.id}>
            <strong>{area.name}</strong>
            {area.notes && `: ${area.notes}`}
          </p>
        ))}
        {content.setupCleanup.cleanup.map((group) => (
          <div key={group.section}>
            <h3>{group.section}</h3>
            <ul className="beo-print-checklist">
              {group.items.map((item) => (
                <li key={item.id}>☐ {item.label}</li>
              ))}
            </ul>
          </div>
        ))}
      </>
    ),
    notes: <p>{content.notes.additionalNotes || "None."}</p>,
  };
  return (
    <PrintLayout
      title="Banquet event order"
      subtitle={content.event.title}
      footer={
        <p data-testid="beo-print-footer">
          BEO status: {status ? beoStatusLabels[status] : "Not generated (preview)"} · Printed at {printedAt}
        </p>
      }
    >
      {beoSections.map((section, index) => (
        <section className="print-section beo-print-section" key={section} data-section={section}>
          <h2>
            {index + 1}. {beoSectionLabels[section]}
          </h2>
          {sections[section]}
        </section>
      ))}
    </PrintLayout>
  );
}
