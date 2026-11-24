import { and, asc, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Actor } from "../../../shared/access";
import { can } from "../../../shared/policy";
import {
  selfEditableStaffFields,
  staffMemberSchema,
  type StaffCreate,
  type StaffMember,
  type StaffUpdate,
} from "../../../shared/staff";
import { rateLabel } from "../../../shared/staff-pay";
import { serializeFields } from "../../../shared/visibility";
import { writeAudit } from "../../audit/log";
import type { Db, DbLike } from "../../db/client";
import { eventShifts, eventStaffSlots, events, staffPay, staffPayExceptions, users } from "../../db/schema";
import { ApiError, forbidden, notFound } from "../../hono";
import { assertListLabels } from "../settings/settings";

// Staff directory and profiles (FLOW-40). Everyone signed in reads the directory;
// phone numbers and notes follow shared/visibility.ts. Anyone edits their own
// phone number and SMS consent; users.manage (Admin) edits everything.

// The name pay is linked by (FLOW-270 A4): the directory's name for the person.
export const staffFullName = (row: { name: string; email: string }) => (row.name || row.email).trim();

export const toStaffMember = (row: typeof users.$inferSelect): StaffMember =>
  staffMemberSchema.parse({
    id: row.id,
    name: row.name || row.email,
    email: row.email,
    secondaryEmail: row.secondaryEmail,
    mobile: row.mobile,
    // Staff without accounts have no user type (FLOW-270 A3).
    role: row.hasAccount ? row.role : null,
    hasAccount: row.hasAccount,
    status: row.status,
    active: row.status === "active",
    positions: row.positions,
    notes: row.notes,
    smsConsent: row.smsConsentAt !== null,
    smsConsentAt: row.smsConsentAt?.toISOString() ?? null,
  });

const forActor = (actor: Actor, member: StaffMember) =>
  serializeFields(actor, "staff_member", member, { subjectUserId: member.id });

const listed = and(isNull(users.archivedAt), ne(users.status, "revoked"));

// Pay type and rate ride along only for people who may read pay (FLOW-270 AC2):
// everyone else's response has no pay keys at all.
async function withPay(db: DbLike, actor: Actor, members: StaffMember[]): Promise<StaffMember[]> {
  if (!can(actor, "staff.pay.read")) return members;
  const rows = await db.select().from(staffPay).where(isNull(staffPay.archivedAt));
  const byName = new Map(rows.map((row) => [row.staffFullName.toLowerCase(), row]));
  return members.map((member) => {
    const pay = byName.get(member.name.trim().toLowerCase());
    return {
      ...member,
      payType: pay?.payType ?? null,
      payRate: pay ? rateLabel(pay.rateCents, pay.rateUnit) : "",
    };
  });
}

export async function listStaff(db: DbLike, actor: Actor) {
  const rows = await db
    .select()
    .from(users)
    .where(listed)
    .orderBy(asc(users.name), asc(users.email));
  return withPay(db, actor, rows.map((row) => forActor(actor, toStaffMember(row))));
}

export async function getStaffMember(db: DbLike, actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), listed));
  if (!row) throw notFound("Staff member");
  const [member] = await withPay(db, actor, [forActor(actor, toStaffMember(row))]);
  return member;
}

// Pay is linked by full name (A4), so two listed staff can't share one.
async function assertNameFree(tx: DbLike, name: string, exceptId?: string) {
  const [taken] = await tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        listed,
        sql`lower(trim(coalesce(nullif(${users.name}, ''), ${users.email}))) = ${name.trim().toLowerCase()}`,
        exceptId ? ne(users.id, exceptId) : undefined,
      ),
    )
    .limit(1);
  if (taken)
    throw new ApiError(
      409,
      "DUPLICATE_NAME",
      `Another staff member is named ${name.trim()}. Pay is linked by full name, so give each person a different name.`,
    );
}

// Moves pay rows to a staff member's new name in the same transaction as the
// rename, audit-logged like any pay change.
async function renamePay(tx: DbLike, actor: Actor, from: string, to: string) {
  const pay = await tx
    .update(staffPay)
    .set({ staffFullName: to, updatedBy: actor.userId })
    .where(and(sql`lower(${staffPay.staffFullName}) = ${from.toLowerCase()}`, isNull(staffPay.archivedAt)))
    .returning({ id: staffPay.id });
  const exceptions = await tx
    .update(staffPayExceptions)
    .set({ staffFullName: to, updatedBy: actor.userId })
    .where(and(sql`lower(${staffPayExceptions.staffFullName}) = ${from.toLowerCase()}`, isNull(staffPayExceptions.archivedAt)))
    .returning({ id: staffPayExceptions.id });
  for (const row of pay)
    await writeAudit(tx, actor, { entityType: "staff_pay", entityId: row.id, action: "update", before: { staffFullName: from }, after: { staffFullName: to } });
  for (const row of exceptions)
    await writeAudit(tx, actor, { entityType: "staff_pay_exception", entityId: row.id, action: "update", before: { staffFullName: from }, after: { staffFullName: to } });
}

