// Staff accounts and the roles and permissions matrix (FLOW-269, FLOW-284).
import { sql } from "drizzle-orm";
import { boolean, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { roles } from "../../../shared/access";
import { areaKeys, levels } from "../../../shared/role-permissions";
import { userStatuses } from "../../../shared/users";
import { baseColumns, oneOf, timestamptz } from "../conventions";

// Every table: spread baseColumns() and finish with .enableRLS() (see conventions.ts).
// CI fails if a migrated table in the public schema lacks RLS.

// Allowlist and durable staff identity. Never delete on deactivation: assignments
// and audit entries continue to refer to this id and stored Google display name.
export const users = pgTable(
  "users",
  {
    ...baseColumns(),
    email: text("email").notNull(),
    secondaryEmail: text("secondary_email"),
    name: text("name").notNull().default(""),
    authId: uuid("auth_id").unique(),
    role: text("role", { enum: roles }).notNull(),
    mobile: text("mobile").notNull(),
    status: text("status", { enum: userStatuses }).notNull().default("pending"),
    invitedAt: timestamptz("invited_at").notNull().defaultNow(),
    activatedAt: timestamptz("activated_at"),
    // Staff directory (FLOW-40): Admin's notes, the positions this person can work
    // (staff_position list labels) and when they opted in to SMS (null: not opted in).
    notes: text("notes").notNull().default(""),
    positions: jsonb("positions").$type<string[]>().notNull().default([]),
    smsConsentAt: timestamptz("sms_consent_at"),
    // Staff without a Flowbase account (FLOW-270 A3): no email, never invited,
    // can't sign in and never notified. Their role is stored as the least
    // privileged one and shown blank; it grants nothing because they never sign in.
    hasAccount: boolean("has_account").notNull().default(true),
  },
  (table) => [
    // Staff without accounts have no email, so only real addresses are unique.
    uniqueIndex("users_email_idx").on(sql`lower(${table.email})`).where(sql`${table.email} <> ''`),
    oneOf("users_role_check", table.role, roles),
    oneOf("users_status_check", table.status, userStatuses),
  ],
).enableRLS();
// Roles and permissions (FLOW-269): the level (none, read, own, write) each role
// has in each area. The Worker loads it per request (cached, invalidated on
// save) and shared/policy.ts reads it; rows are seeded from the built-in rules,
// so day-one behavior is unchanged. Admin's rows are locked to write.
export const rolePermissions = pgTable(
  "role_permissions",
  {
    ...baseColumns(),
    role: text("role", { enum: roles }).notNull(),
    area: text("area", { enum: areaKeys as [string, ...string[]] }).notNull(),
    level: text("level", { enum: levels }).notNull(),
  },
  (table) => [
    uniqueIndex("role_permissions_role_area_idx").on(table.role, table.area),
    oneOf("role_permissions_role_check", table.role, roles),
    oneOf("role_permissions_area_check", table.area, areaKeys),
    oneOf("role_permissions_level_check", table.level, levels),
  ],
).enableRLS();
// Which roles see each sidebar heading and tab (FLOW-284): one row per role with
// the nav keys it hides (shared/nav-visibility.ts). No row means the role sees
// everything its permissions allow. UI only: the API still answers by area.
export const roleNavHidden = pgTable(
  "role_nav_hidden",
  {
    ...baseColumns(),
    role: text("role", { enum: roles }).notNull().unique(),
    hidden: jsonb("hidden").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (table) => [oneOf("role_nav_hidden_role_check", table.role, roles)],
).enableRLS();
