import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Actor } from "../../../shared/access";
import { mayRespondToReadiness, mayViewAllProduction } from "../../../shared/policy";
import type { ReadinessCheck } from "../../../shared/readiness";
import type { z } from "zod";
import type { readinessResponseSchema } from "../../../shared/readiness";
import { addLocalDays, utcToBusinessTime } from "../../../shared/time";
import { businessDefaultsSchema } from "../../../shared/settings";
import type { Db, DbLike } from "../../db/client";
import { eventShifts, eventStaffSlots, events, allInventoryItems, kitchenMenuLines, kitchenMenus, pullListLines, pullLists, readinessResponses, recipes, settings, taskAssignees, tasks, truckAssignments, trucks } from "../../db/schema";
import { ApiError, forbidden, notFound } from "../../hono";
import { visibleEvents } from "./events";
import { eventsProposalLines } from "./pull-list";
import { dataGaps } from "../../readiness/data-gaps";
import { quantity } from "../../readiness/quantity";
import { resource } from "../../readiness/resource";
import { responsibility } from "../../readiness/responsibility";
import { schedule } from "../../readiness/schedule";
import type { ReadinessFacts } from "../../readiness/types";

export async function getReadiness(db: DbLike, actor: Actor, eventId: string, now = new Date()): Promise<ReadinessCheck[]> {
  const checks = (await getReadinessForEvents(db, actor, [eventId], now)).get(eventId);
  if (!checks) throw notFound("Event");
  return checks;
}

