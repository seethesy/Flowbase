import { and, eq, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { DbLike } from "../db/client";
import { eventPlanning, eventPlanningOutputs, events, eventShifts, eventStaffSlots } from "../db/schema";
import { emitDomainEvent } from "../jobs/queue";
import { planningOutputSnapshot } from "./planning-output-snapshot";

export async function markPlanningStale(tx: DbLike, actor: Actor, eventId: string, cause: string) {
  const [planning] = await tx.select({ id: eventPlanning.id }).from(eventPlanning).where(eq(eventPlanning.eventId, eventId));
  if (!planning) return;
  const [event] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!event) return;
  const now = new Date();
  for (const kind of ["pull_list", "requirements", "order_list", "kitchen_menu", "beo", "truck_log"] as const)
    await tx.insert(eventPlanningOutputs).values({ eventId, kind, cause, staleAt: now,
      before: kind === "pull_list" || kind === "kitchen_menu" ? {} : await planningOutputSnapshot(tx, eventId, kind),
      createdBy: actor.userId, updatedBy: actor.userId })
      .onConflictDoUpdate({ target: [eventPlanningOutputs.eventId, eventPlanningOutputs.kind],
        set: { cause, staleAt: now, archivedAt: null, updatedBy: actor.userId } });
  await tx.update(events).set({ planningStaleAt: now, updatedBy: actor.userId }).where(eq(events.id, eventId));
  const kitchen = await tx.select({ id: eventStaffSlots.assigneeId }).from(eventStaffSlots)
    .innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
    .where(and(eq(eventShifts.eventId, eventId), eq(eventStaffSlots.department, "kitchen"),
      isNull(eventStaffSlots.archivedAt), isNull(eventShifts.archivedAt)));
  const recipientIds = [...new Set([event.productionLeadId, event.assignedSalespersonId,
    ...kitchen.map((person) => person.id)].filter((id): id is string => Boolean(id)))];
  await emitDomainEvent(tx, { name: "event.details_changed", entityId: eventId,
    data: { recipientIds, title: `Planning needs regeneration: ${event.title}`,
      body: `${cause}. Review the changes and regenerate the planning outputs.`, link: `/events/${eventId}` } });
}

export async function clearPlanningStale(tx: DbLike, eventId: string, kind: typeof eventPlanningOutputs.$inferSelect.kind) {
  await tx.update(eventPlanningOutputs).set({ archivedAt: new Date() }).where(and(eq(eventPlanningOutputs.eventId, eventId), eq(eventPlanningOutputs.kind, kind)));
  const [left] = await tx.select({ id: eventPlanningOutputs.id }).from(eventPlanningOutputs).where(and(eq(eventPlanningOutputs.eventId, eventId), isNull(eventPlanningOutputs.archivedAt)));
  if (!left) await tx.update(events).set({ planningStaleAt: null }).where(eq(events.id, eventId));
}
