import { z } from "zod";
import { email, id, localDate, text, timestamp } from "./schema-primitives";

// Core records (FLOW-53 clients, FLOW-54 venues, FLOW-55 events), shared by the API
// and the app. Contact email and phone come back as null when the caller isn't FT+
// (F-01-04); in an update, an omitted email or phone keeps the stored value.
const name = z.string().trim().min(1, "Name is required.").max(200);
const phone = text(40);

export const contactRoleSchema = z.enum([
  "primary_poc",
  "billing",
  "venue_manager",
  "event_coordinator",
]);
export type ContactRole = z.infer<typeof contactRoleSchema>;
export const contactRoleLabels: Record<ContactRole, string> = {
  primary_poc: "Primary POC",
  billing: "Billing",
  venue_manager: "Venue manager",
  event_coordinator: "Event coordinator",
};
export const contactInputSchema = z.object({
  id: id.optional(),
  name,
  role: contactRoleSchema,
  email: email.optional(),
  phone: phone.optional(),
  notes: text(2000).default(""),
});
export const contactSchema = z.object({
  id,
  name: z.string(),
  role: contactRoleSchema,
  email: z.string().nullable(),
  phone: z.string().nullable(),
  notes: z.string(),
});
export type Contact = z.infer<typeof contactSchema>;
export type ContactInput = z.input<typeof contactInputSchema>;

