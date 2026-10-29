import { and, asc, eq, gt, inArray, isNull, lt, max, ne } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import {
  overlaps,
  slotNumbers,
  staffingBreakdown,
  type EventRoster,
  type ShiftConflict,
  type SlotUpdate,
  type shiftInputSchema,
  type slotInputSchema,
} from "../../shared/event-staff";
import { utcToBusinessTime } from "../../shared/time";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { events, eventShifts, eventStaffSlots, users } from "../db/schema";
import { ApiError, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { can } from "../policy";
import { findVisibleEvent, instants, visibleEvents } from "./events";
import { assertListLabels } from "./settings";

// The event's staff roster (FLOW-140). Anyone who can open the event reads it;
// events.write adds shifts and slots and assigns staff. Assigning someone to a slot
// whose shift overlaps another of their shifts is allowed, and the roster warns
// about it on both slots (AC1). Each assignment emits event.staff_assigned, which
// is how the assignee is notified (FLOW-43).

type ShiftRow = typeof eventShifts.$inferSelect;
type SlotRow = typeof eventStaffSlots.$inferSelect;
type ShiftInput = z.output<typeof shiftInputSchema>;
type SlotInput = z.output<typeof slotInputSchema>;

// Slots on shifts of events that still happen (not archived, not lost).
const liveSlot = and(
  isNull(eventStaffSlots.archivedAt),
  isNull(eventShifts.archivedAt),
  isNull(events.archivedAt),
  ne(events.status, "lost"),
);

// For each assigned slot, the person's other slots whose shifts overlap it.
async function findConflicts(
  db: DbLike,
  actor: Actor,
  shifts: ShiftRow[],
  slots: SlotRow[],
): Promise<Map<string, ShiftConflict[]>> {
  const assigned = slots.filter((slot) => slot.assigneeId);
  const result = new Map<string, ShiftConflict[]>();
  if (!assigned.length) return result;
  const shiftById = new Map(shifts.map((shift) => [shift.id, shift]));
  const from = new Date(Math.min(...shifts.map((s) => s.startsAt.getTime())));
  const to = new Date(Math.max(...shifts.map((s) => s.endsAt.getTime())));
  const others = await db
    .select({
      slotId: eventStaffSlots.id,
      assigneeId: eventStaffSlots.assigneeId,
      eventId: events.id,
      eventTitle: events.title,
      shiftKind: eventShifts.kind,
      startsAt: eventShifts.startsAt,
      endsAt: eventShifts.endsAt,
    })
    .from(eventStaffSlots)
    .innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
    .innerJoin(events, eq(events.id, eventShifts.eventId))
    .where(
      and(
        liveSlot,
        inArray(eventStaffSlots.assigneeId, [
          ...new Set(assigned.map((slot) => slot.assigneeId!)),
        ]),
        lt(eventShifts.startsAt, to),
        gt(eventShifts.endsAt, from),
      ),
    );
  // Titles only of events the viewer can open.
  const eventIds = [...new Set(others.map((row) => row.eventId))];
  const visible = new Set(
    eventIds.length
      ? (
          await db
            .select({ id: events.id })
            .from(events)
            .where(and(inArray(events.id, eventIds), visibleEvents(actor)))
        ).map((row) => row.id)
      : [],
  );
  for (const slot of assigned) {
    const shift = shiftById.get(slot.shiftId)!;
    const conflicts = others
      .filter(
        (row) =>
          row.slotId !== slot.id &&
          row.assigneeId === slot.assigneeId &&
          overlaps(row, shift),
      )
      .map((row) => ({
        eventId: row.eventId,
        eventTitle: visible.has(row.eventId) ? row.eventTitle : null,
        shiftKind: row.shiftKind,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
      }));
    if (conflicts.length) result.set(slot.id, conflicts);
  }
  return result;
}

async function rosterOf(
  db: DbLike,
  actor: Actor,
  eventId: string,
): Promise<EventRoster> {
  const [event] = await db.select().from(events).where(eq(events.id, eventId));
  const shifts = await db
    .select()
    .from(eventShifts)
    .where(and(eq(eventShifts.eventId, eventId), isNull(eventShifts.archivedAt)))
    .orderBy(asc(eventShifts.startsAt), asc(eventShifts.createdAt));
  const slots = shifts.length
    ? await db
        .select()
        .from(eventStaffSlots)
        .where(
          and(
            inArray(
              eventStaffSlots.shiftId,
              shifts.map((shift) => shift.id),
            ),
            isNull(eventStaffSlots.archivedAt),
          ),
        )
        .orderBy(asc(eventStaffSlots.sortOrder), asc(eventStaffSlots.createdAt))
    : [];
  const personIds = [
    ...new Set([
      ...slots.flatMap((slot) => (slot.assigneeId ? [slot.assigneeId] : [])),
      ...(event.productionLeadId ? [event.productionLeadId] : []),
      ...event.assistantLeadIds,
    ]),
  ];
  const people = personIds.length
    ? await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, personIds))
    : [];
  const names = new Map(
    people.map((person) => [person.id, person.name || person.email]),
  );
  // A lead from before FLOW-140 may not be a user; the id stands in for the name.
  const person = (id: string) => ({ id, name: names.get(id) ?? id });
  const conflicts = await findConflicts(db, actor, shifts, slots);
  return {
    eventId,
    productionLead: event.productionLeadId
      ? person(event.productionLeadId)
      : null,
    assistantLeads: event.assistantLeadIds.map(person),
    shifts: shifts.map((shift) => {
      const mine = slots.filter((slot) => slot.shiftId === shift.id);
      const numbers = slotNumbers(mine);
      const start = utcToBusinessTime(shift.startsAt);
      return {
        id: shift.id,
        kind: shift.kind,
        date: start.date,
        startTime: start.time,
        endTime: utcToBusinessTime(shift.endsAt).time,
        startsAt: shift.startsAt.toISOString(),
        endsAt: shift.endsAt.toISOString(),
        activities: shift.activities,
        slots: mine.map((slot) => ({
          id: slot.id,
          shiftId: slot.shiftId,
          position: slot.position,
          number: numbers.get(slot.id) ?? null,
          department: slot.department,
          assignee: slot.assigneeId ? person(slot.assigneeId) : null,
          conflicts: conflicts.get(slot.id) ?? [],
        })),
      };
    }),
    breakdown: staffingBreakdown(slots),
    openSlots: slots.filter((slot) => !slot.assigneeId).length,
    canEdit: can(actor, "events.write"),
    canNameLeads: can(actor, "events.production_leads"),
  };
}

