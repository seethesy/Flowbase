import { and, eq, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { ReadinessCheck } from "../../shared/readiness";
import type { z } from "zod";
import type { readinessResponseSchema } from "../../shared/readiness";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { businessDefaultsSchema } from "../../shared/settings";
import type { Db, DbLike } from "../db/client";
import { eventShifts, eventStaffSlots, events, inventoryItems, kitchenMenuLines, kitchenMenus, pullListLines, pullLists, readinessResponses, recipes, settings, taskAssignees, tasks, truckAssignments, trucks } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { visibleEvents } from "./events";
import { eventProposalLines } from "./pull-list";
import { dataGaps } from "../readiness/data-gaps";
import { quantity } from "../readiness/quantity";
import { resource } from "../readiness/resource";
import { responsibility } from "../readiness/responsibility";
import { schedule } from "../readiness/schedule";
import type { ReadinessFacts } from "../readiness/types";

export async function getReadiness(db: DbLike, actor: Actor, eventId: string, now = new Date()): Promise<ReadinessCheck[]> {
  const [isLead] = await db.select({ id: events.id }).from(events)
    .where(and(eq(events.productionLeadId, actor.userId), isNull(events.archivedAt))).limit(1);
  const [event] = await db.select().from(events).where(and(eq(events.id, eventId), isNull(events.archivedAt),
    isLead || ["admin", "sales_manager", "technical"].includes(actor.role) ? undefined : visibleEvents(actor)));
  if (!event) throw notFound("Event");
  if (!isLead && !["admin", "sales_manager", "technical"].includes(actor.role)) return [];
  const [taskRows, pullRows, truckRows, slotRows, dishRows, proposalLines, responseRows, settingRows] = await Promise.all([
    db.select({ id: tasks.id, title: tasks.title, assigneeId: taskAssignees.userId }).from(tasks)
      .leftJoin(taskAssignees, and(eq(taskAssignees.taskId, tasks.id), isNull(taskAssignees.archivedAt)))
      .where(and(eq(tasks.eventId, eventId), eq(tasks.type, "production"), isNull(tasks.archivedAt))),
    db.select().from(pullLists).where(and(eq(pullLists.eventId, eventId), isNull(pullLists.archivedAt))),
    db.select({ assignment: truckAssignments, name: trucks.name }).from(truckAssignments)
      .innerJoin(trucks, eq(trucks.id, truckAssignments.truckId))
      .where(and(eq(truckAssignments.eventId, eventId), isNull(truckAssignments.archivedAt))),
    db.select({ id: eventStaffSlots.id, position: eventStaffSlots.position, assigneeId: eventStaffSlots.assigneeId })
      .from(eventStaffSlots).innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
      .where(and(eq(eventShifts.eventId, eventId), isNull(eventShifts.archivedAt), isNull(eventStaffSlots.archivedAt))),
    db.select({ id: kitchenMenuLines.id, name: recipes.name, yieldServings: recipes.yieldServings })
      .from(kitchenMenuLines).innerJoin(kitchenMenus, eq(kitchenMenus.id, kitchenMenuLines.menuId))
      .innerJoin(recipes, eq(recipes.id, kitchenMenuLines.recipeId))
      .where(and(eq(kitchenMenus.eventId, eventId), isNull(kitchenMenuLines.archivedAt), isNull(kitchenMenus.archivedAt))),
    eventProposalLines(db, eventId),
    db.select().from(readinessResponses).where(and(eq(readinessResponses.eventId, eventId), isNull(readinessResponses.archivedAt))),
    db.select({ value: settings.value }).from(settings).where(eq(settings.key, "defaults")),
  ]);
  const pull = pullRows[0];
  const pullLines = pull ? await db.select({ id: pullListLines.id, name: pullListLines.name, quantity: pullListLines.quantity,
    ratio: inventoryItems.ratioQuantity, basis: inventoryItems.ratioBasis })
    .from(pullListLines).leftJoin(inventoryItems, eq(inventoryItems.id, pullListLines.itemId))
    .where(and(eq(pullListLines.pullListId, pull.id), isNull(pullListLines.archivedAt))) : [];
  const taskMap = new Map<string, ReadinessFacts["tasks"][number]>();
  for (const row of taskRows) {
    if (!taskMap.has(row.id)) taskMap.set(row.id, { id: row.id, title: row.title, assigneeIds: [] });
    if (row.assigneeId) taskMap.get(row.id)!.assigneeIds.push(row.assigneeId);
  }
  const facts: ReadinessFacts = { eventTitle: event.title, guestCount: event.guestCount, tasks: [...taskMap.values()],
    pull: pull ? { id: pull.id, scheduledAt: pull.scheduledAt?.toISOString() ?? null,
      updatedAt: pull.updatedAt.toISOString(), lines: pullLines } : null,
    trucks: truckRows.map(({ assignment, name }) => ({ id: assignment.id, name, loaderIds: assignment.loaderIds, conflictMessage: assignment.conflictMessage })),
    slots: slotRows, dishes: dishRows, proposalLines: proposalLines ?? [] };
  const defaults = businessDefaultsSchema.parse(settingRows[0]?.value ?? {});
  const eventDate = utcToBusinessTime(event.startsAt).date;
  const today = utcToBusinessTime(now).date;
  const responseByKey = new Map(responseRows.map((row) => [row.checkKey, row]));
  return [responsibility, schedule, resource, quantity, dataGaps].flatMap((rule) => rule(facts))
    .filter((finding) => today >= addLocalDays(eventDate, -defaults.readinessStartDays[finding.kind]))
    .map((finding) => {
      const response = responseByKey.get(finding.key);
      const current = response?.signature === finding.signature ? response : null;
      return { ...finding, state: current?.state ?? "open", response: current?.response ?? null,
        respondedBy: current?.respondedBy ?? null, respondedAt: current?.respondedAt.toISOString() ?? null };
    });
}

export async function respondToReadiness(db: Db, actor: Actor, eventId: string, key: string,
  input: z.output<typeof readinessResponseSchema>, now = new Date()) {
  const [event] = await db.select({ productionLeadId: events.productionLeadId }).from(events)
    .where(and(eq(events.id, eventId), isNull(events.archivedAt)));
  if (!event) throw notFound("Event");
  if (!["admin", "sales_manager", "technical"].includes(actor.role) && event.productionLeadId !== actor.userId) throw forbidden();
  const checks = await getReadiness(db, actor, eventId, now);
  const check = checks.find((row) => row.key === key);
  if (!check) throw notFound("Readiness check");
  if (check.signature !== input.signature) throw new ApiError(409, "STALE", "This check changed. Reload and respond again.");
  await db.insert(readinessResponses).values({ eventId, checkKey: key, signature: input.signature,
    state: input.state, response: input.response, respondedBy: actor.userId, respondedAt: now,
    createdBy: actor.userId, updatedBy: actor.userId })
    .onConflictDoUpdate({ target: [readinessResponses.eventId, readinessResponses.checkKey],
      set: { signature: input.signature, state: input.state, response: input.response,
        respondedBy: actor.userId, respondedAt: now, updatedBy: actor.userId } });
  return getReadiness(db, actor, eventId, now);
}