// An Admin adds someone who has no Flowbase account (FLOW-270 A3): no email, no
// invite, no sign-in, blank role, schedulable, never notified.
export async function createStaffMember(db: Db, actor: Actor, input: StaffCreate) {
  if (!can(actor, "users.manage")) throw forbidden();
  return db.transaction(async (tx) => {
    const name = input.name.trim();
    await assertNameFree(tx, name);
    if (input.positions?.length) await assertListLabels(tx, "staff_position", input.positions, []);
    const [row] = await tx
      .insert(users)
      .values({
        email: "",
        name,
        mobile: input.mobile ?? "",
        positions: input.positions ?? [],
        // Stored as the least privileged role; shown blank and never used,
        // because a staff member without an account never signs in.
        role: "part_time_staff",
        status: "active",
        hasAccount: false,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    const member = toStaffMember(row);
    await writeAudit(tx, actor, { entityType: "user", entityId: row.id, action: "create", before: null, after: member });
    return forActor(actor, member);
  });
}

// Delete from the directory (FLOW-260 rules, FLOW-270): your own account and
// people on upcoming shifts are skipped.
export async function staffDeleteBlocked(db: DbLike, actor: Actor, id: string): Promise<string | null> {
  if (id === actor.userId) return "is your own account";
  const [upcoming] = await db
    .select({ id: eventStaffSlots.id })
    .from(eventStaffSlots)
    .innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
    .innerJoin(events, eq(events.id, eventShifts.eventId))
    .where(
      and(
        eq(eventStaffSlots.assigneeId, id),
        isNull(eventStaffSlots.archivedAt),
        isNull(eventShifts.archivedAt),
        isNull(events.archivedAt),
        gt(eventShifts.startsAt, new Date()),
      ),
    )
    .limit(1);
  return upcoming ? "is on upcoming shifts" : null;
}

export async function staffDeleteName(db: DbLike, actor: Actor, id: string) {
  return (await getStaffMember(db, actor, id)).name;
}

export async function setStaffArchived(db: Db, actor: Actor, id: string, archived: boolean) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(users).where(eq(users.id, id)).for("update");
    if (!row || row.status === "revoked") throw notFound("Staff member");
    if (!archived) await assertNameFree(tx, staffFullName(row), id);
    const [updated] = await tx
      .update(users)
      .set({ archivedAt: archived ? new Date() : null, updatedBy: actor.userId })
      .where(eq(users.id, id))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "user",
      entityId: id,
      action: archived ? "archive" : "restore",
      before: toStaffMember(row),
      after: toStaffMember(updated),
    });
    return toStaffMember(updated);
  });
}

export async function updateStaffMember(
  db: Db,
  actor: Actor,
  id: string,
  input: StaffUpdate,
) {
  const manages = can(actor, "users.manage");
  const fields = Object.keys(input) as (keyof StaffUpdate)[];
  // Admin and Technical change roles (FLOW-270 A5), one by one or in bulk.
  const rolesOnly = fields.length > 0 && fields.every((field) => field === "role");
  if (!manages && !(rolesOnly && can(actor, "staff.roles"))) {
    if (id !== actor.userId) throw forbidden();
    if (
      fields.some(
        (field) =>
          !(selfEditableStaffFields as readonly string[]).includes(field),
      )
    )
      throw new ApiError(
        403,
        "FORBIDDEN",
        "You can change only your mobile number and SMS consent.",
      );
  }
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, id), listed))
      .for("update");
    if (!row) throw notFound("Staff member");
    // Changing your own role could remove the last Admin.
    if (id === actor.userId && input.role && input.role !== row.role)
      throw new ApiError(
        409,
        "SELF_ROLE_CHANGE",
        "Ask another Admin to change your role.",
      );
    if (input.role && input.role !== row.role) {
      // Staff without accounts keep a blank role (FLOW-270 A3).
      if (!row.hasAccount)
        throw new ApiError(409, "NO_ACCOUNT", "Staff without a Flowbase account have no role.");
      // Only an Admin grants or removes Admin.
      if (!manages && (input.role === "admin" || row.role === "admin"))
        throw new ApiError(403, "FORBIDDEN", "Only an Admin can grant or remove the Admin role.");
    }
    if (input.status && input.status !== row.status && row.hasAccount)
      throw new ApiError(409, "HAS_ACCOUNT", "Change this person's account status in Settings › Users.");
    if (input.positions)
      await assertListLabels(tx, "staff_position", input.positions, row.positions);
    const before = toStaffMember(row);
    const oldName = staffFullName(row);
    const newName = input.name?.trim();
    if (newName && newName !== oldName) {
      if (newName.toLowerCase() !== oldName.toLowerCase()) await assertNameFree(tx, newName, id);
      await renamePay(tx, actor, oldName, newName);
    }
    const { smsConsent, secondaryEmail, ...values } = input;
    const [updated] = await tx
      .update(users)
      .set({
        ...values,
        ...(secondaryEmail !== undefined && { secondaryEmail: secondaryEmail || null }),
        // The opt-in date is when consent was given; turning it off clears it.
        ...(smsConsent !== undefined && {
          smsConsentAt: smsConsent ? (row.smsConsentAt ?? new Date()) : null,
        }),
        updatedBy: actor.userId,
      })
      .where(eq(users.id, id))
      .returning();
    const after = toStaffMember(updated);
    await writeAudit(tx, actor, {
      entityType: "user",
      entityId: id,
      action: "update",
      before,
      after,
    });
    return forActor(actor, after);
  }).then(async (member) => (await withPay(db, actor, [member]))[0]);
}
