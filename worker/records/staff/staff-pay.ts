import { and, asc, eq, gte, inArray, isNull, lt, ne, sql, type SQL } from "drizzle-orm";
import type { Actor } from "../../../shared/access";
import {
  rateUnits,
  type PayException,
  type PayExceptionInput,
  type PayExceptionUpdate,
  type Payroll,
  type StaffPay,
  type StaffPayInput,
} from "../../../shared/staff-pay";
import { addLocalDays, businessTimeToUtc } from "../../../shared/time";
import { writeAudit } from "../../audit/log";
import type { Db, DbLike } from "../../db/client";
import { activitySessions, events, staffPay, staffPayExceptions, users } from "../../db/schema";
import { ApiError, forbidden, notFound } from "../../hono";
import { can } from "../../policy";
import { staffFullName } from "./staff";

// Staff pay and the Payroll tab (FLOW-270). Only people with the Staff pay area
// (Admin and Technical by default) reach this module; it checks again so no
// caller can leak pay. Rows are linked to staff by full name (A4).

const mayRead = (actor: Actor) => {
  if (!can(actor, "staff.pay.read")) throw forbidden();
};
const mayWrite = (actor: Actor) => {
  if (!can(actor, "staff.pay.write")) throw forbidden();
};
const nameIs = (column: typeof staffPay.staffFullName | typeof staffPayExceptions.staffFullName, name: string) =>
  sql`lower(${column}) = ${name.trim().toLowerCase()}`;

const toPay = (row: typeof staffPay.$inferSelect): StaffPay => ({
  staffFullName: row.staffFullName,
  payType: row.payType,
  rateCents: row.rateCents,
  rateUnit: row.rateUnit,
  secondRateCents: row.secondRateCents,
  secondRateLabel: row.secondRateLabel,
});

const emptyPay = (staffFullName: string): StaffPay => ({
  staffFullName,
  payType: null,
  rateCents: null,
  rateUnit: null,
  secondRateCents: null,
  secondRateLabel: "",
});

async function exceptionsFor(db: DbLike, where: SQL | undefined = isNull(staffPayExceptions.archivedAt)): Promise<PayException[]> {
  const rows = await db
    .select({ row: staffPayExceptions, eventTitle: events.title })
    .from(staffPayExceptions)
    .leftJoin(events, eq(events.id, staffPayExceptions.eventId))
    .where(where)
    .orderBy(asc(staffPayExceptions.staffFullName), asc(staffPayExceptions.createdAt));
  return rows.map(({ row, eventTitle }) => ({
    id: row.id,
    staffFullName: row.staffFullName,
    eventId: row.eventId,
    eventTitle: eventTitle ?? null,
    project: row.project,
    amountCents: row.amountCents,
    note: row.note,
  }));
}

// Every listed staff member with their pay and the hours time tracking recorded
// between two New York dates, inclusive, plus pay rows whose name matches no one
// (so a typo or an old name is visible, not lost) and every pay exception.
export async function getPayroll(db: DbLike, actor: Actor, range: { from: string; to: string }): Promise<Payroll> {
  mayRead(actor);
  const staff = await db
    .select()
    .from(users)
    .where(and(isNull(users.archivedAt), ne(users.status, "revoked")))
    .orderBy(asc(users.name), asc(users.email));
  const pay = await db.select().from(staffPay).where(isNull(staffPay.archivedAt));
  const payByName = new Map(pay.map((row) => [row.staffFullName.toLowerCase(), row]));
  const worked = staff.length
    ? await db
        .select({
          userId: activitySessions.userId,
          seconds: sql<number>`coalesce(sum(extract(epoch from (${activitySessions.endedAt} - ${activitySessions.startedAt}))), 0)::int`,
        })
        .from(activitySessions)
        .where(
          and(
            isNull(activitySessions.archivedAt),
            inArray(activitySessions.userId, staff.map((row) => row.id)),
            gte(activitySessions.startedAt, businessTimeToUtc(range.from, "00:00")),
            lt(activitySessions.startedAt, businessTimeToUtc(addLocalDays(range.to, 1), "00:00")),
          ),
        )
        .groupBy(activitySessions.userId)
    : [];
  const secondsBy = new Map(worked.map((row) => [row.userId, Number(row.seconds)]));
  const named = new Set<string>();
  const rows: Payroll["rows"] = staff.map((member) => {
    const name = staffFullName(member);
    named.add(name.toLowerCase());
    const row = payByName.get(name.toLowerCase());
    return {
      ...(row ? toPay(row) : emptyPay(name)),
      staffFullName: name,
      staffId: member.id,
      status: member.status,
      hasAccount: member.hasAccount,
      workedSeconds: secondsBy.get(member.id) ?? 0,
    };
  });
  for (const row of pay)
    if (!named.has(row.staffFullName.toLowerCase()))
      rows.push({ ...toPay(row), staffId: null, status: null, hasAccount: false, workedSeconds: 0 });
  return { from: range.from, to: range.to, rows, exceptions: await exceptionsFor(db) };
}