export async function getRoster(db: Db, actor: Actor, eventId: string) {
  await findVisibleEvent(db, actor, eventId);
  return rosterOf(db, actor, eventId);
}

function shiftValues(input: ShiftInput) {
  if (input.endTime === input.startTime)
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      "A shift must end after it starts.",
    );
  const { startsAt, endsAt } = instants(input);
  return {
    kind: input.kind,
    startsAt,
    endsAt: endsAt!,
    activities: input.activities,
  };
}

const shiftSnapshot = (row: ShiftRow) => ({
  eventId: row.eventId,
  kind: row.kind,
  startsAt: row.startsAt.toISOString(),
  endsAt: row.endsAt.toISOString(),
  activities: row.activities,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});
const slotSnapshot = (row: SlotRow) => ({
  shiftId: row.shiftId,
  position: row.position,
  department: row.department,
  assigneeId: row.assigneeId,
  archivedAt: row.archivedAt?.toISOString() ?? null,
});

async function findShift(tx: DbLike, eventId: string, shiftId: string) {
  const [row] = await tx
    .select()
    .from(eventShifts)
    .where(
      and(
        eq(eventShifts.id, shiftId),
        eq(eventShifts.eventId, eventId),
        isNull(eventShifts.archivedAt),
      ),
    );
  if (!row) throw notFound("Shift");
  return row;
}

