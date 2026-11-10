import { z } from "zod";
import { id, text, timestamp } from "./schema-primitives";

// The Banquet Event Order (FLOW-143/144/148, F-15): the one document the whole
// team works from on an event. It is assembled live from the event's own records
// (details, kitchen menu, staff roster, timeline, pull list), so it never holds a
// second copy of them. The BEO row only stores its approval state, the free-text
// parts nothing else owns yet, and a snapshot to compare against.
//
// A BEO never carries a price, cost or payment: no section has such a field
// (FLOW-143 AC2), and the data object is what the tests check.

export const beoStatuses = ["working_on", "pending_approval", "approved"] as const;
export const beoStatusSchema = z.enum(beoStatuses);
export type BeoStatus = z.infer<typeof beoStatusSchema>;
export const beoStatusLabels: Record<BeoStatus, string> = {
  working_on: "Working on",
  pending_approval: "Waiting for approval",
  approved: "Approved",
};

// The ten sections, in the order they print (FLOW-143 AC1).
export const beoSections = [
  "header",
  "event",
  "summary",
  "food_setup",
  "staff",
  "timeline",
  "equipment",
  "layout",
  "setup_cleanup",
  "notes",
] as const;
export const beoSectionSchema = z.enum(beoSections);
export type BeoSection = z.infer<typeof beoSectionSchema>;
export const beoSectionLabels: Record<BeoSection, string> = {
  header: "Banquet event order",
  event: "Event, client and venue",
  summary: "Event summary",
  food_setup: "Food setup",
  staff: "Staff roster",
  timeline: "Timeline",
  equipment: "Kitchen and decor equipment",
  layout: "Venue layout",
  setup_cleanup: "Setup details and cleanup checklist",
  notes: "Additional notes",
};

// PATCH /api/events/<id>/beo: the parts of a BEO that no other record owns yet
// (the schedule, setup and layout tickets fill these in more fully).
export const beoNotesInputSchema = z
  .object({
    setupDetails: text(5000),
    cleanupChecklist: z.array(text(300).min(1)).max(50),
    additionalNotes: text(5000),
  })
  .partial()
  .strict();
export type BeoNotesInput = z.input<typeof beoNotesInputSchema>;

// A contact on the BEO. The phone and email are filled for full-time staff and
// up and left empty for everyone else (FLOW-148); `contactHidden` says so, so the
// screen can show names and roles only.
const contactSchema = z.object({
  name: z.string(),
  role: z.string(),
  phone: z.string(),
  email: z.string(),
});
export type BeoContact = z.infer<typeof contactSchema>;

