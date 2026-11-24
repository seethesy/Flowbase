// Activity sessions and staff pay.
import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { payTypes, rateUnitValues } from "../../../shared/staff-pay";
import { baseColumns, moneyCents, oneOf, timestamptz } from "../conventions";

const activityRecordTypes = ["lead", "client", "proposal", "event", "beo", "task"] as const;
// Automatic activity time tracking (FLOW-119): one row per stretch of active time on
// one screen. The browser picks client_session_id and resends an open session with a
// later end, so (user_id, client_session_id) is unique. user_id has no foreign key
// until the users table exists (FLOW-37).
export const activitySessions = pgTable(
  "activity_sessions",
  {
    ...baseColumns(),
    userId: uuid("user_id").notNull(),
    clientSessionId: uuid("client_session_id").notNull(),
    startedAt: timestamptz("started_at").notNull(),
    endedAt: timestamptz("ended_at").notNull(),
    recordType: text("record_type", { enum: activityRecordTypes }),
    recordId: uuid("record_id"),
    activity: text("activity").notNull(),
  },
  (table) => [
    uniqueIndex("activity_sessions_client_session_idx").on(
      table.userId,
      table.clientSessionId,
    ),
    index("activity_sessions_started_idx").on(table.startedAt),
    index("activity_sessions_record_idx").on(table.recordType, table.recordId),
    oneOf("activity_sessions_record_type_check", table.recordType, activityRecordTypes),
  ],
).enableRLS();
// Staff pay (FLOW-270): each person's normal pay, kept off users so it never
// rides along on other queries. Linked to the staff member by full name (A4,
// Ash 2026-11-23); renaming a staff member renames the row. Audit-logged.
export const staffPay = pgTable(
  "staff_pay",
  {
    ...baseColumns(),
    staffFullName: text("staff_full_name").notNull(),
    payType: text("pay_type", { enum: payTypes }),
    rateCents: moneyCents("rate_cents"),
    rateUnit: text("rate_unit", { enum: rateUnitValues }),
    secondRateCents: moneyCents("second_rate_cents"),
    secondRateLabel: text("second_rate_label").notNull().default(""),
  },
  (table) => [
    uniqueIndex("staff_pay_name_idx")
      .on(sql`lower(${table.staffFullName})`)
      .where(sql`${table.archivedAt} is null`),
    oneOf("staff_pay_pay_type_check", table.payType, payTypes),
    oneOf("staff_pay_rate_unit_check", table.rateUnit, rateUnitValues),
  ],
).enableRLS();
// Pay for one event or one project that differs from the person's normal rate
// (FLOW-270 A2). Exactly one of event_id and project is set. Audit-logged.
export const staffPayExceptions = pgTable(
  "staff_pay_exceptions",
  {
    ...baseColumns(),
    staffFullName: text("staff_full_name").notNull(),
    // No foreign key: tests and tools truncate events without this table.
    eventId: uuid("event_id"),
    project: text("project"),
    amountCents: moneyCents("amount_cents").notNull(),
    note: text("note").notNull().default(""),
  },
  (table) => [
    index("staff_pay_exceptions_name_idx").on(sql`lower(${table.staffFullName})`),
    check(
      "staff_pay_exceptions_target_check",
      sql`(${table.eventId} is null) <> (${table.project} is null)`,
    ),
  ],
).enableRLS();
