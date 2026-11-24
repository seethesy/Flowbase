// App-wide tables: settings and lists, jobs, audit, imports, notifications, usage, live-edit wording and layouts, deletions and attachments.
import { sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { type StoredLayoutDoc } from "../../../shared/layout";
import { listKeys, settingKeys } from "../../../shared/settings";
import { importStatuses } from "../../../shared/imports";
import { notificationTypes } from "../../../shared/notifications";
import { deletableEntities } from "../../../shared/deletions";
import { baseColumns, oneOf, timestamptz } from "../conventions";

const attachmentStatuses = ["pending", "ready"] as const;
// Business settings (FLOW-45): one row per settings group (company profile,
// defaults), its value validated by shared/settings.ts. A missing row means the
// built-in defaults.
export const settings = pgTable(
  "settings",
  {
    ...baseColumns(),
    key: text("key", { enum: settingKeys }).notNull().unique(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [oneOf("settings_key_check", table.key, settingKeys)],
).enableRLS();
// Configurable lists (FLOW-45): event types, positions, vehicles, categories...
// Archived values stay on old records and are not offered for new ones. Labels are
// unique per list among active values.
export const listValues = pgTable(
  "list_values",
  {
    ...baseColumns(),
    listKey: text("list_key", { enum: listKeys }).notNull(),
    label: text("label").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    index("list_values_list_idx").on(table.listKey, table.sortOrder),
    uniqueIndex("list_values_label_idx")
      .on(table.listKey, sql`lower(${table.label})`)
      .where(sql`${table.archivedAt} is null`),
    oneOf("list_values_list_key_check", table.listKey, listKeys),
  ],
).enableRLS();
// Proves reads and writes through Hyperdrive. Served only where DB_CHECK_ROUTE is
// enabled (the dev environment); holds no business data.
export const connectionChecks = pgTable("connection_checks", {
  ...baseColumns(),
  note: text("note").notNull(),
}).enableRLS();
// Outbox and work queue (FLOW-27). Domain events and background work are rows here,
// written in the same transaction as the change they describe, and run by the cron.
export const jobStatuses = [
  "pending",
  "running",
  "succeeded",
  "failed",
] as const;
export const jobs = pgTable(
  "jobs",
  {
    ...baseColumns(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    runAt: timestamptz("run_at").notNull().defaultNow(),
    attempts: integer("attempts").notNull().default(0),
    status: text("status", { enum: jobStatuses }).notNull().default("pending"),
    lastError: text("last_error"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    lockedAt: timestamptz("locked_at"),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    index("jobs_status_run_at_idx").on(table.status, table.runAt),
    oneOf("jobs_status_check", table.status, jobStatuses),
  ],
).enableRLS();
// Audit log (FLOW-41): one append-only row per create, update, archive or restore
// of a core record, written in the same transaction as the change. changes holds
// only the fields that changed, keyed by their API name. The API never updates or
// deletes these rows; created_by is the actor.
export const auditActions = ["create", "update", "archive", "restore"] as const;
export type AuditChanges = Record<string, { before: unknown; after: unknown }>;
export const auditLog = pgTable(
  "audit_log",
  {
    ...baseColumns(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    action: text("action", { enum: auditActions }).notNull(),
    changes: jsonb("changes").$type<AuditChanges>().notNull(),
  },
  (table) => [
    index("audit_log_entity_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt,
    ),
    oneOf("audit_log_action_check", table.action, auditActions),
  ],
).enableRLS();
// Data imports (FLOW-47): one log row per import run of a module importer: who
// (created_by), when (created_at), the file and the row counts. Stock movements
// that set imported starting quantities link here (link_type "import").
export const importLogs = pgTable(
  "import_logs",
  {
    ...baseColumns(),
    module: text("module").notNull(),
    fileName: text("file_name").notNull(),
    status: text("status", { enum: importStatuses })
      .notNull()
      .default("running"),
    rowCount: integer("row_count").notNull().default(0),
    created: integer("created").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    completedAt: timestamptz("completed_at"),
  },
  (table) => [
    index("import_logs_module_idx").on(table.module, table.createdAt),
    oneOf("import_logs_status_check", table.status, importStatuses),
  ],
).enableRLS();
// The record each external key imported to, per module (FLOW-47 AC1): a re-run
// updates that record instead of creating another. record_id has no foreign key
// because each module imports into its own table.
export const importKeys = pgTable(
  "import_keys",
  {
    ...baseColumns(),
    module: text("module").notNull(),
    externalKey: text("external_key").notNull(),
    recordId: uuid("record_id").notNull(),
    // The import that last wrote the record.
    importId: uuid("import_id")
      .notNull()
      .references(() => importLogs.id),
  },
  (table) => [
    uniqueIndex("import_keys_module_key_idx").on(table.module, table.externalKey),
  ],
).enableRLS();
// Attachments (FLOW-42): file metadata linked to any record; the bytes live in R2.
// variants lists the stored objects: a photo's "thumb" and "display" sizes, or a
// document's "original".
export type AttachmentVariant = {
  name: "thumb" | "display" | "original";
  key: string;
  contentType: string;
  size: number;
};
export const attachments = pgTable(
  "attachments",
  {
    ...baseColumns(),
    recordType: text("record_type").notNull(),
    recordId: uuid("record_id").notNull(),
    group: text("group").notNull().default(""),
    fileName: text("file_name").notNull(),
    // FLOW-263: one document may have several immutable file versions.
    documentId: uuid("document_id"),
    displayName: text("display_name"),
    docType: text("doc_type").notNull().default("other"),
    versionNumber: integer("version_number").notNull().default(1),
    protected: boolean("protected").notNull().default(false),
    caption: text("caption").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    // Photo galleries (FLOW-271, FLOW-298): Marketing's approval and tags, and
    // the photo's own date (null means the upload date).
    approvedForMarketing: boolean("approved_for_marketing").notNull().default(false),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    photoDate: date("photo_date", { mode: "string" }),
    status: text("status", { enum: attachmentStatuses })
      .notNull()
      .default("pending"),
    variants: jsonb("variants").$type<AttachmentVariant[]>().notNull(),
  },
  (table) => [
    index("attachments_record_idx").on(table.recordType, table.recordId),
    index("attachments_document_idx").on(table.documentId, table.versionNumber),
    oneOf("attachments_status_check", table.status, attachmentStatuses),
  ],
).enableRLS();
// Notifications (FLOW-43): one row per recipient per domain event. source_key is
// the event job's idempotency key, so a retried job never notifies anyone twice
// (AC1). emailed_at is set once the email is accepted by the provider.
export const notifications = pgTable(
  "notifications",
  {
    ...baseColumns(),
    userId: uuid("user_id").notNull(),
    type: text("type", { enum: notificationTypes }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    link: text("link"),
    sourceKey: text("source_key").notNull(),
    readAt: timestamptz("read_at"),
    emailedAt: timestamptz("emailed_at"),
  },
  (table) => [
    uniqueIndex("notifications_source_user_idx").on(
      table.sourceKey,
      table.userId,
    ),
    index("notifications_user_created_idx").on(table.userId, table.createdAt),
    oneOf("notifications_type_check", table.type, notificationTypes),
  ],
).enableRLS();
// Email and SMS choices per user and notification type. No row means off.
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    ...baseColumns(),
    userId: uuid("user_id").notNull(),
    type: text("type", { enum: notificationTypes }).notNull(),
    email: boolean("email").notNull(),
    sms: boolean("sms").notNull().default(false),
  },
  (table) => [
    uniqueIndex("notification_preferences_user_type_idx").on(
      table.userId,
      table.type,
    ),
    oneOf("notification_preferences_type_check", table.type, notificationTypes),
  ],
).enableRLS();
// Stub SMS delivery log. A provider can later replace the recorder while keeping
// the same consent, cap and idempotency rules.
export const smsOutbox = pgTable(
  "sms_outbox",
  {
    ...baseColumns(),
    notificationId: uuid("notification_id").notNull(),
    userId: uuid("user_id").notNull(),
    mobile: text("mobile").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: ["recorded", "sent", "failed"] }).notNull().default("recorded"),
    provider: text("provider").notNull().default("stub"),
  },
  (table) => [
    uniqueIndex("sms_outbox_notification_idx").on(table.notificationId),
    index("sms_outbox_created_idx").on(table.createdAt),
    oneOf("sms_outbox_status_check", table.status, ["recorded", "sent", "failed"]),
  ],
).enableRLS();
// Approximate free-tier use. Period is UTC day, UTC month, or "current" for
// storage snapshots; each update is an atomic counter or replacement.
export const usageCounters = pgTable(
  "usage_counters",
  {
    ...baseColumns(),
    metric: text("metric").notNull(),
    period: text("period").notNull(),
    value: numeric("value").notNull().default("0"),
  },
  (table) => [uniqueIndex("usage_counters_metric_period_idx").on(table.metric, table.period)],
).enableRLS();
// Admin live text editing (FLOW-240): the admin's wording for a built-in string,
// keyed by its <T id>. A missing row means the default in code. Reset deletes the
// row (wording, not record data, so nothing is kept). updated_by is the editor.
export const uiCopy = pgTable("ui_copy", {
  ...baseColumns(),
  key: text("key").notNull().unique(),
  text: text("text").notNull(),
}).enableRLS();
// Bulk delete (FLOW-260, A1): a deleted record is archived and has an open row
// here (restored_at null), which hides it from the Show archived lists. An Admin
// restores it from Settings › Archived; Undo restores it at once. Rows are kept
// after a restore as the record of what happened. name is the record's label at
// deletion, for the Archived view.
export const deletions = pgTable(
  "deletions",
  {
    ...baseColumns(),
    entityType: text("entity_type", { enum: deletableEntities }).notNull(),
    entityId: uuid("entity_id").notNull(),
    name: text("name").notNull().default(""),
    deletedAt: timestamptz("deleted_at").notNull().defaultNow(),
    deletedBy: uuid("deleted_by"),
    restoredAt: timestamptz("restored_at"),
    restoredBy: uuid("restored_by"),
  },
  (table) => [
    index("deletions_entity_idx").on(table.entityType, table.entityId),
    index("deletions_open_idx").on(table.deletedAt).where(sql`${table.restoredAt} is null`),
    oneOf("deletions_entity_type_check", table.entityType, deletableEntities),
  ],
).enableRLS();
// Admin live layout editing (FLOW-253): one saved layout per page, shared by
// everyone. `layout` is a LayoutDoc (shared/layout.ts); no row means the code
// default. Base columns keep who saved it and when.
export const uiLayout = pgTable("ui_layout", {
  ...baseColumns(),
  pageKey: text("page_key").notNull().unique(),
  layout: jsonb("layout").$type<StoredLayoutDoc>().notNull(),
}).enableRLS();