// Readiness for many events with one set of queries (FLOW-307). Events the actor
// can't see, or that are archived or missing, are left out.
export async function getReadinessForEvents(db: DbLike, actor: Actor, eventIds: string[], now = new Date()): Promise<Map<string, ReadinessCheck[]>> {
  const result = new Map<string, ReadinessCheck[]>();
  const wanted = [...new Set(eventIds)];
  if (!wanted.length) return result;
  const [isLead] = await db.select({ id: events.id }).from(events)
    .where(and(eq(events.productionLeadId, actor.userId), isNull(events.archivedAt))).limit(1);
  const eventRows = await db.select().from(events).where(and(inArray(events.id, wanted), isNull(events.archivedAt),
    isLead || mayViewAllProduction(actor) ? undefined : visibleEvents(actor)));
  if (!isLead && !mayViewAllProduction(actor)) {
    for (const event of eventRows) result.set(event.id, []);
    return result;
  }
  if (!eventRows.length) return result;
  const ids = eventRows.map((event) => event.id);
  const [taskRows, pullRows, truckRows, slotRows, dishRows, proposalLines, responseRows, settingRows] = await Promise.all([
    db.select({ id: tasks.id, eventId: tasks.eventId, title: tasks.title, assigneeId: taskAssignees.userId }).from(tasks)
      .leftJoin(taskAssignees, and(eq(taskAssignees.taskId, tasks.id), isNull(taskAssignees.archivedAt)))
      .where(and(inArray(tasks.eventId, ids), eq(tasks.type, "production"), isNull(tasks.archivedAt))),
    db.select().from(pullLists).where(and(inArray(pullLists.eventId, ids), isNull(pullLists.archivedAt))),
    db.select({ assignment: truckAssignments, name: trucks.name }).from(truckAssignments)
      .innerJoin(trucks, eq(trucks.id, truckAssignments.truckId))
      .where(and(inArray(truckAssignments.eventId, ids), isNull(truckAssignments.archivedAt))),
    db.select({ id: eventStaffSlots.id, eventId: eventShifts.eventId, position: eventStaffSlots.position, assigneeId: eventStaffSlots.assigneeId })
      .from(eventStaffSlots).innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
      .where(and(inArray(eventShifts.eventId, ids), isNull(eventShifts.archivedAt), isNull(eventStaffSlots.archivedAt))),
    db.select({ id: kitchenMenuLines.id, eventId: kitchenMenus.eventId, name: recipes.name, yieldServings: recipes.yieldServings })
      .from(kitchenMenuLines).innerJoin(kitchenMenus, eq(kitchenMenus.id, kitchenMenuLines.menuId))
      .innerJoin(recipes, eq(recipes.id, kitchenMenuLines.recipeId))
      .where(and(inArray(kitchenMenus.eventId, ids), isNull(kitchenMenuLines.archivedAt), isNull(kitchenMenus.archivedAt))),
    eventsProposalLines(db, ids),
    db.select().from(readinessResponses).where(and(inArray(readinessResponses.eventId, ids), isNull(readinessResponses.archivedAt))),
    db.select({ value: settings.value }).from(settings).where(eq(settings.key, "defaults")),
  ]);
  const pullByEvent = new Map<string, typeof pullRows[number]>();
  for (const row of pullRows) if (!pullByEvent.has(row.eventId)) pullByEvent.set(row.eventId, row);
  const pullIds = [...pullByEvent.values()].map((pull) => pull.id);
  const pullLineRows = pullIds.length ? await db.select({ id: pullListLines.id, pullListId: pullListLines.pullListId,
    name: pullListLines.name, quantity: pullListLines.quantity,
    ratio: allInventoryItems.ratioQuantity, basis: allInventoryItems.ratioBasis })
    .from(pullListLines).leftJoin(allInventoryItems, eq(allInventoryItems.id, pullListLines.itemId))
    .where(and(inArray(pullListLines.pullListId, pullIds), isNull(pullListLines.archivedAt))) : [];
  const defaults = businessDefaultsSchema.parse(settingRows[0]?.value ?? {});
  const today = utcToBusinessTime(now).date;
  for (const event of eventRows) {
    const eventId = event.id;
    const pull = pullByEvent.get(eventId);
    const pullLines = pull ? pullLineRows.filter((line) => line.pullListId === pull.id)
      .map((line) => ({ id: line.id, name: line.name, quantity: line.quantity, ratio: line.ratio, basis: line.basis })) : [];
    const taskMap = new Map<string, ReadinessFacts["tasks"][number]>();
    for (const row of taskRows.filter((task) => task.eventId === eventId)) {
      if (!taskMap.has(row.id)) taskMap.set(row.id, { id: row.id, title: row.title, assigneeIds: [] });
      if (row.assigneeId) taskMap.get(row.id)!.assigneeIds.push(row.assigneeId);
    }
    const facts: ReadinessFacts = { eventTitle: event.title, guestCount: event.guestCount, tasks: [...taskMap.values()],
      pull: pull ? { id: pull.id, scheduledAt: pull.scheduledAt?.toISOString() ?? null,
        updatedAt: pull.updatedAt.toISOString(), lines: pullLines } : null,
      trucks: truckRows.filter(({ assignment }) => assignment.eventId === eventId)
        .map(({ assignment, name }) => ({ id: assignment.id, name, loaderIds: assignment.loaderIds, conflictMessage: assignment.conflictMessage })),
      slots: slotRows.filter((slot) => slot.eventId === eventId)
        .map((slot) => ({ id: slot.id, position: slot.position, assigneeId: slot.assigneeId })),
      dishes: dishRows.filter((dish) => dish.eventId === eventId)
        .map((dish) => ({ id: dish.id, name: dish.name, yieldServings: dish.yieldServings })),
      proposalLines: proposalLines.get(eventId) ?? [] };
    const eventDate = utcToBusinessTime(event.startsAt).date;
    const responseByKey = new Map(responseRows.filter((row) => row.eventId === eventId).map((row) => [row.checkKey, row]));
    result.set(eventId, [responsibility, schedule, resource, quantity, dataGaps].flatMap((rule) => rule(facts))
      .filter((finding) => today >= addLocalDays(eventDate, -defaults.readinessStartDays[finding.kind]))
      .map((finding) => {
        const response = responseByKey.get(finding.key);
        const current = response?.signature === finding.signature ? response : null;
        return { ...finding, state: current?.state ?? "open", response: current?.response ?? null,
          respondedBy: current?.respondedBy ?? null, respondedAt: current?.respondedAt.toISOString() ?? null };
      }));
  }
  return result;
}

export async function respondToReadiness(db: Db, actor: Actor, eventId: string, key: string,
  input: z.output<typeof readinessResponseSchema>, now = new Date()) {
  const [event] = await db.select({ productionLeadId: events.productionLeadId }).from(events)
    .where(and(eq(events.id, eventId), isNull(events.archivedAt)));
  if (!event) throw notFound("Event");
  if (!mayRespondToReadiness(actor, event.productionLeadId)) throw forbidden();
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