// Sets one person's normal pay (creating the row on first save). Audit-logged.
export async function saveStaffPay(db: Db, actor: Actor, input: StaffPayInput): Promise<StaffPay> {
  mayWrite(actor);
  const name = input.staffFullName.trim();
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(staffPay)
      .where(and(nameIs(staffPay.staffFullName, name), isNull(staffPay.archivedAt)))
      .for("update");
    const values = {
      payType: input.payType,
      rateCents: input.rateCents,
      rateUnit: input.payType ? rateUnits[input.payType] : null,
      secondRateCents: input.secondRateCents,
      secondRateLabel: input.secondRateLabel ?? "",
      updatedBy: actor.userId,
    };
    const [row] = existing
      ? await tx.update(staffPay).set(values).where(eq(staffPay.id, existing.id)).returning()
      : await tx.insert(staffPay).values({ ...values, staffFullName: name, createdBy: actor.userId }).returning();
    await writeAudit(tx, actor, {
      entityType: "staff_pay",
      entityId: row.id,
      action: existing ? "update" : "create",
      before: existing ? toPay(existing) : null,
      after: toPay(row),
    });
    return toPay(row);
  });
}

async function assertEvent(tx: DbLike, eventId: string | null | undefined) {
  if (!eventId) return;
  const [event] = await tx.select({ id: events.id }).from(events).where(and(eq(events.id, eventId), isNull(events.archivedAt)));
  if (!event) throw new ApiError(400, "INVALID_REQUEST", "Choose an event that still exists.");
}

const exceptionById = async (tx: DbLike, id: string) => {
  const [found] = await exceptionsFor(tx, and(eq(staffPayExceptions.id, id), isNull(staffPayExceptions.archivedAt)));
  if (!found) throw notFound("Pay exception");
  return found;
};

export async function createPayException(db: Db, actor: Actor, input: PayExceptionInput): Promise<PayException> {
  mayWrite(actor);
  return db.transaction(async (tx) => {
    await assertEvent(tx, input.eventId);
    const [row] = await tx
      .insert(staffPayExceptions)
      .values({
        staffFullName: input.staffFullName.trim(),
        eventId: input.eventId ?? null,
        project: input.eventId ? null : (input.project?.trim() ?? null),
        amountCents: input.amountCents,
        note: input.note ?? "",
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: staffPayExceptions.id });
    const after = await exceptionById(tx, row.id);
    await writeAudit(tx, actor, { entityType: "staff_pay_exception", entityId: row.id, action: "create", before: null, after });
    return after;
  });
}

export async function updatePayException(db: Db, actor: Actor, id: string, input: PayExceptionUpdate): Promise<PayException> {
  mayWrite(actor);
  return db.transaction(async (tx) => {
    const before = await exceptionById(tx, id);
    const eventId = input.eventId !== undefined ? input.eventId : before.eventId;
    const project = input.project !== undefined ? input.project?.trim() || null : before.project;
    // Switching to an event clears the project and the other way round.
    const target: { eventId: string | null; project: string | null } = input.eventId
      ? { eventId: input.eventId, project: null }
      : project && input.project !== undefined
        ? { eventId: null, project }
        : { eventId, project };
    if (Boolean(target.eventId) === Boolean(target.project))
      throw new ApiError(400, "INVALID_REQUEST", "Choose an event or name a project.");
    await assertEvent(tx, target.eventId);
    await tx
      .update(staffPayExceptions)
      .set({
        ...target,
        ...(input.amountCents !== undefined && { amountCents: input.amountCents }),
        ...(input.note !== undefined && { note: input.note }),
        updatedBy: actor.userId,
      })
      .where(eq(staffPayExceptions.id, id));
    const after = await exceptionById(tx, id);
    await writeAudit(tx, actor, { entityType: "staff_pay_exception", entityId: id, action: "update", before, after });
    return after;
  });
}

export async function archivePayException(db: Db, actor: Actor, id: string) {
  mayWrite(actor);
  return db.transaction(async (tx) => {
    const before = await exceptionById(tx, id);
    await tx
      .update(staffPayExceptions)
      .set({ archivedAt: new Date(), updatedBy: actor.userId })
      .where(eq(staffPayExceptions.id, id));
    await writeAudit(tx, actor, { entityType: "staff_pay_exception", entityId: id, action: "archive", before, after: before });
    return { archived: id };
  });
}
