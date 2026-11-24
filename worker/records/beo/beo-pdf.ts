import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { BeoContent } from "../../../shared/beo";

// A fixed, role-safe PDF is produced on the Worker at approval time. It uses
// the same assembled BEO sections as the browser print view, in their order.
export async function renderBeoPdf(content: BeoContent): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 612;
  const height = 792;
  const margin = 44;
  let page = pdf.addPage([width, height]);
  let y = height - margin;
  const printable = (value: unknown) => String(value ?? "").normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "-");
  const line = (value: unknown, heading = false) => {
    const font = heading ? bold : regular;
    const size = heading ? 13 : 10;
    const text = printable(value);
    if (!text.trim()) return;
    const words = text.split(/\s+/);
    let current = "";
    const emit = (part: string) => {
      if (y < margin + 18) { page = pdf.addPage([width, height]); y = height - margin; }
      page.drawText(part, { x: margin, y, size, font, color: rgb(0.14, 0.19, 0.15) });
      y -= heading ? 21 : 14;
    };
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width - margin * 2 && current) {
        emit(current);
        current = word;
      } else current = next;
    }
    if (current) emit(current);
  };
  const section = (title: string) => { y -= 10; line(title, true); };
  const pair = (label: string, value: unknown) => { if (value !== null && value !== undefined && value !== "") line(`${label}: ${value}`); };
  line("BANQUET EVENT ORDER", true);
  pair("Event", content.event.title);
  pair("Date", content.header.eventDate);

  section("Event, client and venue");
  pair("Client", content.event.client);
  pair("Venue", content.event.venue);
  pair("Address", content.event.address);
  pair("Point of contact", content.event.pointOfContact?.name);
  for (const contact of content.event.venueContacts) line(`${contact.name} - ${contact.role}`);

  section("Event summary");
  pair("Event type", content.summary.eventType);
  pair("Service", content.summary.serviceType);
  pair("Food service", content.summary.foodServiceStyle);
  pair("Time", `${content.summary.startTime}${content.summary.endTime ? ` - ${content.summary.endTime}` : ""}`);
  pair("Arrival", content.summary.arrivalTime);
  pair("Guests", content.summary.guestCount);
  pair("Servings", content.summary.servings);
  pair("Dress code", content.summary.dressCode);
  pair("Salesperson", content.summary.salesperson);

  section("Food setup");
  pair("Leaves kitchen", content.foodSetup.leavesKitchenTime);
  for (const course of content.foodSetup.courses) {
    line(course.course, true);
    for (const item of course.lines) line(`${item.name} - ${item.tbd ? "TBD" : item.quantity ?? ""}${item.notes ? ` - ${item.notes}` : ""}`);
  }

  section("Staff roster");
  pair("Production lead", content.staff.productionLead);
  pair("Assistant leads", content.staff.assistantLeads.join(", "));
  for (const shift of content.staff.shifts) {
    line(`${shift.date} ${shift.kindLabel} ${shift.startTime}-${shift.endTime}`, true);
    pair("Activities", shift.activities);
    for (const slot of shift.slots) line(`${slot.label}: ${slot.assignee ?? "Open"}`);
  }

  section("Timeline");
  for (const day of content.timeline) {
    line(day.date, true);
    for (const entry of day.entries) line(`${entry.startTime}-${entry.endTime} ${entry.activity} - ${entry.who} ${entry.where}`);
  }
  if (content.runOfShow.enabled) {
    section("Run of show");
    for (const row of content.runOfShow.rows) line(`${row.time} ${row.cue} - ${row.owner} ${row.notes}`);
  }

  section("Kitchen and decor equipment");
  for (const group of content.equipment.groups) {
    line(group.label, true);
    for (const item of group.lines) line(`${item.name} - ${item.tbd ? "TBD" : item.quantity ?? ""} ${item.notes}`);
  }
  section("Venue layout");
  for (const area of content.layout.areas) line(`${area.name}: ${area.notes}`);
  pair("Load-in", content.layout.loadInNotes);
  pair("Parking", content.layout.parkingNotes);

  section("Setup details and cleanup checklist");
  pair("Transportation", content.setupCleanup.transportationNotes);
  pair("Setup", content.setupCleanup.setupDetails);
  for (const area of content.setupCleanup.areas) line(`${area.name}: ${area.notes}`);
  for (const group of content.setupCleanup.cleanup) {
    line(group.section, true);
    for (const item of group.items) line(`[${item.checkedAt ? "x" : " "}] ${item.label}`);
  }
  section("Additional notes");
  line(content.notes.additionalNotes);
  return pdf.save();
}