async function findSlot(tx: DbLike, eventId: string, slotId: string) {
  const [row] = await tx
    .select({ slot: eventStaffSlots })
    .from(eventStaffSlots)
    .innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
    .where(
      and(
        eq(eventStaffSlots.id, slotId),
        eq(eventShifts.eventId, eventId),
        isNull(eventStaffSlots.archivedAt),
        isNull(eventShifts.archivedAt),
      ),
    )
    .for("update", { of: eventStaffSlots });
  if (!row) throw notFound("Staffing slot");
  return row.slot;
}

export async function createShift(
  db: Db,
  actor: Actor,
  eventId: string,
  input: ShiftInput,
) {
  await findVisibleEvent(db, actor, eventId);
  const values = shiftValues(input);
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(eventShifts)
      .values({
        ...values,
        eventId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning();
    await writeAudit(tx, actor, {
      entityType: "event_shift",
      entityId: row.id,
      action: "create",
      before: null,
      after: shiftSnapshot(row),
    });
  });
  return rosterOf(db, actor, eventId);
}

export async function updateShift(
  db: Db,
  actor: Actor,
  eventId: string,
  shiftId: string,
  input: ShiftInput,
) {
  await findVisibleEvent(db, actor, eventId);
  const values = shiftValues(input);
  await db.transaction(async (tx) => {
    const before = await findShift(tx, eventId, shiftId);
    const [after] = await tx
      .update(eventShifts)
      .set({ ...values, updatedBy: actor.userId })
      .where(eq(eventShifts.id, shiftId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "event_shift",
      entityId: shiftId,
      action: "update",
      before: shiftSnapshot(before),
      after: shiftSnapshot(after),
    });
  });
  return rosterOf(db, actor, eventId);
}

// Removes the shift and its slots from the roster.
export async function archiveShift(
  db: Db,
  actor: Actor,
  eventId: string,
  shiftId: string,
  notifyRemovedStaff = false,
) {
  await findVisibleEvent(db, actor, eventId);
  if (notifyRemovedStaff && !can(actor, "events.production_leads"))
    throw new ApiError(403, "FORBIDDEN", "Only an Admin or Sales Manager can notify removed staff.");
  await db.transaction(async (tx) => {
    const before = await findShift(tx, eventId, shiftId);
    const assigned = notifyRemovedStaff
      ? await tx.select().from(eventStaffSlots).where(and(
          eq(eventStaffSlots.shiftId, shiftId), isNull(eventStaffSlots.archivedAt),
        ))
      : [];
    const archivedAt = new Date();
    const [after] = await tx
      .update(eventShifts)
      .set({ archivedAt, updatedBy: actor.userId })
      .where(eq(eventShifts.id, shiftId))
      .returning();
    await tx
      .update(eventStaffSlots)
      .set({ archivedAt, updatedBy: actor.userId })
      .where(
        and(
          eq(eventStaffSlots.shiftId, shiftId),
          isNull(eventStaffSlots.archivedAt),
        ),
      );
    await writeAudit(tx, actor, {
      entityType: "event_shift",
      entityId: shiftId,
      action: "archive",
      before: shiftSnapshot(before),
      after: shiftSnapshot(after),
    });
    for (const slot of assigned)
      if (slot.assigneeId)
        await emitDomainEvent(tx, {
          name: "event.staff_unassigned",
          entityId: eventId,
          data: { slotId: slot.id, shiftId, position: slot.position,
            userId: null, previousUserId: slot.assigneeId, notifyRemovedStaff: true },
        });
  });
  return rosterOf(db, actor, eventId);
}

