import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BeoView } from "../../shared/beo";
import { LoadError } from "../components/record-display";
import { beoApi } from "../services/beo";

// Detail mode (FLOW-65): the clicked event's BEO content, read only. The Worker
// sends it already projected for the viewer's role (projectBeo), so a part-time
// staff member gets no pricing and no contact details here either.

export function CalendarDetail({ eventId, onClose }: { eventId: string; onClose: () => void }) {
  const [view, setView] = useState<BeoView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    setView(null);
    setError("");
    beoApi.get(eventId).then(
      (result) => live && setView(result),
      (e: unknown) => live && setError((e as Error).message),
    );
    return () => {
      live = false;
    };
  }, [eventId]);
  const content = view?.content;
  return (
    <aside className="calendar-detail" aria-label="Event details">
      <div className="page-actions">
        <strong>{content?.event.title ?? "Event details"}</strong>
        <Link to={`/events/${eventId}`}>Open event</Link>
        <button type="button" className="button ghost" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <LoadError message={error} />}
      {!content && !error && <p className="muted">Loading…</p>}
      {content && (
        <div className="calendar-detail-body">
          <p>
            {content.summary.date} · {content.summary.startTime}
            {content.summary.endTime ? `–${content.summary.endTime}` : ""}
            {content.summary.guestCount != null && ` · ${content.summary.guestCount} guests`}
          </p>
          <p>
            {[content.event.venue, content.event.address].filter(Boolean).join(" · ") || "No venue yet."}
          </p>
          {!content.event.contactHidden &&
            content.event.pointOfContact && (
              <p>
                Contact: {content.event.pointOfContact.name}
                {content.event.pointOfContact.phone && ` · ${content.event.pointOfContact.phone}`}
              </p>
            )}
          {content.foodSetup.courses.length > 0 && (
            <>
              <h4>Menu</h4>
              <ul className="beo-list">
                {content.foodSetup.courses.map((course) => (
                  <li key={course.course}>
                    <strong>{course.course}</strong>
                    <small>{course.lines.map((line) => line.name).join(", ")}</small>
                  </li>
                ))}
              </ul>
            </>
          )}
          {content.foodSetup.allergens.length > 0 && <p>Allergens: {content.foodSetup.allergens.join(", ")}</p>}
          {content.staff.shifts.length > 0 && (
            <>
              <h4>Staff</h4>
              <p>
                {content.staff.productionLead && `Lead: ${content.staff.productionLead}. `}
                {content.staff.openSlots > 0 && `${content.staff.openSlots} open.`}
              </p>
            </>
          )}
          {content.timeline.map((day) => (
            <div key={day.date}>
              <h4>{day.date}</h4>
              <ul className="beo-list">
                {day.shifts.map((shift, i) => (
                  <li key={`s${i}`}>
                    {shift.startTime}–{shift.endTime} {shift.kindLabel}
                    <small>{[shift.activities, shift.team.join(", ")].filter(Boolean).join(" · ")}</small>
                  </li>
                ))}
                {day.entries.map((entry, i) => (
                  <li key={`e${i}`}>
                    {entry.startTime}–{entry.endTime} {entry.activity}
                    <small>{[entry.who, entry.where].filter(Boolean).join(" · ")}</small>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {content.setupCleanup.setupDetails && <p>Setup: {content.setupCleanup.setupDetails}</p>}
          {content.notes.additionalNotes && <p>Notes: {content.notes.additionalNotes}</p>}
        </div>
      )}
    </aside>
  );
}