const slotSchema = z.object({
  label: z.string(),
  department: z.string(),
  assignee: z.string().nullable(),
  // No one is assigned yet; the BEO marks it (FLOW-143 AC3).
  open: z.boolean(),
});
const shiftSchema = z.object({
  kind: z.string(),
  kindLabel: z.string(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  activities: z.string(),
  slots: z.array(slotSchema),
});
const foodLineSchema = z.object({
  name: z.string(),
  quantity: z.number().nullable(),
  // The quantity is not planned yet; the BEO shows "TBD" (FLOW-143 AC3).
  tbd: z.boolean(),
  allergens: z.array(z.string()),
  dietaryTags: z.array(z.string()),
  notes: z.string(),
});
const equipmentLineSchema = z.object({
  name: z.string(),
  quantity: z.number().nullable(),
  tbd: z.boolean(),
  notes: z.string(),
});

export const beoContentSchema = z.object({
  header: z.object({
    title: z.string(),
    eventId: id,
    eventDate: z.string(),
  }),
  event: z.object({
    title: z.string(),
    client: z.string(),
    pointOfContact: contactSchema.nullable(),
    venue: z.string(),
    address: z.string(),
    venueContacts: z.array(contactSchema),
    clientContacts: z.array(contactSchema),
    contactHidden: z.boolean(),
  }),
  summary: z.object({
    date: z.string(),
    startTime: z.string(),
    endTime: z.string().nullable(),
    arrivalTime: z.string().nullable(),
    eventType: z.string(),
    serviceType: z.string(),
    foodServiceStyle: z.string(),
    guestCount: z.number().nullable(),
    servings: z.number().nullable(),
    dressCode: z.string(),
    salesperson: z.string().nullable(),
  }),
  foodSetup: z.object({
    leavesKitchenTime: z.string().nullable(),
    courses: z.array(z.object({ course: z.string(), lines: z.array(foodLineSchema) })),
    allergens: z.array(z.string()),
    dietaryTags: z.array(z.string()),
    tbdCount: z.number().int(),
  }),
  staff: z.object({
    productionLead: z.string().nullable(),
    assistantLeads: z.array(z.string()),
    shifts: z.array(shiftSchema),
    openSlots: z.number().int(),
  }),
  timeline: z.array(
    z.object({
      date: z.string(),
      isEventDay: z.boolean(),
      entries: z.array(
        z.object({
          startTime: z.string(),
          endTime: z.string(),
          activity: z.string(),
          who: z.string(),
          where: z.string(),
        }),
      ),
    }),
  ),
  equipment: z.object({
    groups: z.array(
      z.object({ label: z.string(), lines: z.array(equipmentLineSchema) }),
    ),
    tbdCount: z.number().int(),
  }),
  layout: z.object({
    areas: z.array(z.string()),
    loadInNotes: z.string(),
    parkingNotes: z.string(),
  }),
  setupCleanup: z.object({
    transportationNotes: z.string(),
    setupDetails: z.string(),
    cleanupChecklist: z.array(z.string()),
  }),
  notes: z.object({ additionalNotes: z.string() }),
});
export type BeoContent = z.infer<typeof beoContentSchema>;

// --- Fields ---------------------------------------------------------------------

// What change tracking compares and the change log records: one named field per
// thing someone may edit. Values are plain text, so the log reads the same
// wherever it is shown, and contact phones and emails are left out of it.
export type BeoField = { key: string; label: string; section: BeoSection; value: string };

// The fields that, when changed after approval, send the BEO back to "working on"
// unless business settings name others (FLOW-144 AC2).
export const defaultBeoKeyFields = ["date_time", "location", "guest_count", "menu"] as const;

const qty = (quantity: number | null) => (quantity === null ? "TBD" : String(quantity));
const list = (values: string[]) => values.join("; ");

export function beoFields(content: BeoContent): BeoField[] {
  const { event, summary, foodSetup, staff, equipment, layout, setupCleanup, notes } = content;
  const field = (key: string, label: string, section: BeoSection, value: string): BeoField => ({
    key,
    label,
    section,
    value,
  });
  return [
    field("event_title", "Event title", "event", event.title),
    field("client", "Client", "event", event.client),
    field(
      "point_of_contact",
      "Point of contact",
      "event",
      event.pointOfContact ? `${event.pointOfContact.name} (${event.pointOfContact.role})` : "",
    ),
    field("client_contacts", "Client contacts", "event", list(event.clientContacts.map((c) => `${c.name} (${c.role})`))),
    field("venue_contacts", "Venue contacts", "event", list(event.venueContacts.map((c) => `${c.name} (${c.role})`))),
    field("date_time", "Date and time", "summary", `${summary.date} ${summary.startTime}–${summary.endTime ?? "?"}`),
    field("arrival_time", "Venue arrival time", "summary", summary.arrivalTime ?? ""),
    field("location", "Location", "event", [event.venue, event.address].filter(Boolean).join(", ")),
    field("guest_count", "Guest count", "summary", summary.guestCount === null ? "" : String(summary.guestCount)),
    field("servings", "Servings", "summary", summary.servings === null ? "" : String(summary.servings)),
    field("event_type", "Event type", "summary", summary.eventType),
    field("service_type", "Service type", "summary", summary.serviceType),
    field("food_service_style", "Food service style", "summary", summary.foodServiceStyle),
    field("dress_code", "Dress code", "summary", summary.dressCode),
    field(
      "menu",
      "Menu",
      "food_setup",
      list(foodSetup.courses.flatMap((c) => c.lines.map((l) => `${c.course}: ${l.name} × ${qty(l.quantity)}`))),
    ),
    field("leaves_kitchen", "Food leaves the kitchen", "food_setup", foodSetup.leavesKitchenTime ?? ""),
    field(
      "staff_leads",
      "Production leads",
      "staff",
      list([staff.productionLead ?? "", ...staff.assistantLeads].filter(Boolean)),
    ),
    field(
      "staff_roster",
      "Staff roster",
      "staff",
      list(
        staff.shifts.flatMap((s) =>
          s.slots.map((l) => `${s.kindLabel} ${s.date} ${s.startTime}–${s.endTime} ${l.label}: ${l.assignee ?? "OPEN"}`),
        ),
      ),
    ),
    field(
      "timeline",
      "Timeline",
      "timeline",
      list(
        content.timeline.flatMap((d) =>
          d.entries.map((e) => `${d.date} ${e.startTime}–${e.endTime} ${e.activity}${e.who ? ` (${e.who})` : ""}${e.where ? ` @ ${e.where}` : ""}`),
        ),
      ),
    ),
    field(
      "equipment",
      "Equipment",
      "equipment",
      list(equipment.groups.flatMap((g) => g.lines.map((l) => `${g.label}: ${l.name} × ${qty(l.quantity)}`))),
    ),
    field("areas", "Layout areas", "layout", list(layout.areas)),
    field("load_in_notes", "Load-in notes", "layout", layout.loadInNotes),
    field("parking_notes", "Parking notes", "layout", layout.parkingNotes),
    field("transportation_notes", "Transportation notes", "setup_cleanup", setupCleanup.transportationNotes),
    field("setup_details", "Setup details", "setup_cleanup", setupCleanup.setupDetails),
    field("cleanup_checklist", "Cleanup checklist", "setup_cleanup", list(setupCleanup.cleanupChecklist)),
    field("additional_notes", "Additional notes", "notes", notes.additionalNotes),
  ];
}

export type BeoFieldChange = { key: string; label: string; section: BeoSection; from: string; to: string };

// The fields whose value differs between two snapshots ({ key: value }).
export function diffBeoFields(
  before: Record<string, string>,
  after: BeoField[],
): BeoFieldChange[] {
  return after
    .filter((field) => (before[field.key] ?? "") !== field.value)
    .map((field) => ({
      key: field.key,
      label: field.label,
      section: field.section,
      from: before[field.key] ?? "",
      to: field.value,
    }));
}

export const snapshotOfFields = (fields: BeoField[]): Record<string, string> =>
  Object.fromEntries(fields.map((field) => [field.key, field.value]));

// A key-field change sends an approved BEO back to "working on" (FLOW-144 AC2).
export const touchesKeyField = (changes: { key: string }[], keyFields: readonly string[]) =>
  changes.some((change) => keyFields.includes(change.key));

// --- API shapes -----------------------------------------------------------------

export const beoChangeSchema = z.object({
  id,
  fieldKey: z.string(),
  fieldLabel: z.string(),
  section: beoSectionSchema,
  from: z.string(),
  to: z.string(),
  changedBy: z.object({ id, name: z.string() }).nullable(),
  changedAt: timestamp,
  // Changed since the last approval, so the field is marked until the next one.
  marked: z.boolean(),
});
export type BeoChange = z.infer<typeof beoChangeSchema>;

export const beoViewSchema = z.object({
  eventId: id,
  // False until the BEO is generated; the content is then a live preview.
  exists: z.boolean(),
  id: id.nullable(),
  status: beoStatusSchema.nullable(),
  approvedAt: timestamp.nullable(),
  approvedBy: z.object({ id, name: z.string() }).nullable(),
  content: beoContentSchema,
  // Fields marked "changed since approval" (FLOW-144).
  changedFields: z.array(z.object({ key: z.string(), label: z.string(), section: beoSectionSchema })),
  changes: z.array(beoChangeSchema),
  keyFields: z.array(z.string()),
  canEdit: z.boolean(),
  canApprove: z.boolean(),
  canRequestApproval: z.boolean(),
});
export type BeoView = z.infer<typeof beoViewSchema>;
