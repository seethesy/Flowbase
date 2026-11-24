// BEOs: run of show, areas, checklist and changes.
import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { beoAreaKinds, beoStatuses, runOfShowModes } from "../../../shared/beo";
import { baseColumns, oneOf, timestamptz } from "../conventions";
import { events } from "./events";

// The banquet event order (FLOW-143/144): one per event. Its content is assembled
// live from the event's records; the row keeps the approval state, the free-text
// parts nothing else owns yet, and the field values as of the last check
// (`snapshot`), which change tracking compares against.
export const beos = pgTable(
  "beos",
  {
    ...baseColumns(),
    // One live BEO per event; a deleted (archived) one can sit beside a new one
    // (FLOW-288).
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    status: text("status", { enum: beoStatuses }).notNull().default("working_on"),
    approvalId: uuid("approval_id"),
    approvedAt: timestamptz("approved_at"),
    approvedBy: uuid("approved_by"),
    setupDetails: text("setup_details").notNull().default(""),
    cleanupChecklist: jsonb("cleanup_checklist").$type<string[]>().notNull().default([]),
    additionalNotes: text("additional_notes").notNull().default(""),
    snapshot: jsonb("snapshot").$type<Record<string, string>>().notNull().default({}),
    // Whether the run of show is on: by guest count (auto) or by hand (FLOW-145).
    runOfShowMode: text("run_of_show_mode", { enum: runOfShowModes }).notNull().default("auto"),
  },
  (table) => [
    uniqueIndex("beos_event_live_idx").on(table.eventId).where(sql`${table.archivedAt} is null`),
    oneOf("beos_status_check", table.status, beoStatuses),
    oneOf("beos_run_of_show_mode_check", table.runOfShowMode, runOfShowModes),
  ],
).enableRLS();
// The minute-by-minute run of show of a BEO (FLOW-145): time of day (New York),
// cue, owner (free text: a person, a role or a vendor) and notes.
export const beoRunOfShow = pgTable(
  "beo_run_of_show",
  {
    ...baseColumns(),
    beoId: uuid("beo_id")
      .notNull()
      .references(() => beos.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    time: text("time").notNull(),
    cue: text("cue").notNull(),
    owner: text("owner").notNull().default(""),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("beo_run_of_show_beo_idx").on(table.beoId, table.sortOrder)],
).enableRLS();
// A setup area (FLOW-146) or layout area (FLOW-147) of a BEO. Its photos and plan
// images are attachments on the area (record type beo_area). scene is the
// Excalidraw JSON of an annotated layout image; the rendered PNG is an attachment.
export const beoAreas = pgTable(
  "beo_areas",
  {
    ...baseColumns(),
    beoId: uuid("beo_id")
      .notNull()
      .references(() => beos.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    kind: text("kind", { enum: beoAreaKinds }).notNull(),
    name: text("name").notNull(),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    scene: jsonb("scene").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("beo_areas_beo_idx").on(table.beoId, table.kind, table.sortOrder),
    oneOf("beo_areas_kind_check", table.kind, beoAreaKinds),
  ],
).enableRLS();
// The cleanup/breakdown checklist of a BEO (FLOW-146): items grouped by section,
// checked off with who and when.
export const beoChecklistItems = pgTable(
  "beo_checklist_items",
  {
    ...baseColumns(),
    beoId: uuid("beo_id")
      .notNull()
      .references(() => beos.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    section: text("section").notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    checkedAt: timestamptz("checked_at"),
    checkedBy: uuid("checked_by"),
  },
  (table) => [index("beo_checklist_items_beo_idx").on(table.beoId, table.sortOrder)],
).enableRLS();
// Every edit made once a BEO has been approved: field, old value, new value, who
// and when (FLOW-144). `marked` is true until the next approval, which is how a
// field shows "changed since approval".
export const beoChanges = pgTable(
  "beo_changes",
  {
    ...baseColumns(),
    beoId: uuid("beo_id")
      .notNull()
      .references(() => beos.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    fieldKey: text("field_key").notNull(),
    fieldLabel: text("field_label").notNull(),
    section: text("section").notNull(),
    oldValue: text("old_value").notNull().default(""),
    newValue: text("new_value").notNull().default(""),
    changedBy: uuid("changed_by"),
    marked: boolean("marked").notNull().default(true),
  },
  (table) => [
    index("beo_changes_beo_idx").on(table.beoId, table.createdAt),
    index("beo_changes_event_idx").on(table.eventId),
  ],
).enableRLS();