// Adds open slots of one position to a shift. Positions come from the
// staff_position list in business settings (FLOW-45), so roles are configurable.
export async function addSlots(
  db: Db,
  actor: Actor,
  eventId: string,
  input: SlotInput,
) {
  await findVisibleEvent(db, actor, eventId);
  await db.transaction(async (tx) => {
    await findShift(tx, eventId, input.shiftId);
    await assertListLabels(tx, "staff_position", [input.position]);
    const [{ last }] = await tx
      .select({ last: max(eventStaffSlots.sortOrder) })
      .from(eventStaffSlots)
      .where(eq(eventStaffSlots.shiftId, input.shiftId));
    const rows = await tx
      .insert(eventStaffSlots)
      .values(
        Array.from({ length: input.count }, (_, i) => ({
          shiftId: input.shiftId,
          position: input.position,
          department: input.department,
          sortOrder: (last ?? -1) + 1 + i,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        })),
      )
      .returning();
    for (const row of rows)
      await writeAudit(tx, actor, {
        entityType: "event_staff_slot",
        entityId: row.id,
        action: "create",
        before: null,
        after: slotSnapshot(row),
      });
  });
  return rosterOf(db, actor, eventId);
}

// Changes a slot's position or department, or assigns it (null opens it again).
export async function updateSlot(
  db: Db,
  actor: Actor,
  eventId: string,
  slotId: string,
  input: SlotUpdate,
) {
  await findVisibleEvent(db, actor, eventId);
  if (input.notifyRemovedStaff && !can(actor, "events.production_leads"))
    throw new ApiError(403, "FORBIDDEN", "Only an Admin or Sales Manager can notify removed staff.");
  await db.transaction(async (tx) => {
    const before = await findSlot(tx, eventId, slotId);
    if (input.position)
      await assertListLabels(tx, "staff_position", [input.position], [
        before.position,
      ]);
    if (input.assigneeId && input.assigneeId !== before.assigneeId) {
      const [assignee] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.id, input.assigneeId),
            eq(users.status, "active"),
            isNull(users.archivedAt),
          ),
        );
      if (!assignee)
        throw new ApiError(
          400,
          "INVALID_REQUEST",
          "Choose an active staff member.",
        );
    }
    const { notifyRemovedStaff, ...changes } = input;
    const [after] = await tx
      .update(eventStaffSlots)
      .set({ ...changes, updatedBy: actor.userId })
      .where(eq(eventStaffSlots.id, slotId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "event_staff_slot",
      entityId: slotId,
      action: "update",
      before: slotSnapshot(before),
      after: slotSnapshot(after),
    });
    if (after.assigneeId !== before.assigneeId) {
      const data = {
        slotId,
        shiftId: after.shiftId,
        position: after.position,
        userId: after.assigneeId,
        previousUserId: before.assigneeId,
        notifyRemovedStaff: notifyRemovedStaff === true,
      };
      if (after.assigneeId)
        await emitDomainEvent(tx, {
          name: "event.staff_assigned",
          entityId: eventId,
          data,
        });
      if (before.assigneeId && notifyRemovedStaff)
        await emitDomainEvent(tx, {
          name: "event.staff_unassigned",
          entityId: eventId,
          data,
        });
    }
  });
  return rosterOf(db, actor, eventId);
}

export async function archiveSlot(
  db: Db,
  actor: Actor,
  eventId: string,
  slotId: string,
  notifyRemovedStaff = false,
) {
  await findVisibleEvent(db, actor, eventId);
  if (notifyRemovedStaff && !can(actor, "events.production_leads"))
    throw new ApiError(403, "FORBIDDEN", "Only an Admin or Sales Manager can notify removed staff.");
  await db.transaction(async (tx) => {
    const before = await findSlot(tx, eventId, slotId);
    const [after] = await tx
      .update(eventStaffSlots)
      .set({ archivedAt: new Date(), updatedBy: actor.userId })
      .where(eq(eventStaffSlots.id, slotId))
      .returning();
    await writeAudit(tx, actor, {
      entityType: "event_staff_slot",
      entityId: slotId,
      action: "archive",
      before: slotSnapshot(before),
      after: slotSnapshot(after),
    });
    if (before.assigneeId && notifyRemovedStaff)
      await emitDomainEvent(tx, {
        name: "event.staff_unassigned",
        entityId: eventId,
        data: {
          slotId,
          shiftId: before.shiftId,
          position: before.position,
          userId: null,
          previousUserId: before.assigneeId,
          notifyRemovedStaff: true,
        },
      });
  });
  return rosterOf(db, actor, eventId);
}
