import { and, asc, eq, isNull, ne } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { can } from "../../shared/policy";
import {
  selfEditableStaffFields,
  staffMemberSchema,
  type StaffMember,
  type StaffUpdate,
} from "../../shared/staff";
import { serializeFields } from "../../shared/visibility";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { users } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { assertListLabels } from "./settings";

// Staff directory and profiles (FLOW-40). Everyone signed in reads the directory;
// phone numbers and notes follow shared/visibility.ts. Anyone edits their own
// phone number and SMS consent; users.manage (Admin) edits everything.

export const toStaffMember = (row: typeof users.$inferSelect): StaffMember =>
  staffMemberSchema.parse({
    id: row.id,
    name: row.name || row.email,
    email: row.email,
    mobile: row.mobile,
    role: row.role,
    employmentType: row.employmentType,
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

export async function listStaff(db: DbLike, actor: Actor) {
  const rows = await db
    .select()
    .from(users)
    .where(listed)
    .orderBy(asc(users.name), asc(users.email));
  return rows.map((row) => forActor(actor, toStaffMember(row)));
}

export async function getStaffMember(db: DbLike, actor: Actor, id: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), listed));
  if (!row) throw notFound("Staff member");
  return forActor(actor, toStaffMember(row));
}

export async function updateStaffMember(
  db: Db,
  actor: Actor,
  id: string,
  input: StaffUpdate,
) {
  const manages = can(actor, "users.manage");
  const fields = Object.keys(input) as (keyof StaffUpdate)[];
  if (!manages) {
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
    if (input.positions)
      await assertListLabels(tx, "staff_position", input.positions, row.positions);
    const before = toStaffMember(row);
    const { smsConsent, ...values } = input;
    const [updated] = await tx
      .update(users)
      .set({
        ...values,
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
  });
}
