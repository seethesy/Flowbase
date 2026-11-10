import { and, eq, isNull, lt, gt, ne } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { can } from "../../shared/policy";
import { busyWindowsOverlap, truckConflictMessage, type TruckAssignmentInput } from "../../shared/trucks";
import { utcToBusinessTime } from "../../shared/time";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { events, pullListLines, pullLists, truckAssignments, trucks, users } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { findVisibleEvent } from "./events";
import { archiveTask, createTask } from "./tasks";

const mayEdit = (actor: Actor) => can(actor, "events.write");
const assertEdit = (actor: Actor) => { if (!mayEdit(actor)) throw forbidden(); };
const clock = (date: Date) => {
  const [hour, minute] = utcToBusinessTime(date).time.split(":").map(Number);
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")}${hour < 12 ? "am" : "pm"}`;
};

export async function getTruckLog(db: DbLike, actor: Actor, eventId: string) {
  await findVisibleEvent(db, actor, eventId);
  const [fleet, rows] = await Promise.all([
    db.select().from(trucks).where(isNull(trucks.archivedAt)),
    db.select({ assignment: truckAssignments, truck: trucks, event: events, driver: users })
      .from(truckAssignments).innerJoin(trucks, eq(trucks.id, truckAssignments.truckId))
      .innerJoin(events, eq(events.id, truckAssignments.eventId))
      .leftJoin(users, eq(users.id, truckAssignments.driverId))
      .where(and(eq(truckAssignments.eventId, eventId), isNull(truckAssignments.archivedAt))),
  ]);
  return {
    trucks: fleet.map((truck) => ({ id: truck.id, name: truck.name, status: truck.status })),
    assignments: rows.map(({ assignment, truck, event, driver }) => ({
      id: assignment.id, truckId: truck.id, truckName: truck.name, eventId,
      eventTitle: event.title, departsAt: assignment.departsAt.toISOString(),
      returnsAt: assignment.returnsAt.toISOString(), driverId: assignment.driverId,
      driverName: driver?.name ?? null, loaderIds: assignment.loaderIds,
      conflictAcknowledgedAt: assignment.conflictAcknowledgedAt?.toISOString() ?? null,
      conflictMessage: assignment.conflictMessage,
    })),
    missingDriverWarning: rows.some(({ assignment }) => !assignment.driverId)
      ? "Who is loading the truck going to the event?" : null,
    canEdit: mayEdit(actor),
  };
}

export async function createTruck(db: DbLike, actor: Actor, eventId: string, name: string) {
  assertEdit(actor);
  await findVisibleEvent(db, actor, eventId);
  const [row] = await db.insert(trucks).values({ name, createdBy: actor.userId, updatedBy: actor.userId }).returning();
  await writeAudit(db, actor, { entityType: "truck", entityId: row.id, action: "create", before: null, after: { name, status: row.status } });
  return { id: row.id, name: row.name, status: row.status };
}

export async function setTruckStatus(db: DbLike, actor: Actor, eventId: string, truckId: string, status: typeof trucks.$inferSelect.status) {
  assertEdit(actor);
  await findVisibleEvent(db, actor, eventId);
  const [row] = await db.select().from(trucks).where(and(eq(trucks.id, truckId), isNull(trucks.archivedAt)));
  if (!row) throw notFound("Truck");
  await db.update(trucks).set({ status, updatedBy: actor.userId }).where(eq(trucks.id, truckId));
  await writeAudit(db, actor, { entityType: "truck", entityId: truckId, action: "update", before: { status: row.status }, after: { status } });
}

