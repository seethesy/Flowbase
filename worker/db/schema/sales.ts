// Clients, venues, proposals, contracts, payments and communications.
import { sql } from "drizzle-orm";
import { boolean, check, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { paymentMethods, scheduleKinds } from "../../../shared/payments";
import { proposalStages } from "../../../shared/proposals";
import { type ProposalMapping } from "../../../shared/proposal-mapping";
import { communicationKinds } from "../../../shared/communications";
import { baseColumns, moneyCents, oneOf, timestamptz } from "../conventions";
import { trigram } from "./common";
import { events } from "./events";
import { attachments } from "./platform";

// Values of enum-like text columns that have no shared name elsewhere; each
// column also gets a oneOf() CHECK constraint (FLOW-187).
const clientKinds = ["person", "organization"] as const;
const clientContactRoles = [
  "primary_poc",
  "billing",
  "venue_manager",
  "event_coordinator",
] as const;
const jurisdictions = ["DC", "MD", "VA"] as const;
const venueContactRoles = ["manager", "coordinator"] as const;
// Core records (FLOW-53/54/55). People columns (assigned salesperson, Production
// Leads) retain stable staff ids, including assignments made before sign-in shipped.
export const clients = pgTable(
  "clients",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    kind: text("kind", { enum: clientKinds }).notNull(),
    assignedSalespersonId: uuid("assigned_salesperson_id"),
    notes: text("notes").notNull().default(""),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    // Set when a salesperson created a client matching one they can't see.
    possibleDuplicateOfId: uuid("possible_duplicate_of_id").references(
      (): AnyPgColumn => clients.id,
    ),
  },
  (table) => [
    index("clients_salesperson_idx").on(table.assignedSalespersonId),
    trigram("clients_name_trgm_idx", table.name),
    oneOf("clients_kind_check", table.kind, clientKinds),
  ],
).enableRLS();
export const clientContacts = pgTable(
  "client_contacts",
  {
    ...baseColumns(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id),
    name: text("name").notNull(),
    role: text("role", { enum: clientContactRoles }).notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    // Digits only, for duplicate matching.
    phoneDigits: text("phone_digits").notNull().default(""),
    notes: text("notes").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("client_contacts_client_idx").on(table.clientId),
    index("client_contacts_email_idx").on(table.email),
    index("client_contacts_email_lower_idx").on(sql`lower(${table.email})`),
    index("client_contacts_phone_idx").on(table.phoneDigits),
    trigram("client_contacts_name_trgm_idx", table.name),
    oneOf("client_contacts_role_check", table.role, clientContactRoles),
  ],
).enableRLS();
export const venues = pgTable(
  "venues",
  {
    ...baseColumns(),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    // Stored for future tax use.
    jurisdiction: text("jurisdiction", { enum: jurisdictions }),
    loadInNotes: text("load_in_notes").notNull().default(""),
    parkingNotes: text("parking_notes").notNull().default(""),
  },
  (table) => [
    trigram("venues_name_trgm_idx", table.name),
    oneOf("venues_jurisdiction_check", table.jurisdiction, jurisdictions),
  ],
).enableRLS();
export const venueAreas = pgTable(
  "venue_areas",
  {
    ...baseColumns(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [index("venue_areas_venue_idx").on(table.venueId)],
).enableRLS();
export const venueContacts = pgTable(
  "venue_contacts",
  {
    ...baseColumns(),
    venueId: uuid("venue_id")
      .notNull()
      .references(() => venues.id),
    name: text("name").notNull(),
    role: text("role", { enum: venueContactRoles }).notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("venue_contacts_venue_idx").on(table.venueId),
    oneOf("venue_contacts_role_check", table.role, venueContactRoles),
  ],
).enableRLS();
// Proposals (FLOW-122): one or more per event, each tracked through its own stages
// while it is written in Google Docs. current_version_id points at the version
// marked current (FLOW-123); null before the first upload.
export const proposals = pgTable(
  "proposals",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    clientId: uuid("client_id").references(() => clients.id),
    title: text("title").notNull(),
    assignedSalespersonId: uuid("assigned_salesperson_id"),
    notes: text("notes").notNull().default(""),
    stage: text("stage", { enum: proposalStages })
      .notNull()
      .default("p_creation"),
    lostReason: text("lost_reason").notNull().default(""),
    currentVersionId: uuid("current_version_id").references(
      (): AnyPgColumn => proposalVersions.id,
    ),
    sentAt: timestamptz("sent_at"),
    sentMethod: text("sent_method"),
  },
  (table) => [
    index("proposals_event_idx").on(table.eventId),
    index("proposals_salesperson_idx").on(table.assignedSalespersonId),
    oneOf("proposals_stage_check", table.stage, proposalStages),
  ],
).enableRLS();
// Stage history (FLOW-122): one row per stage change: who (created_by; null for the
// system), when (created_at), from and to, and why.
export const proposalStageHistory = pgTable(
  "proposal_stage_history",
  {
    ...baseColumns(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id),
    // null for the stage the proposal was created in.
    fromStage: text("from_stage"),
    toStage: text("to_stage").notNull(),
    reason: text("reason").notNull().default(""),
    // false when an action (upload, approval, sending, booking) set the stage.
    manual: boolean("manual").notNull().default(true),
  },
  (table) => [
    index("proposal_stage_history_proposal_idx").on(table.proposalId),
  ],
).enableRLS();
// Proposal versions (FLOW-123, ADR-16): each finalized upload, immutable once ready.
// A version gets its number when its upload completes, so an abandoned upload
// leaves no gap; created_by and completed_at are the uploader and upload time.
export type ProposalFile = {
  key: string;
  fileName: string;
  contentType: string;
  size: number;
};
const proposalVersionStatuses = ["pending", "ready"] as const;
export const proposalVersions = pgTable(
  "proposal_versions",
  {
    ...baseColumns(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references((): AnyPgColumn => proposals.id),
    number: integer("number"),
    status: text("status", { enum: proposalVersionStatuses })
      .notNull()
      .default("pending"),
    docx: jsonb("docx").$type<ProposalFile>().notNull(),
    pdf: jsonb("pdf").$type<ProposalFile>(),
    completedAt: timestamptz("completed_at"),
    sentAt: timestamptz("sent_at"),
    sentMethod: text("sent_method"),
  },
  (table) => [
    uniqueIndex("proposal_versions_number_idx").on(table.proposalId, table.number),
    oneOf("proposal_versions_status_check", table.status, proposalVersionStatuses),
    check(
      "proposal_versions_ready_numbered",
      sql`${table.status} = 'pending' or (${table.number} is not null and ${table.completedAt} is not null)`,
    ),
  ],
).enableRLS();
// The confirmed mapping for a proposal's current Word version (FLOW-125).
export const proposalMappings = pgTable(
  "proposal_mappings",
  {
    ...baseColumns(),
    proposalId: uuid("proposal_id").notNull().references(() => proposals.id),
    versionId: uuid("version_id").notNull().references(() => proposalVersions.id),
    data: jsonb("data").$type<ProposalMapping>().notNull(),
  },
  (table) => [uniqueIndex("proposal_mappings_proposal_idx").on(table.proposalId)],
).enableRLS();
export const proposalVersionMappings = pgTable("proposal_version_mappings", {
  ...baseColumns(),
  versionId: uuid("version_id").notNull().references(() => proposalVersions.id).unique(),
  data: jsonb("data").$type<ProposalMapping>().notNull(),
}).enableRLS();
export const proposalChangeLog = pgTable("proposal_change_log", {
  ...baseColumns(),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id),
  versionId: uuid("version_id").notNull().references(() => proposalVersions.id),
  path: text("path").notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
}, (table) => [index("proposal_change_log_proposal_idx").on(table.proposalId, table.createdAt)]).enableRLS();
export const contracts = pgTable("contracts", {
  ...baseColumns(),
  eventId: uuid("event_id").notNull().references(() => events.id),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id),
  versionId: uuid("version_id").notNull().references(() => proposalVersions.id),
  signedAt: timestamptz("signed_at").notNull(),
  clientSigner: text("client_signer").notNull(),
  salespersonSigner: text("salesperson_signer").notNull(),
  cardOnFile: boolean("card_on_file").notNull().default(false),
  cardLast4: text("card_last_4"),
  attachmentId: uuid("attachment_id").references(() => attachments.id),
}, (table) => [index("contracts_event_idx").on(table.eventId)]).enableRLS();
export const addendums = pgTable("addendums", {
  ...baseColumns(),
  eventId: uuid("event_id").notNull().references(() => events.id),
  proposalId: uuid("proposal_id").notNull().references(() => proposals.id),
  proposalVersionId: uuid("proposal_version_id").notNull().references(() => proposalVersions.id),
  changeIds: jsonb("change_ids").$type<string[]>().notNull().default([]),
  sentAt: timestamptz("sent_at").notNull(),
  signedAt: timestamptz("signed_at"),
  reminderSentAt: timestamptz("reminder_sent_at"),
}, (table) => [index("addendums_event_idx").on(table.eventId)]).enableRLS();
// The payment schedule (FLOW-131): what the client owes and when. due_date is a
// New York calendar date. proposal_id and source_key work like the timeline's.
export const paymentScheduleItems = pgTable(
  "payment_schedule_items",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    kind: text("kind", { enum: scheduleKinds }).notNull(),
    label: text("label").notNull().default(""),
    amountCents: moneyCents("amount_cents").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    proposalId: uuid("proposal_id").references(() => proposals.id),
    sourceKey: text("source_key"),
  },
  (table) => [
    index("payment_schedule_items_event_idx").on(table.eventId, table.dueDate),
    uniqueIndex("payment_schedule_items_source_idx")
      .on(table.proposalId, table.sourceKey)
      .where(sql`${table.sourceKey} is not null and ${table.archivedAt} is null`),
    oneOf("payment_schedule_items_kind_check", table.kind, scheduleKinds),
    check("payment_schedule_items_amount_positive", sql`${table.amountCents} > 0`),
  ],
).enableRLS();
// A payment received and recorded by hand (FLOW-131). created_by is who recorded it.
// No card numbers: the reference is refused when it looks like one, and the table
// has no column for card data.
export const payments = pgTable(
  "payments",
  {
    ...baseColumns(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    method: text("method", { enum: paymentMethods }).notNull(),
    amountCents: moneyCents("amount_cents").notNull(),
    receivedOn: date("received_on", { mode: "string" }).notNull(),
    reference: text("reference").notNull().default(""),
    note: text("note").notNull().default(""),
  },
  (table) => [
    index("payments_event_idx").on(table.eventId, table.receivedOn),
    oneOf("payments_method_check", table.method, paymentMethods),
    check("payments_amount_positive", sql`${table.amountCents} > 0`),
  ],
).enableRLS();
// Client communication log (FLOW-120): one row per call, email, text, meeting or
// note, against exactly one lead, client or event. created_by is who logged it.
// A follow-up date makes a task (follow_up_task_id) in the task engine.
export const communications = pgTable(
  "communications",
  {
    ...baseColumns(),
    // Plain ids, like a task's links: no foreign keys, so records stay clearable.
    leadId: uuid("lead_id"),
    clientId: uuid("client_id"),
    eventId: uuid("event_id"),
    kind: text("kind", { enum: communicationKinds }).notNull(),
    occurredAt: timestamptz("occurred_at").notNull(),
    summary: text("summary").notNull(),
    followUpDate: date("follow_up_date", { mode: "string" }),
    followUpTaskId: uuid("follow_up_task_id"),
  },
  (table) => [
    index("communications_lead_idx").on(table.leadId, table.occurredAt),
    index("communications_client_idx").on(table.clientId, table.occurredAt),
    index("communications_event_idx").on(table.eventId, table.occurredAt),
    oneOf("communications_kind_check", table.kind, communicationKinds),
    check(
      "communications_one_record_check",
      sql`num_nonnulls(${table.leadId}, ${table.clientId}, ${table.eventId}) = 1`,
    ),
  ],
).enableRLS();
// Saved sales tracker filters belong to the person who created them.
export const salesViews = pgTable("sales_views", {
  ...baseColumns(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  filter: jsonb("filter").$type<import("../../../shared/sales").SalesFilter>().notNull(),
}, (table) => [index("sales_views_user_idx").on(table.userId, table.createdAt)]).enableRLS();