export const clientKindSchema = z.enum(["person", "organization"]);
export const clientInputSchema = z.object({
  name,
  kind: clientKindSchema,
  assignedSalespersonId: id.nullable().optional(),
  notes: text(5000).default(""),
  tags: z.array(text(40).min(1)).max(20).default([]),
  contacts: z.array(contactInputSchema).max(20).default([]),
});
export const clientCreateSchema = clientInputSchema.extend({
  // Set after the user has seen the duplicate warning and chosen to continue.
  allowDuplicate: z.boolean().default(false),
});
export type ClientInput = z.input<typeof clientCreateSchema>;
export const clientSchema = z.object({
  id,
  name: z.string(),
  kind: clientKindSchema,
  assignedSalespersonId: id.nullable(),
  notes: z.string(),
  tags: z.array(z.string()),
  contacts: z.array(contactSchema),
  // Admin and Sales Manager only: a possible duplicate a salesperson created.
  possibleDuplicateOf: z.object({ id, name: z.string() }).nullable(),
  archivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Client = z.infer<typeof clientSchema>;
export const duplicateErrorSchema = z.object({
  error: z.object({ code: z.literal("POSSIBLE_DUPLICATE") }),
  duplicates: z.array(z.object({ id, name: z.string() })),
});

export const jurisdictionSchema = z.enum(["DC", "MD", "VA"]);
export const venueContactRoleSchema = z.enum(["manager", "coordinator"]);
export const venueAreaInputSchema = z.object({
  id: id.optional(),
  name: text(100).min(1, "Area name is required."),
});
export const venueContactInputSchema = z.object({
  id: id.optional(),
  name,
  role: venueContactRoleSchema,
  email: email.default(""),
  phone: phone.default(""),
});
export const venueInputSchema = z.object({
  name,
  address: text(500).default(""),
  jurisdiction: jurisdictionSchema.nullable().default(null),
  loadInNotes: text(5000).default(""),
  parkingNotes: text(5000).default(""),
  areas: z.array(venueAreaInputSchema).max(50).default([]),
  // FT+ only; omitted keeps the stored contacts.
  contacts: z.array(venueContactInputSchema).max(20).optional(),
});
export type VenueInput = z.input<typeof venueInputSchema>;
export const venueAreaSchema = z.object({ id, name: z.string() });
export const venueSchema = z.object({
  id,
  name: z.string(),
  address: z.string(),
  jurisdiction: jurisdictionSchema.nullable(),
  loadInNotes: z.string(),
  parkingNotes: z.string(),
  areas: z.array(venueAreaSchema),
  // null when the caller isn't FT+.
  contacts: z
    .array(
      z.object({
        id,
        name: z.string(),
        role: venueContactRoleSchema,
        email: z.string(),
        phone: z.string(),
      }),
    )
    .nullable(),
  archivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type Venue = z.infer<typeof venueSchema>;

// The event lifecycle (FLOW-56), in order; moves are defined in
// shared/event-lifecycle.ts. "P" is the proposal.
export const eventStatuses = [
  // Lead conversion (FLOW-112) creates events in Inquiry.
  "inquiry",
  "pitching",
  "proposal_creation",
  "initial_proposal_sent",
  "negotiation",
  "closing",
  "closed",
  "preparation",
  "finished",
  "lost",
] as const;
export const eventStatusSchema = z.enum(eventStatuses);
export type EventStatus = z.infer<typeof eventStatusSchema>;
// Negotiation and Closing both show as Pending until the client signs the first
// contract (FLOW-209); the stored statuses stay separate.
export const eventStatusLabels: Record<EventStatus, string> = {
  inquiry: "Inquiry",
  pitching: "Pitching",
  proposal_creation: "P creation",
  initial_proposal_sent: "Initial P sent",
  negotiation: "Pending",
  closing: "Pending",
  // Paid and signed.
  closed: "Closed",
  preparation: "Preparation",
  finished: "Finished",
  lost: "Lost",
};
// Tells the two Pending statuses apart where a person picks an exact status or
// reads a change between them.
export const eventStatusDetailLabels: Record<EventStatus, string> = {
  ...eventStatusLabels,
  negotiation: "Pending (Negotiation)",
  closing: "Pending (Closing)",
};
const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter a time.");
const count = z.number().int().min(0).max(100_000).nullable().default(null);
export const eventInputSchema = z.object({
  title: z.string().trim().min(1, "Title is required.").max(200),
  // New York wall-clock date and times; stored as UTC instants.
  date: localDate,
  startTime: localTime,
  endTime: localTime.nullable().default(null),
  clientId: id,
  pocContactId: id.nullable().default(null),
  venueId: id.nullable().default(null),
  // Empty takes the venue's address.
  address: text(500).default(""),
  // Omitted copies the venue's areas when the venue is first picked or changed.
  areas: z.array(text(100).min(1)).max(50).optional(),
  eventType: text(100).default(""),
  serviceType: text(100).default(""),
  foodServiceStyle: text(100).default(""),
  guestCount: count,
  servingsCount: count,
  assignedSalespersonId: id.nullable().optional(),
  productionLeadId: id.nullable().default(null),
  assistantLeadIds: z.array(id).max(10).default([]),
  dressCode: text(500).default(""),
  transportationNotes: text(5000).default(""),
  internalNotes: text(5000).default(""),
  // Any status on create (FLOW-56 A4). Ignored on update: status changes go
  // through POST /api/events/<id>/status.
  status: eventStatusSchema.default("inquiry"),
});
export type EventInput = z.input<typeof eventInputSchema>;
export const eventSchema = z.object({
  id,
  title: z.string(),
  date: z.string(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  startsAt: timestamp,
  endsAt: timestamp.nullable(),
  client: z.object({ id, name: z.string() }),
  pocContactId: id.nullable(),
  venue: z.object({ id, name: z.string() }).nullable(),
  address: z.string(),
  areas: z.array(z.object({ id, name: z.string() })),
  eventType: z.string(),
  serviceType: z.string(),
  foodServiceStyle: z.string(),
  guestCount: z.number().nullable(),
  servingsCount: z.number().nullable(),
  assignedSalespersonId: id.nullable(),
  productionLeadId: id.nullable(),
  assistantLeadIds: z.array(id),
  dressCode: z.string(),
  transportationNotes: z.string(),
  internalNotes: z.string(),
  status: eventStatusSchema,
  bookedAt: timestamp.nullable(),
  archivedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type FlowEvent = z.infer<typeof eventSchema>;

// POST /api/events/<id>/status (FLOW-56): a manual status change. The reason is
// optional.
export const eventTransitionSchema = z.object({
  status: eventStatusSchema,
  reason: text(1000).default(""),
});
export type EventTransitionInput = z.input<typeof eventTransitionSchema>;
export const eventStatusChangeSchema = z.object({
  id,
  // false when the system moved the event along the forward chain.
  manual: z.boolean(),
  // null for the status the event was created with.
  from: eventStatusSchema.nullable(),
  to: eventStatusSchema,
  reason: z.string(),
  // null for an automatic change.
  actorId: id.nullable(),
  at: timestamp,
});
export type EventStatusChange = z.infer<typeof eventStatusChangeSchema>;
