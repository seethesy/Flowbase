import { z } from "zod";
import { localTime } from "./core-records";
import { id, text, timestamp } from "./schema-primitives";
import { cleanupSectionSchema } from "./settings";

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

// PATCH /api/events/<id>/beo: the free text of a BEO that no other record owns.
// The cleanup checklist, setup areas, layouts and run of show have their own
// routes below (FLOW-145, 146, 147).
export const beoNotesInputSchema = z
  .object({
    setupDetails: text(5000),
    additionalNotes: text(5000),
  })
  .partial()
  .strict();
export type BeoNotesInput = z.input<typeof beoNotesInputSchema>;

// --- Run of show (FLOW-145) -----------------------------------------------------

// auto: on once the guest count reaches the settings threshold; on/off: by hand.
export const runOfShowModes = ["auto", "on", "off"] as const;
export const runOfShowModeSchema = z.enum(runOfShowModes);
export type RunOfShowMode = z.infer<typeof runOfShowModeSchema>;
export const runOfShowModeLabels: Record<RunOfShowMode, string> = {
  auto: "Automatic (by guest count)",
  on: "Always on",
  off: "Always off",
};

// A minute-by-minute line: when, what happens, who owns it, and notes.
export const runOfShowRowInputSchema = z.object({
  time: localTime,
  cue: text(300).min(1, "Describe the cue."),
  owner: text(200).default(""),
  notes: text(1000).default(""),
});
// PUT /api/events/<id>/beo/run-of-show replaces the mode and every row.
export const runOfShowInputSchema = z
  .object({ mode: runOfShowModeSchema, rows: z.array(runOfShowRowInputSchema).max(200) })
  .strict();
export type RunOfShowInput = z.input<typeof runOfShowInputSchema>;

// --- Setup and layout areas (FLOW-146, 147) -------------------------------------

// A setup area holds notes and reference/actual photos; a layout area holds notes,
// images and an optional annotation. Photos are attachments on the area
// (record type beo_area) in these groups.
export const beoAreaKinds = ["setup", "layout"] as const;
export const beoAreaKindSchema = z.enum(beoAreaKinds);
export type BeoAreaKind = z.infer<typeof beoAreaKindSchema>;
export const areaPhotoGroups = {
  setup: [
    { group: "reference", label: "Reference photos (how it should look)" },
    { group: "actual", label: "Actual photos (taken on the day)" },
  ],
  layout: [{ group: "image", label: "Floor plan, aerial photo or sketch" }],
} as const;
// The PNG an annotation renders (FLOW-147); it is what the BEO and print show.
export const ANNOTATED_GROUP = "annotated";

export const beoAreaInputSchema = z
  .object({
    kind: beoAreaKindSchema,
    name: text(100).min(1, "Name the area."),
    notes: text(2000).default(""),
  })
  .strict();
export type BeoAreaInput = z.input<typeof beoAreaInputSchema>;
export const beoAreaUpdateSchema = z
  .object({ name: text(100).min(1, "Name the area."), notes: text(2000) })
  .partial()
  .strict();
export type BeoAreaUpdate = z.input<typeof beoAreaUpdateSchema>;

// The Excalidraw scene of an annotated layout image, or null to clear it. The
// browser sends the rendered PNG as an attachment separately.
export const MAX_SCENE_BYTES = 400_000;
export const beoSceneInputSchema = z
  .object({
    scene: z
      .record(z.string(), z.unknown())
      .nullable()
      .refine((scene) => !scene || JSON.stringify(scene).length <= MAX_SCENE_BYTES, "This annotation is too large."),
  })
  .strict();
export type BeoSceneInput = z.input<typeof beoSceneInputSchema>;
// GET /api/events/<id>/beo/areas/<areaId>/scene answers the same shape.
export const beoSceneSchema = beoSceneInputSchema;

