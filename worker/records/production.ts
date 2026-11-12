import { and, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { completion, type ProductionItem, type ProductionList, type ProductionOverview } from "../../shared/production";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import type { DbLike } from "../db/client";
import { consumableAllocations, eventShifts, eventStaffSlots, events, inventoryItems, kitchenMenus, kitchenMenuLines, orderLists, pullListLines, pullLists, reservationConflicts, taskAssignees, tasks, truckAssignments, trucks, vendorOrders } from "../db/schema";
import { forbidden, notFound } from "../hono";
import { visibleEvents } from "./events";
import { getReadiness } from "./readiness";

const manager = (actor: Actor) => actor.role === "admin" || actor.role === "sales_manager" || actor.role === "technical";
async function primaryLead(db: DbLike, actor: Actor) {
  const [row] = await db.select({ id: events.id }).from(events)
    .where(and(eq(events.productionLeadId, actor.userId), isNull(events.archivedAt))).limit(1);
  return Boolean(row);
}

export async function getProductionList(db: DbLike, actor: Actor, eventId: string, now = new Date()): Promise<ProductionList> {
  const all = manager(actor) || await primaryLead(db, actor);
  const [event] = await db.select().from(events).where(and(eq(events.id, eventId), isNull(events.archivedAt),
    all ? undefined : visibleEvents(actor)));
  if (!event) throw notFound("Event");
  const eventDate = utcToBusinessTime(event.startsAt).date;
  const due = event.startsAt.toISOString();
  const base = { eventId, eventTitle: event.title };
  const items: ProductionItem[] = [];
  const taskRows = await db.select({ task: tasks, assigneeId: taskAssignees.userId }).from(tasks)
    .leftJoin(taskAssignees, and(eq(taskAssignees.taskId, tasks.id), isNull(taskAssignees.archivedAt)))
    .where(and(eq(tasks.eventId, eventId), inArray(tasks.type, ["production", "kitchen", "truck_load"]), isNull(tasks.archivedAt)));
  const taskMap = new Map<string, { task: typeof tasks.$inferSelect; assignees: string[] }>();
  for (const row of taskRows) {
    if (!taskMap.has(row.task.id)) taskMap.set(row.task.id, { task: row.task, assignees: [] });
    if (row.assigneeId) taskMap.get(row.task.id)!.assignees.push(row.assigneeId);
  }
  for (const { task, assignees } of taskMap.values()) items.push({ ...base, id: `task:${task.id}:${task.updatedAt.toISOString()}`,
    type: task.type === "kitchen" ? "kitchen" : "task", title: task.title,
    due: (task.dueAt ?? event.startsAt).toISOString(), complete: task.status === "done",
    team: task.type === "kitchen" ? "Kitchen" : "Production", assignedUserIds: assignees });
  const [pull] = await db.select().from(pullLists).where(and(eq(pullLists.eventId, eventId), isNull(pullLists.archivedAt)));
  if (pull) {
    items.push({ ...base, id: `pull-schedule:${pull.id}:${pull.updatedAt.toISOString()}`, type: "pull", title: "Schedule inventory pull",
      due, complete: pull.scheduledAt !== null, team: "Production", assignedUserIds: pull.pullerId ? [pull.pullerId] : [] });
    const lines = await db.select().from(pullListLines).where(and(eq(pullListLines.pullListId, pull.id), isNull(pullListLines.archivedAt)));
    for (const line of lines) for (const [stage, complete] of [
      ["pulled", ["pulled", "loaded", "returned"].includes(line.status)],
      ["loaded", ["loaded", "returned"].includes(line.status)],
    ] as const) items.push({ ...base, id: `pull:${line.id}:${stage}:${line.updatedAt.toISOString()}`, type: "pull",
      title: `${line.name || "Inventory item"} ${stage}`, due: (pull.scheduledAt ?? event.startsAt).toISOString(),
      complete, team: "Production", assignedUserIds: pull.pullerId ? [pull.pullerId] : [] });
  }
  const [menu] = await db.select().from(kitchenMenus).where(and(eq(kitchenMenus.eventId, eventId), isNull(kitchenMenus.archivedAt)));
  if (menu) {
    const dishes = await db.select({ id: kitchenMenuLines.id, quantity: kitchenMenuLines.plannedQuantity })
      .from(kitchenMenuLines).where(and(eq(kitchenMenuLines.menuId, menu.id), isNull(kitchenMenuLines.archivedAt)));
    for (const dish of dishes) items.push({ ...base, id: `dish:${dish.id}`, type: "kitchen", title: "Set dish quantity",
      due, complete: dish.quantity !== null, team: "Kitchen", assignedUserIds: [] });
  }
  const slots = await db.select({ slot: eventStaffSlots, shift: eventShifts }).from(eventStaffSlots)
    .innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
    .where(and(eq(eventShifts.eventId, eventId), isNull(eventShifts.archivedAt), isNull(eventStaffSlots.archivedAt)));
  for (const { slot, shift } of slots) items.push({ ...base, id: `slot:${slot.id}:${slot.updatedAt.toISOString()}`, type: "staff",
    title: `${slot.position} staffed`, due: shift.startsAt.toISOString(), complete: slot.assigneeId !== null,
    team: slot.department, assignedUserIds: slot.assigneeId ? [slot.assigneeId] : [] });
  for (const shift of new Map(slots.map(({ shift }) => [shift.id, shift])).values())
    if (utcToBusinessTime(shift.startsAt).date !== eventDate)
      items.push({ ...base, id: `setup:${shift.id}`, type: "setup", title: "Setup shift",
        due: shift.startsAt.toISOString(), complete: slots.filter(({ slot }) => slot.shiftId === shift.id).every(({ slot }) => slot.assigneeId !== null),
        team: "Production", assignedUserIds: slots.filter(({ slot }) => slot.shiftId === shift.id).map(({ slot }) => slot.assigneeId).filter((id): id is string => Boolean(id)) });
  const assignments = await db.select({ assignment: truckAssignments, name: trucks.name }).from(truckAssignments)
    .innerJoin(trucks, eq(trucks.id, truckAssignments.truckId))
    .where(and(eq(truckAssignments.eventId, eventId), isNull(truckAssignments.archivedAt)));
  for (const { assignment, name } of assignments) items.push({ ...base, id: `truck:${assignment.id}:${assignment.updatedAt.toISOString()}`,
    type: "truck", title: `${name}: driver and loaders`, due: assignment.departsAt.toISOString(),
    complete: Boolean(assignment.driverId && assignment.loaderIds.length), team: "Production",
    assignedUserIds: [assignment.driverId, ...assignment.loaderIds].filter((id): id is string => Boolean(id)) });
  const conflicts = await db.select({ id: reservationConflicts.id, state: reservationConflicts.state, updatedAt: reservationConflicts.updatedAt })
    .from(reservationConflicts).where(and(eq(reservationConflicts.eventId, eventId), isNull(reservationConflicts.archivedAt)));
  for (const conflict of conflicts) items.push({ ...base, id: `shortage:${conflict.id}:${conflict.updatedAt.toISOString()}`, type: "shortage",
    title: "Resolve inventory shortage or conflict", due, complete: conflict.state === "resolved",
    team: "Production", assignedUserIds: [] });
  const shortages = await db.select({ allocation: consumableAllocations, itemName: inventoryItems.name })
    .from(consumableAllocations).innerJoin(inventoryItems, eq(inventoryItems.id, consumableAllocations.itemId))
    .where(eq(consumableAllocations.eventId, eventId));
  for (const { allocation, itemName } of shortages.filter(({ allocation }) => allocation.shortage > 0))
    items.push({ ...base, id: `ordering:${allocation.id}:${allocation.updatedAt.toISOString()}`, type: "shortage",
      title: `Order ${allocation.shortage} ${itemName}`, due: allocation.orderBy ? businessTimeToUtc(allocation.orderBy, "09:00").toISOString() : due,
      complete: false, team: "Purchasing", assignedUserIds: [] });
  const lists = await db.select().from(orderLists).where(and(isNull(orderLists.archivedAt),
    lte(orderLists.fromDate, eventDate), gte(orderLists.toDate, eventDate)));
  const relevant = lists.filter((list) => list.lines.some((line) => line.eventIds.includes(eventId)));
  if (relevant.length) {
    const orders = await db.select().from(vendorOrders).where(and(inArray(vendorOrders.orderListId, relevant.map((list) => list.id)), isNull(vendorOrders.archivedAt)));
    for (const list of relevant) for (const line of list.lines.filter((line) => line.eventIds.includes(eventId))) {
      const order = orders.find((candidate) => candidate.orderListId === list.id && candidate.lines.some((entry) => entry.itemId === line.itemId));
      items.push({ ...base, id: `order:${list.id}:${line.itemId}`, type: "order", title: `Order ${line.itemName}`,
        due: line.orderBy ? businessTimeToUtc(line.orderBy, "09:00").toISOString() : due,
        complete: Boolean(order), team: "Purchasing", assignedUserIds: [] });
      if (order) items.push({ ...base, id: `receive:${order.id}:${line.itemId}`, type: "order",
        title: `Receive ${line.itemName}`, due: businessTimeToUtc(order.expectedDelivery, "09:00").toISOString(),
        complete: (order.lines.find((entry) => entry.itemId === line.itemId)?.received ?? 0) >= (order.lines.find((entry) => entry.itemId === line.itemId)?.ordered ?? Infinity),
        team: "Purchasing", assignedUserIds: [] });
    }
  }
  for (const check of await getReadiness(db, actor, eventId, now))
    if (check.state === "open") items.push({ ...base, id: `readiness:${check.key}`, type: "readiness",
      title: check.question, due, complete: false, team: "Production", assignedUserIds: [] });
  const visible = all ? items : items.filter((item) => item.assignedUserIds.includes(actor.userId));
  return { eventId, eventTitle: event.title, eventDate, items: visible.sort((a, b) => a.due.localeCompare(b.due)), ...completion(visible) };
}

export async function getProductionOverview(db: DbLike, actor: Actor, days: 7 | 14, now = new Date()): Promise<ProductionOverview> {
  if (!manager(actor) && !await primaryLead(db, actor)) throw forbidden();
  const first = utcToBusinessTime(now).date;
  const end = addLocalDays(first, days);
  const startAt = businessTimeToUtc(first, "00:00");
  const endAt = businessTimeToUtc(end, "00:00");
  const [eventRows, taskRows, pullRows, truckWindows, shiftRows, shortageRows, orderRows] = await Promise.all([
    db.select({ id: events.id }).from(events).where(and(isNull(events.archivedAt), gte(events.startsAt, startAt), lt(events.startsAt, endAt))),
    db.select({ id: tasks.eventId }).from(tasks).where(and(gte(tasks.dueAt, startAt), lt(tasks.dueAt, endAt), isNull(tasks.archivedAt))),
    db.select({ id: pullLists.eventId }).from(pullLists).where(and(gte(pullLists.scheduledAt, startAt), lt(pullLists.scheduledAt, endAt), isNull(pullLists.archivedAt))),
    db.select({ id: truckAssignments.eventId, truckId: truckAssignments.truckId, departsAt: truckAssignments.departsAt, returnsAt: truckAssignments.returnsAt })
      .from(truckAssignments).where(and(lt(truckAssignments.departsAt, endAt), gte(truckAssignments.returnsAt, startAt), isNull(truckAssignments.archivedAt))),
    db.select({ id: eventShifts.eventId, assigneeId: eventStaffSlots.assigneeId, startsAt: eventShifts.startsAt, endsAt: eventShifts.endsAt })
      .from(eventShifts).leftJoin(eventStaffSlots, and(eq(eventStaffSlots.shiftId, eventShifts.id), isNull(eventStaffSlots.archivedAt)))
      .where(and(lt(eventShifts.startsAt, endAt), gte(eventShifts.endsAt, startAt), isNull(eventShifts.archivedAt))),
    db.select({ id: consumableAllocations.eventId }).from(consumableAllocations)
      .where(and(gte(consumableAllocations.orderBy, first), lt(consumableAllocations.orderBy, end), isNull(consumableAllocations.archivedAt))),
    db.select({ lines: orderLists.lines }).from(orderLists)
      .where(and(lte(orderLists.fromDate, end), gte(orderLists.toDate, first), isNull(orderLists.archivedAt))),
  ]);
  const orderEventIds = orderRows.flatMap((list) => list.lines.filter((line) => line.orderBy && line.orderBy >= first && line.orderBy < end)
    .flatMap((line) => line.eventIds));
  const candidateIds = [...new Set([...eventRows, ...taskRows, ...pullRows, ...truckWindows, ...shiftRows, ...shortageRows]
    .map((row) => row.id).filter((id): id is string => Boolean(id)).concat(orderEventIds))];
  const activeEvents = candidateIds.length ? await db.select({ id: events.id }).from(events)
    .where(and(inArray(events.id, candidateIds), isNull(events.archivedAt))) : [];
  const lists = await Promise.all(activeEvents.map(({ id }) => getProductionList(db, actor, id, now)));
  const truckRows = await db.select({ id: trucks.id }).from(trucks).where(isNull(trucks.archivedAt));
  const capacity = truckRows.length;
  const buckets = Array.from({ length: days }, (_, i) => ({ date: addLocalDays(first, i), items: [] as ProductionItem[], trucksAssigned: 0,
    truckCapacity: capacity, overcommitted: false, truckConflict: false, staffOvercommitted: false }));
  for (const list of lists) for (const item of list.items) {
    const day = utcToBusinessTime(new Date(item.due)).date;
    const bucket = buckets.find((entry) => entry.date === day);
    if (bucket) bucket.items.push(item);
  }
  for (const day of buckets) {
    const dayStart = businessTimeToUtc(day.date, "00:00");
    const dayEnd = businessTimeToUtc(addLocalDays(day.date, 1), "00:00");
    const dayTrucks = truckWindows.filter((row) => row.departsAt < dayEnd && row.returnsAt > dayStart);
    day.trucksAssigned = new Set(dayTrucks.map((row) => row.truckId)).size;
    day.overcommitted = capacity > 0 && day.trucksAssigned >= capacity;
    day.truckConflict = dayTrucks.some((a, index) => dayTrucks.slice(index + 1).some((b) =>
      a.truckId === b.truckId && a.departsAt < b.returnsAt && b.departsAt < a.returnsAt));
    const byPerson = new Map<string, typeof shiftRows>();
    for (const shift of shiftRows.filter((row) => row.assigneeId && row.startsAt < dayEnd && row.endsAt > dayStart))
      byPerson.set(shift.assigneeId!, [...(byPerson.get(shift.assigneeId!) ?? []), shift]);
    day.staffOvercommitted = [...byPerson.values()].some((rows) => rows.some((a, index) => rows.slice(index + 1).some((b) => a.startsAt < b.endsAt && b.startsAt < a.endsAt)));
    day.items.sort((a, b) => a.due.localeCompare(b.due) || a.eventTitle.localeCompare(b.eventTitle));
  }
  return { days: buckets };
}
