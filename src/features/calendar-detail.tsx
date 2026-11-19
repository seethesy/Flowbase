import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BeoView } from "../../shared/beo";
import { LoadError } from "../components/record-display";
import { beoApi } from "../services/beo";
import { T } from "../app/live-copy";

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
        <strong>{content?.event.title ?? <T id="calendar-detail.calendar-detail.event-details">Event details</T>}</strong>
        <Link to={`/events/${eventId}`}><T id="calendar-detail.calendar-detail.open-event">Open event</T></Link>
        <button type="button" className="button ghost" onClick={onClose}>
          <T id="calendar-detail.calendar-detail.close">Close</T>
        </button>
      </div>
      {error && <LoadError message={error} />}
      {!content && !error && <p className="muted"><T id="calendar-detail.calendar-detail.loading">Loading…</T></p>}
      {content && (
        <div className="calendar-detail-body">
          <p>
            {content.summary.date} · {content.summary.startTime}
            {content.summary.endTime ? `–${content.summary.endTime}` : ""}
            {content.summary.guestCount != null && <T id="calendar-detail.calendar-detail.guests" values={{ guestCount: content.summary.guestCount }}>{" · {guestCount} guests"}</T>}
          </p>
          <p>
            {[content.event.venue, content.event.address].filter(Boolean).join(" · ") || <T id="calendar-detail.calendar-detail.no-venue-yet">No venue yet.</T>}
          </p>
          {!content.event.contactHidden &&
            content.event.pointOfContact && (
              <p>
                <T id="calendar-detail.calendar-detail.contact" values={{ name: content.event.pointOfContact.name, value: content.event.pointOfContact.phone && ` · ${content.event.pointOfContact.phone}` }}>{"Contact: {name}{value}"}</T>
              </p>
            )}
          {content.foodSetup.courses.length > 0 && (
            <>
              <h4><T id="calendar-detail.calendar-detail.menu">Menu</T></h4>
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
          {content.foodSetup.allergens.length > 0 && <p><T id="calendar-detail.calendar-detail.allergens" values={{ join: content.foodSetup.allergens.join(", ") }}>{"Allergens: {join}"}</T></p>}
          {content.staff.shifts.length > 0 && (
            <>
              <h4><T id="calendar-detail.calendar-detail.staff">Staff</T></h4>
              <p>
                {content.staff.productionLead && <T id="calendar-detail.calendar-detail.lead" values={{ productionLead: content.staff.productionLead }}>{"Lead: {productionLead}. "}</T>}
                {content.staff.openSlots > 0 && <T id="calendar-detail.calendar-detail.open" values={{ openSlots: content.staff.openSlots }}>{"{openSlots} open."}</T>}
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
          {content.setupCleanup.setupDetails && <p><T id="calendar-detail.calendar-detail.setup" values={{ setupDetails: content.setupCleanup.setupDetails }}>{"Setup: {setupDetails}"}</T></p>}
          {content.notes.additionalNotes && <p><T id="calendar-detail.calendar-detail.notes" values={{ additionalNotes: content.notes.additionalNotes }}>{"Notes: {additionalNotes}"}</T></p>}
        </div>
      )}
    </aside>
  );
}
