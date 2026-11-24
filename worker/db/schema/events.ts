// Events, staffing, timeline, planning, trucks, pull lists, closeout, Day-of and Google Calendar copies.
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { eventStatuses } from "../../../shared/core-records";
import { departments, shiftKinds } from "../../../shared/event-staff";
import { timelineKinds, timelineWhoKinds } from "../../../shared/event-timeline";
import { planningStepStatuses, planningSteps } from "../../../shared/planning";
import { pullGroups, pullStatuses } from "../../../shared/pull-list";
import { type RentalRequestSettings } from "../../../shared/rental-requests";
import { truckStatuses } from "../../../shared/trucks";
import { dayOfCheckpointKeys, dayOfStaffStatuses, dayOfUpdateKinds } from "../../../shared/day-of";
import { baseColumns, oneOf, timestamptz } from "../conventions";
import { users } from "./access";
import { quantity, trigram } from "./common";
import { inventoryLocations, masterInventoryItems, vendors } from "./inventory";
import { leads } from "./leads";
import { clientContacts, clients, proposals, venues } from "./sales";
import { tasks } from "./tasks";

export const events = pgTable(
  "events",
  {
    ...baseColumns(),
    title: text("title").notNull(),
    eventType: text("event_type").notNull().default(""),
    serviceType: text("service_type").notNull().default(""),
    foodServiceStyle: text("food_service_style").notNull().default(""),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at"),
    venueId: uuid("venue_id").references(() => venues.id),
    address: text("address").notNull().default(""),
    guestCount: integer("guest_count"),
    servingsCount: integer("servings_count"),
    clientId: uuid("client_id").references(() => clients.id),
    leadId: uuid("lead_id").references((): AnyPgColumn => leads.id),
    pocContactId: uuid("poc_contact_id").references(() => clientContacts.id),
    assignedSalespersonId: uuid("assigned_salesperson_id"),
    productionLeadId: uuid("production_lead_id"),
    assistantLeadIds: jsonb("assistant_lead_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    dressCode: text("dress_code").notNull().default(""),
    // Venue arrival time on the event date (FLOW-140).
    arrivesAt: timestamptz("arrives_at"),
    transportationNotes: text("transportation_notes").notNull().default(""),
    internalNotes: text("internal_notes").notNull().default(""),
    status: text("status", { enum: eventStatuses })
      .notNull()
      .default("inquiry"),
    // When the client signed the event's first DocuSign contract (FLOW-4). Set only
    // by recording that contract, never by a status change.
    bookedAt: timestamptz("booked_at"),
    planningStaleAt: timestamptz("planning_stale_at"),
    rentalRequests: jsonb("rental_requests").$type<RentalRequestSettings[]>().notNull().default([]),
  },
  (table) => [
    index("events_starts_at_idx").on(table.startsAt),
    index("events_client_idx").on(table.clientId),
    index("events_lead_idx").on(table.leadId),
    index("events_venue_idx").on(table.venueId),
    index("events_salesperson_idx").on(table.assignedSalespersonId),
    trigram("events_title_trgm_idx", table.title),
    oneOf("events_status_check", table.status, eventStatuses),
  ],
).enableRLS();
// Areas used for this event's layouts: copied from the venue, or added per event.
export const eventAreas = pgTable(
  "event_areas",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("event_areas_event_idx").on(table.eventId)],
).enableRLS();
// The event's staff roster (FLOW-140): shifts on the pull/load day, the setup day
// and the event day, each with its own times and activities.
export const eventShifts = pgTable(
  "event_shifts",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    kind: text("kind", { enum: shiftKinds }).notNull(),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at").notNull(),
    activities: text("activities").notNull().default(""),
  },
  (table) => [
    index("event_shifts_event_idx").on(table.eventId),
    oneOf("event_shifts_kind_check", table.kind, shiftKinds),
    check("event_shifts_ends_after_start", sql`${table.endsAt} > ${table.startsAt}`),
  ],
).enableRLS();
// A staffing slot on a shift: a position, open until someone is assigned to it.
export const eventStaffSlots = pgTable(
  "event_staff_slots",
  {
    ...baseColumns(),
    shiftId: uuid("shift_id")
      .notNull()
      .references(() => eventShifts.id),
    position: text("position").notNull(),
    department: text("department", { enum: departments }).notNull(),
    assigneeId: uuid("assignee_id").references(() => users.id),
    sortOrder: integer("sort_order").notNull().default(0),
    proposalId: uuid("proposal_id").references(() => proposals.id),
    proposalSlotKey: text("proposal_slot_key"),
  },
  (table) => [
    index("event_staff_slots_shift_idx").on(table.shiftId),
    index("event_staff_slots_assignee_idx").on(table.assigneeId),
    uniqueIndex("event_staff_slots_proposal_key_idx")
      .on(table.proposalId, table.proposalSlotKey)
      .where(sql`${table.proposalSlotKey} is not null and ${table.archivedAt} is null`),
    oneOf("event_staff_slots_department_check", table.department, departments),
  ],
).enableRLS();
// The event timeline and production schedule (FLOW-126): time ranges on any day the
// event involves, each with an activity, who does it (a staff member, a role, or an
// outside vendor) and where (an event area, by name). proposal_id and source_key
// record the mapped proposal line an entry came from, so the line is suggested once.
export const eventTimelineEntries = pgTable(
  "event_timeline_entries",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    kind: text("kind", { enum: timelineKinds }).notNull(),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at").notNull(),
    activity: text("activity").notNull(),
    whoType: text("who_type", { enum: timelineWhoKinds }),
    whoUserId: uuid("who_user_id").references(() => users.id),
    whoRole: text("who_role"),
    whoVendorId: uuid("who_vendor_id").references(() => vendors.id),
    areaName: text("area_name").notNull().default(""),
    proposalId: uuid("proposal_id").references(() => proposals.id),
    sourceKey: text("source_key"),
  },
  (table) => [
    index("event_timeline_entries_event_idx").on(table.eventId, table.startsAt),
    uniqueIndex("event_timeline_entries_source_idx")
      .on(table.proposalId, table.sourceKey)
      .where(sql`${table.sourceKey} is not null and ${table.archivedAt} is null`),
    oneOf("event_timeline_entries_kind_check", table.kind, timelineKinds),
    oneOf("event_timeline_entries_who_type_check", table.whoType, timelineWhoKinds),
    check("event_timeline_entries_ends_after_start", sql`${table.endsAt} > ${table.startsAt}`),
    // Exactly the one column its who_type names is set.
    check(
      "event_timeline_entries_who_check",
      sql`(${table.whoType} is null and ${table.whoUserId} is null and ${table.whoRole} is null and ${table.whoVendorId} is null)
        or (${table.whoType} = 'staff' and ${table.whoUserId} is not null and ${table.whoRole} is null and ${table.whoVendorId} is null)
        or (${table.whoType} = 'role' and ${table.whoRole} is not null and ${table.whoUserId} is null and ${table.whoVendorId} is null)
        or (${table.whoType} = 'vendor' and ${table.whoVendorId} is not null and ${table.whoUserId} is null and ${table.whoRole} is null)`,
    ),
  ],
).enableRLS();
// Status history (FLOW-56): one row per status change of an event: who
// (created_by; null for the system), when (created_at), from and to, and why.
export const eventStatusHistory = pgTable(
  "event_status_history",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    // null for the status the event was created with.
    fromStatus: text("from_status", { enum: eventStatuses }),
    toStatus: text("to_status", { enum: eventStatuses }).notNull(),
    reason: text("reason").notNull().default(""),
    // false when the system moved the event along the forward chain.
    manual: boolean("manual").notNull().default(true),
  },
  (table) => [
    index("event_status_history_event_idx").on(table.eventId),
    oneOf("event_status_history_from_status_check", table.fromStatus, eventStatuses),
    oneOf("event_status_history_to_status_check", table.toStatus, eventStatuses),
  ],
).enableRLS();
// Start planning (FLOW-133). One row per event once planning has started, and one
// row per step with where it stands. Each step runs as its own job (FLOW-27).
export const eventPlanning = pgTable("event_planning", {
  ...baseColumns(),
  eventId: uuid("event_id")
    .notNull()
    .unique()
    .references(() => events.id),
  startedAt: timestamptz("started_at").notNull().defaultNow(),
  startedBy: uuid("started_by"),
}).enableRLS();
export const eventPlanningSteps = pgTable(
  "event_planning_steps",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    step: text("step", { enum: planningSteps }).notNull(),
    status: text("status", { enum: planningStepStatuses })
      .notNull()
      .default("pending"),
    detail: text("detail").notNull().default(""),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    uniqueIndex("event_planning_steps_event_step_idx").on(table.eventId, table.step),
    oneOf("event_planning_steps_step_check", table.step, planningSteps),
    oneOf("event_planning_steps_status_check", table.status, planningStepStatuses),
  ],
).enableRLS();
export const planningOutputKinds = ["pull_list", "requirements", "order_list", "kitchen_menu", "beo", "truck_log"] as const;
export const eventPlanningOutputs = pgTable("event_planning_outputs", {
  ...baseColumns(),
  eventId: uuid("event_id").notNull().references(() => events.id),
  kind: text("kind", { enum: planningOutputKinds }).notNull(),
  cause: text("cause").notNull(),
  before: jsonb("before").$type<Record<string, string>>().notNull().default({}),
  staleAt: timestamptz("stale_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("event_planning_outputs_event_kind_idx").on(table.eventId, table.kind),
  oneOf("event_planning_outputs_kind_check", table.kind, planningOutputKinds),
]).enableRLS();
export const trucks = pgTable("trucks", {
  ...baseColumns(),
  name: text("name").notNull().unique(),
  status: text("status", { enum: truckStatuses }).notNull().default("available"),
  // Where the truck is now, typed by hand on the day-of board (FLOW-155; no GPS).
  location: text("location").notNull().default(""),
}, (table) => [oneOf("trucks_status_check", table.status, truckStatuses)]).enableRLS();
export const truckAssignments = pgTable("truck_assignments", {
  ...baseColumns(),
  truckId: uuid("truck_id").notNull().references(() => trucks.id),
  eventId: uuid("event_id").notNull().references(() => events.id),
  departsAt: timestamptz("departs_at").notNull(),
  returnsAt: timestamptz("returns_at").notNull(),
  driverId: uuid("driver_id").references(() => users.id),
  loaderIds: jsonb("loader_ids").$type<string[]>().notNull().default([]),
  loadTaskId: uuid("load_task_id").references(() => tasks.id),
  conflictAcknowledgedAt: timestamptz("conflict_acknowledged_at"),
  conflictMessage: text("conflict_message"),
}, (table) => [
  index("truck_assignments_truck_window_idx").on(table.truckId, table.departsAt, table.returnsAt),
  index("truck_assignments_event_idx").on(table.eventId),
  check("truck_assignments_window_check", sql`${table.returnsAt} > ${table.departsAt}`),
]).enableRLS();
// Readiness answers and dismissals remain attached to an event until the source
// situation changes. A changed signature reopens the question.
export const readinessResponses = pgTable("readiness_responses", {
  ...baseColumns(),
  eventId: uuid("event_id").notNull(),
  checkKey: text("check_key").notNull(),
  signature: text("signature").notNull(),
  state: text("state", { enum: ["answered", "dismissed"] }).notNull(),
  response: text("response").notNull().default(""),
  respondedBy: uuid("responded_by").notNull(),
  respondedAt: timestamptz("responded_at").notNull(),
}, (table) => [
  uniqueIndex("readiness_responses_event_key_idx").on(table.eventId, table.checkKey),
  oneOf("readiness_responses_state_check", table.state, ["answered", "dismissed"]),
]).enableRLS();
// Day-of board (FLOW-155): where a staff member is and how their day is going, set
// by hand. One row per staffing slot, created by the first update; a slot with no
// row reads as scheduled with no location.
export const dayOfStaffStates = pgTable(
  "day_of_staff_states",
  {
    ...baseColumns(),
    slotId: uuid("slot_id")
      .notNull()
      .unique()
      .references(() => eventStaffSlots.id),
    status: text("status", { enum: dayOfStaffStatuses }).notNull().default("scheduled"),
    location: text("location").notNull().default(""),
  },
  (table) => [oneOf("day_of_staff_states_status_check", table.status, dayOfStaffStatuses)],
).enableRLS();
// Timeline checkpoints of an event day (food left kitchen, arrived at venue, ...).
// One row per event and checkpoint; reached_at is null while it hasn't happened
// (or after a mark made by mistake is cleared).
export const dayOfCheckpoints = pgTable(
  "day_of_checkpoints",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    key: text("key", { enum: dayOfCheckpointKeys }).notNull(),
    reachedAt: timestamptz("reached_at"),
    reachedBy: uuid("reached_by"),
  },
  (table) => [
    uniqueIndex("day_of_checkpoints_event_key_idx").on(table.eventId, table.key),
    oneOf("day_of_checkpoints_key_check", table.key, dayOfCheckpointKeys),
  ],
).enableRLS();
// The day-of update log (FLOW-156): one append-only row per board update, with
// who (created_by), what (summary, changes) and when (created_at), per event and
// truck. A database trigger rejects updates and deletes (migration 0050).
export const dayOfUpdates = pgTable(
  "day_of_updates",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    kind: text("kind", { enum: dayOfUpdateKinds }).notNull(),
    truckId: uuid("truck_id").references(() => trucks.id),
    slotId: uuid("slot_id").references(() => eventStaffSlots.id),
    // The staff member, truck or checkpoint as named when it changed.
    subjectName: text("subject_name").notNull(),
    summary: text("summary").notNull(),
    changes: jsonb("changes")
      .$type<Record<string, { before: unknown; after: unknown }>>()
      .notNull()
      .default({}),
    urgent: boolean("urgent").notNull().default(false),
  },
  (table) => [
    index("day_of_updates_event_idx").on(table.eventId, table.createdAt),
    index("day_of_updates_truck_idx").on(table.truckId, table.createdAt),
    oneOf("day_of_updates_kind_check", table.kind, dayOfUpdateKinds),
  ],
).enableRLS();
// The pull list (FLOW-134): one per event, with a scheduled pull time and a puller.
export const pullLists = pgTable("pull_lists", {
  ...baseColumns(),
  eventId: uuid("event_id")
    .notNull()
    .unique()
    .references(() => events.id),
  scheduledAt: timestamptz("scheduled_at"),
  pullerId: uuid("puller_id").references(() => users.id),
  generatedAt: timestamptz("generated_at"),
}).enableRLS();
// A line is a catalog item or, for something not in the catalog, a name. A null
// quantity is TBD. source_key ties a generated line to the proposal line it came
// from; hand-made lines have none. An archived row is a line someone removed: it
// stays so regenerating doesn't bring it back (the audit log has who and when).
export const pullListLines = pgTable(
  "pull_list_lines",
  {
    ...baseColumns(),
    pullListId: uuid("pull_list_id")
      .notNull()
      .references(() => pullLists.id),
    truckId: uuid("truck_id").references(() => trucks.id),
    group: text("line_group", { enum: pullGroups }).notNull(),
    itemId: uuid("item_id").references(() => masterInventoryItems.id),
    name: text("name").notNull().default(""),
    sectionId: uuid("section_id").references(() => inventoryLocations.id),
    quantity: quantity("quantity"),
    notes: text("notes").notNull().default(""),
    status: text("status", { enum: pullStatuses }).notNull().default("to_pull"),
    setupDay: boolean("setup_day").notNull().default(false),
    sourceKey: text("source_key"),
    // Changed by hand since it was generated.
    edited: boolean("edited").notNull().default(false),
    statusBy: uuid("status_by"),
    statusAt: timestamptz("status_at"),
  },
  (table) => [
    index("pull_list_lines_list_idx").on(table.pullListId),
    uniqueIndex("pull_list_lines_source_idx")
      .on(table.pullListId, table.sourceKey)
      .where(sql`${table.sourceKey} is not null`),
    oneOf("pull_list_lines_line_group_check", table.group, pullGroups),
    oneOf("pull_list_lines_status_check", table.status, pullStatuses),
    check(
      "pull_list_lines_quantity_check",
      sql`${table.quantity} is null or ${table.quantity} >= 0`,
    ),
  ],
).enableRLS();
// Post-event closeout (FLOW-157): one per event, with what came back of each pull
// line. The stock movements it created link to the event.
export const eventCloseouts = pgTable("event_closeouts", {
  ...baseColumns(),
  eventId: uuid("event_id")
    .notNull()
    .unique()
    .references(() => events.id),
  notes: text("notes").notNull().default(""),
  // Sub-rented items returned to their vendors, with the final notes for each.
  subRentals: jsonb("sub_rentals")
    .$type<{ vendorId: string; notes: string }[]>()
    .notNull()
    .default([]),
}).enableRLS();
export const closeoutLines = pgTable(
  "closeout_lines",
  {
    ...baseColumns(),
    closeoutId: uuid("closeout_id")
      .notNull()
      .references(() => eventCloseouts.id),
    pullLineId: uuid("pull_line_id")
      .notNull()
      .references(() => pullListLines.id),
    itemId: uuid("item_id").references(() => masterInventoryItems.id),
    name: text("name").notNull().default(""),
    pulled: quantity("pulled").notNull().default(0),
    returned: quantity("returned").notNull().default(0),
    damaged: quantity("damaged").notNull().default(0),
    missing: quantity("missing").notNull().default(0),
    used: quantity("used").notNull().default(0),
    leftover: quantity("leftover").notNull().default(0),
  },
  (table) => [
    uniqueIndex("closeout_lines_closeout_line_idx").on(table.closeoutId, table.pullLineId),
  ],
).enableRLS();
// Per-user Google Calendar sync (FLOW-268). One connection per user: the
// refresh token encrypted with AES-GCM (worker/google/crypto.ts, AC4) and the
// "Flowbase events" calendar the app created in their account. Disconnecting
// archives the row and deletes the token. The user's own Google events are
// never stored.
export const googleCalendarConnections = pgTable(
  "google_calendar_connections",
  {
    ...baseColumns(),
    // No foreign keys to users or events here: other code and tests truncate
    // those tables without this one.
    userId: uuid("user_id").notNull(),
    refreshTokenCipher: text("refresh_token_cipher"),
    calendarId: text("calendar_id"),
    // Set when Google refused the refresh token: the user must reconnect.
    needsReconnectAt: timestamptz("needs_reconnect_at"),
    lastSyncedAt: timestamptz("last_synced_at"),
  },
  (table) => [
    uniqueIndex("google_calendar_connections_user_idx")
      .on(table.userId)
      .where(sql`${table.archivedAt} is null`),
  ],
).enableRLS();
// The Google event each Flowbase event was copied to, per user, and a
// fingerprint of what was sent, so unchanged events aren't sent again.
export const googleCalendarEventLinks = pgTable(
  "google_calendar_event_links",
  {
    ...baseColumns(),
    connectionId: uuid("connection_id").notNull().references(() => googleCalendarConnections.id),
    eventId: uuid("event_id").notNull(),
    googleEventId: text("google_event_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
  },
  (table) => [
    uniqueIndex("google_calendar_event_links_event_idx")
      .on(table.connectionId, table.eventId)
      .where(sql`${table.archivedAt} is null`),
  ],
).enableRLS();