export async function assignTruck(db: Db, actor: Actor, eventId: string, input: TruckAssignmentInput) {
  assertEdit(actor);
  await db.transaction(async (tx) => {
    const event = await findVisibleEvent(tx, actor, eventId);
    const [truck] = await tx.select().from(trucks).where(and(eq(trucks.id, input.truckId), isNull(trucks.archivedAt))).for("update");
    if (!truck) throw notFound("Truck");
    const [already] = await tx.select({ id: truckAssignments.id }).from(truckAssignments)
      .where(and(eq(truckAssignments.truckId, truck.id), eq(truckAssignments.eventId, eventId), isNull(truckAssignments.archivedAt)));
    if (already) throw new ApiError(409, "ALREADY_ASSIGNED", `${truck.name} is already assigned to this event.`);
    const departsAt = new Date(input.departsAt), returnsAt = new Date(input.returnsAt);
    const [conflict] = await tx.select({ assignment: truckAssignments, event: events })
      .from(truckAssignments).innerJoin(events, eq(events.id, truckAssignments.eventId))
      .where(and(eq(truckAssignments.truckId, truck.id), ne(truckAssignments.eventId, eventId),
        isNull(truckAssignments.archivedAt), lt(truckAssignments.departsAt, returnsAt), gt(truckAssignments.returnsAt, departsAt)))
      .limit(1);
    const message = conflict && busyWindowsOverlap({ departsAt, returnsAt }, conflict.assignment)
      ? truckConflictMessage(truck.name, event.title, clock(departsAt), conflict.event.title) : null;
    if (message && !input.acknowledgeConflict) throw new ApiError(409, "TRUCK_CONFLICT", message);
    const [pull] = await tx.select({ scheduledAt: pullLists.scheduledAt }).from(pullLists).where(eq(pullLists.eventId, eventId));
    const taskId = await createTask(tx, actor, {
      title: `Load ${truck.name} for ${event.title}`,
      description: `Driver and loaders for ${truck.name}.`, type: "truck_load", status: "todo", priority: "normal",
      dueAt: (pull?.scheduledAt ?? departsAt).toISOString(),
      assigneeIds: [...new Set([input.driverId, ...input.loaderIds].filter((id): id is string => Boolean(id)))],
      overseerId: event.productionLeadId, eventId, clientId: null, inventoryItemId: null,
      beoId: null, sopId: null, position: null, checklist: [],
    });
    const [assignment] = await tx.insert(truckAssignments).values({
      truckId: truck.id, eventId, departsAt, returnsAt, driverId: input.driverId,
      loaderIds: input.loaderIds, loadTaskId: taskId,
      conflictAcknowledgedAt: message ? new Date() : null, conflictMessage: message,
      createdBy: actor.userId, updatedBy: actor.userId,
    }).returning();
    await writeAudit(tx, actor, { entityType: "truck_assignment", entityId: assignment.id, action: "create", before: null,
      after: { truckId: truck.id, eventId, departsAt: input.departsAt, returnsAt: input.returnsAt,
        driverId: input.driverId, loaderIds: input.loaderIds, conflictAcknowledged: Boolean(message), conflictMessage: message } });
  });
  return getTruckLog(db, actor, eventId);
}

export async function removeTruckAssignment(db: Db, actor: Actor, eventId: string, assignmentId: string) {
  assertEdit(actor);
  await db.transaction(async (tx) => {
    await findVisibleEvent(tx, actor, eventId);
    const [assignment] = await tx.select().from(truckAssignments).where(and(eq(truckAssignments.id, assignmentId), eq(truckAssignments.eventId, eventId), isNull(truckAssignments.archivedAt))).for("update");
    if (!assignment) throw notFound("Truck assignment");
    await tx.update(truckAssignments).set({ archivedAt: new Date(), updatedBy: actor.userId }).where(eq(truckAssignments.id, assignmentId));
    const [pull] = await tx.select({ id: pullLists.id }).from(pullLists).where(eq(pullLists.eventId, eventId));
    if (pull) await tx.update(pullListLines).set({ truckId: null, updatedBy: actor.userId })
      .where(and(eq(pullListLines.truckId, assignment.truckId), eq(pullListLines.pullListId, pull.id)));
    if (assignment.loadTaskId) await archiveTask(tx, null, assignment.loadTaskId);
    await writeAudit(tx, actor, { entityType: "truck_assignment", entityId: assignment.id, action: "archive",
      before: { truckId: assignment.truckId, eventId }, after: { archivedAt: new Date().toISOString() } });
  });
  return getTruckLog(db, actor, eventId);
}

export async function movePullLineToTruck(db: Db, actor: Actor, eventId: string, lineId: string, truckId: string | null) {
  assertEdit(actor);
  await db.transaction(async (tx) => {
    await findVisibleEvent(tx, actor, eventId);
    const [line] = await tx.select({ line: pullListLines }).from(pullListLines)
      .innerJoin(pullLists, eq(pullLists.id, pullListLines.pullListId))
      .where(and(eq(pullLists.eventId, eventId), eq(pullListLines.id, lineId), isNull(pullListLines.archivedAt))).for("update");
    if (!line) throw notFound("Pull-list line");
    if (truckId) {
      const [assignment] = await tx.select({ id: truckAssignments.id }).from(truckAssignments)
        .where(and(eq(truckAssignments.eventId, eventId), eq(truckAssignments.truckId, truckId), isNull(truckAssignments.archivedAt)));
      if (!assignment) throw new ApiError(400, "INVALID_TRUCK", "Assign this truck to the event first.");
    }
    if (line.line.truckId === truckId) return;
    await tx.update(pullListLines).set({ truckId, updatedBy: actor.userId }).where(eq(pullListLines.id, lineId));
    await writeAudit(tx, actor, { entityType: "pull_list_line", entityId: lineId, action: "update",
      before: { truckId: line.line.truckId }, after: { truckId } });
  });
  return getTruckLog(db, actor, eventId);
}