// POST /api/events/<id>/beo/layout/copy: add the layout areas of the venue (its
// named areas) or of a past event at the same venue.
export const layoutCopyInputSchema = z
  .object({ from: z.enum(["venue", "event"]), eventId: id.optional() })
  .strict()
  .refine((value) => value.from === "venue" || value.eventId, "Choose the event to copy from.");
export type LayoutCopyInput = z.input<typeof layoutCopyInputSchema>;

const areaSchema = z.object({ id, name: z.string(), notes: z.string(), hasScene: z.boolean() });
export type BeoArea = z.infer<typeof areaSchema>;

// --- Cleanup checklist (FLOW-146) -----------------------------------------------

// PUT /api/events/<id>/beo/cleanup replaces the sections and items. Items that
// keep their section and label keep their check-off.
export const cleanupInputSchema = z.object({ sections: z.array(cleanupSectionSchema).max(20) }).strict();
export type CleanupInput = z.input<typeof cleanupInputSchema>;
// PATCH /api/events/<id>/beo/cleanup/<itemId>: check an item off or undo it.
export const checkItemInputSchema = z.object({ checked: z.boolean() }).strict();

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
      // The staff shifts of that day (the day-before setup team, hours and activities).
      shifts: z.array(
        z.object({
          kindLabel: z.string(),
          startTime: z.string(),
          endTime: z.string(),
          activities: z.string(),
          team: z.array(z.string()),
        }),
      ),
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
  runOfShow: z.object({
    mode: runOfShowModeSchema,
    // Shown on the BEO: turned on by hand, or automatic and over the threshold.
    enabled: z.boolean(),
    threshold: z.number().int(),
    rows: z.array(z.object({ time: z.string(), cue: z.string(), owner: z.string(), notes: z.string() })),
  }),
  layout: z.object({
    areas: z.array(areaSchema),
    loadInNotes: z.string(),
    parkingNotes: z.string(),
  }),
  setupCleanup: z.object({
    transportationNotes: z.string(),
    setupDetails: z.string(),
    areas: z.array(areaSchema),
    cleanup: z.array(
      z.object({
        section: z.string(),
        items: z.array(
          z.object({
            id,
            label: z.string(),
            checkedAt: timestamp.nullable(),
            checkedBy: z.string().nullable(),
          }),
        ),
      }),
    ),
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
  const { event, summary, foodSetup, staff, equipment, layout, setupCleanup, notes, runOfShow } = content;
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
    field(
      "run_of_show",
      "Run of show",
      "timeline",
      runOfShow.enabled ? list(runOfShow.rows.map((r) => `${r.time} ${r.cue}${r.owner ? ` (${r.owner})` : ""}${r.notes ? ` – ${r.notes}` : ""}`)) : "",
    ),
    field("areas", "Layout areas", "layout", list(layout.areas.map((a) => (a.notes ? `${a.name}: ${a.notes}` : a.name)))),
    field("load_in_notes", "Load-in notes", "layout", layout.loadInNotes),
    field("parking_notes", "Parking notes", "layout", layout.parkingNotes),
    field("transportation_notes", "Transportation notes", "setup_cleanup", setupCleanup.transportationNotes),
    field("setup_details", "Setup details", "setup_cleanup", setupCleanup.setupDetails),
    field(
      "setup_areas",
      "Setup areas",
      "setup_cleanup",
      list(setupCleanup.areas.map((a) => (a.notes ? `${a.name}: ${a.notes}` : a.name))),
    ),
    // Checking an item off during breakdown is not a change to the BEO, so only
    // the sections and labels are compared.
    field(
      "cleanup_checklist",
      "Cleanup checklist",
      "setup_cleanup",
      list(setupCleanup.cleanup.map((s) => `${s.section}: ${s.items.map((i) => i.label).join(", ")}`)),
    ),
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
  // Anyone who can open the event checks cleanup items off during breakdown.
  canCheckOff: z.boolean(),
});
export type BeoView = z.infer<typeof beoViewSchema>;
