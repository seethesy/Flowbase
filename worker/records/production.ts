import { and, eq, gte, inArray, isNull, lt, lte } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { mayViewAllProduction } from "../../shared/policy";
import { completion, type ProductionItem, type ProductionList, type ProductionOverview, type ProductionWindow } from "../../shared/production";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import type { DbLike } from "../db/client";
import { consumableAllocations, eventShifts, eventStaffSlots, events, allInventoryItems, kitchenMenus, kitchenMenuLines, orderLists, pullListLines, pullLists, reservationConflicts, taskAssignees, tasks, truckAssignments, trucks, vendorOrders } from "../db/schema";
import { forbidden, notFound } from "../hono";
import { visibleEvents } from "./events";
import { getReadiness, getReadinessForEvents } from "./readiness";

async function primaryLead(db: DbLike, actor: Actor) {
  const [row] = await db.select({ id: events.id }).from(events)
    .where(and(eq(events.productionLeadId, actor.userId), isNull(events.archivedAt))).limit(1);
  return Boolean(row);
}

export async function getProductionList(db: DbLike, actor: Actor, eventId: string, now = new Date()): Promise<ProductionList> {
  const list = (await getProductionLists(db, actor, [eventId], now)).get(eventId);
  if (!list) throw notFound("Event");
  return list;
}

const byKey = <T, K>(rows: T[], key: (row: T) => K) => {
  const map = new Map<K, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
};

// Production lists for many events with set-based queries keyed by event id
// (FLOW-307): a fixed number of queries per call instead of about ten per event.
// Events the actor can't see, or that are archived or missing, are left out.
export async function getProductionLists(db: DbLike, actor: Actor, eventIds: string[], now = new Date()): Promise<Map<string, ProductionList>> {
  const result = new Map<string, ProductionList>();
  const wanted = [...new Set(eventIds)];
  if (!wanted.length) return result;
  const all = mayViewAllProduction(actor) || await primaryLead(db, actor);
  const eventRows = await db.select().from(events).where(and(inArray(events.id, wanted), isNull(events.archivedAt),
    all ? undefined : visibleEvents(actor)));
  if (!eventRows.length) return result;
  const ids = eventRows.map((event) => event.id);
  const eventDates = eventRows.map((event) => utcToBusinessTime(event.startsAt).date).sort();
  const [taskRows, pullRows, menuRows, slotRows, assignmentRows, conflictRows, shortageRows, listRows, readiness] = await Promise.all([
    db.select({ task: tasks, assigneeId: taskAssignees.userId }).from(tasks)
      .leftJoin(taskAssignees, and(eq(taskAssignees.taskId, tasks.id), isNull(taskAssignees.archivedAt)))
      .where(and(inArray(tasks.eventId, ids), inArray(tasks.type, ["production", "kitchen", "truck_load"]), isNull(tasks.archivedAt))),
    db.select().from(pullLists).where(and(inArray(pullLists.eventId, ids), isNull(pullLists.archivedAt))),
    db.select().from(kitchenMenus).where(and(inArray(kitchenMenus.eventId, ids), isNull(kitchenMenus.archivedAt))),
    db.select({ slot: eventStaffSlots, shift: eventShifts }).from(eventStaffSlots)
      .innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
      .where(and(inArray(eventShifts.eventId, ids), isNull(eventShifts.archivedAt), isNull(eventStaffSlots.archivedAt))),
    db.select({ assignment: truckAssignments, name: trucks.name }).from(truckAssignments)
      .innerJoin(trucks, eq(trucks.id, truckAssignments.truckId))
      .where(and(inArray(truckAssignments.eventId, ids), isNull(truckAssignments.archivedAt))),
    db.select({ id: reservationConflicts.id, eventId: reservationConflicts.eventId, state: reservationConflicts.state, updatedAt: reservationConflicts.updatedAt })
      .from(reservationConflicts).where(and(inArray(reservationConflicts.eventId, ids), isNull(reservationConflicts.archivedAt))),
    db.select({ allocation: consumableAllocations, itemName: allInventoryItems.name })
      .from(consumableAllocations).innerJoin(allInventoryItems, eq(allInventoryItems.id, consumableAllocations.itemId))
      .where(inArray(consumableAllocations.eventId, ids)),
    db.select().from(orderLists).where(and(isNull(orderLists.archivedAt),
      lte(orderLists.fromDate, eventDates[eventDates.length - 1]), gte(orderLists.toDate, eventDates[0]))),
    getReadinessForEvents(db, actor, ids, now),
  ]);
  // One pull list and one kitchen menu per event, as before: the first found.
  const pullByEvent = new Map<string, typeof pullRows[number]>();
  for (const row of pullRows) if (!pullByEvent.has(row.eventId)) pullByEvent.set(row.eventId, row);
  const menuByEvent = new Map<string, typeof menuRows[number]>();
  for (const row of menuRows) if (!menuByEvent.has(row.eventId)) menuByEvent.set(row.eventId, row);
  const pullIds = [...pullByEvent.values()].map((pull) => pull.id);
  const menuIds = [...menuByEvent.values()].map((menu) => menu.id);
  const relevantLists = listRows.filter((list) => list.lines.some((line) => line.eventIds.some((id) => ids.includes(id))));
  const [lineRows, dishRows, orderRows] = await Promise.all([
    pullIds.length ? db.select().from(pullListLines).where(and(inArray(pullListLines.pullListId, pullIds), isNull(pullListLines.archivedAt))) : [],
    menuIds.length ? db.select({ id: kitchenMenuLines.id, menuId: kitchenMenuLines.menuId, quantity: kitchenMenuLines.plannedQuantity })
      .from(kitchenMenuLines).where(and(inArray(kitchenMenuLines.menuId, menuIds), isNull(kitchenMenuLines.archivedAt))) : [],
    relevantLists.length ? db.select().from(vendorOrders).where(and(inArray(vendorOrders.orderListId, relevantLists.map((list) => list.id)), isNull(vendorOrders.archivedAt))) : [],
  ]);
  const tasksByEvent = byKey(taskRows, (row) => row.task.eventId);
  const linesByPull = byKey(lineRows, (row) => row.pullListId);
  const dishesByMenu = byKey(dishRows, (row) => row.menuId);
  const slotsByEvent = byKey(slotRows, (row) => row.shift.eventId);
  const trucksByEvent = byKey(assignmentRows, (row) => row.assignment.eventId);
  const conflictsByEvent = byKey(conflictRows, (row) => row.eventId);
  const shortagesByEvent = byKey(shortageRows, (row) => row.allocation.eventId);
  for (const event of eventRows) {
    const eventId = event.id;
    const eventDate = utcToBusinessTime(event.startsAt).date;
    const due = event.startsAt.toISOString();
    const base = { eventId, eventTitle: event.title, eventDate };
    const items: ProductionItem[] = [];
    const taskMap = new Map<string, { task: typeof tasks.$inferSelect; assignees: string[] }>();
    for (const row of tasksByEvent.get(eventId) ?? []) {
      if (!taskMap.has(row.task.id)) taskMap.set(row.task.id, { task: row.task, assignees: [] });
      if (row.assigneeId) taskMap.get(row.task.id)!.assignees.push(row.assigneeId);
    }
    for (const { task, assignees } of taskMap.values()) items.push({ ...base, id: `task:${task.id}:${task.updatedAt.toISOString()}`,
      type: task.type === "kitchen" ? "kitchen" : "task", title: task.title,
      due: (task.dueAt ?? event.startsAt).toISOString(), complete: task.status === "done",
      team: task.type === "kitchen" ? "Kitchen" : "Production", assignedUserIds: assignees });
    const pull = pullByEvent.get(eventId);
    if (pull) {
      items.push({ ...base, id: `pull-schedule:${pull.id}:${pull.updatedAt.toISOString()}`, type: "pull", title: "Schedule inventory pull",
        due, complete: pull.scheduledAt !== null, team: "Production", assignedUserIds: pull.pullerId ? [pull.pullerId] : [] });
      for (const line of linesByPull.get(pull.id) ?? []) for (const [stage, complete] of [
        ["pulled", ["pulled", "loaded", "returned"].includes(line.status)],
        ["loaded", ["loaded", "returned"].includes(line.status)],
      ] as const) items.push({ ...base, id: `pull:${line.id}:${stage}:${line.updatedAt.toISOString()}`, type: "pull",
        title: `${line.name || "Inventory item"} ${stage}`, due: (pull.scheduledAt ?? event.startsAt).toISOString(),
        complete, team: "Production", assignedUserIds: pull.pullerId ? [pull.pullerId] : [] });
    }
    const menu = menuByEvent.get(eventId);
    if (menu) for (const dish of dishesByMenu.get(menu.id) ?? []) items.push({ ...base, id: `dish:${dish.id}`, type: "kitchen", title: "Set dish quantity",
      due, complete: dish.quantity !== null, team: "Kitchen", assignedUserIds: [] });
    const slots = slotsByEvent.get(eventId) ?? [];
    for (const { slot, shift } of slots) items.push({ ...base, id: `slot:${slot.id}:${slot.updatedAt.toISOString()}`, type: "staff",
      title: `${slot.position} staffed`, due: shift.startsAt.toISOString(), complete: slot.assigneeId !== null,
      team: slot.department, assignedUserIds: slot.assigneeId ? [slot.assigneeId] : [] });
    for (const shift of new Map(slots.map(({ shift }) => [shift.id, shift])).values())
      if (utcToBusinessTime(shift.startsAt).date !== eventDate)
        items.push({ ...base, id: `setup:${shift.id}`, type: "setup", title: "Setup shift",
          due: shift.startsAt.toISOString(), complete: slots.filter(({ slot }) => slot.shiftId === shift.id).every(({ slot }) => slot.assigneeId !== null),
          team: "Production", assignedUserIds: slots.filter(({ slot }) => slot.shiftId === shift.id).map(({ slot }) => slot.assigneeId).filter((id): id is string => Boolean(id)) });
    for (const { assignment, name } of trucksByEvent.get(eventId) ?? []) items.push({ ...base, id: `truck:${assignment.id}:${assignment.updatedAt.toISOString()}`,
      type: "truck", title: `${name}: driver and loaders`, due: assignment.departsAt.toISOString(),
      complete: Boolean(assignment.driverId && assignment.loaderIds.length), team: "Production",
      assignedUserIds: [assignment.driverId, ...assignment.loaderIds].filter((id): id is string => Boolean(id)) });
    for (const conflict of conflictsByEvent.get(eventId) ?? []) items.push({ ...base, id: `shortage:${conflict.id}:${conflict.updatedAt.toISOString()}`, type: "shortage",
      title: "Resolve inventory shortage or conflict", due, complete: conflict.state === "resolved",
      team: "Production", assignedUserIds: [] });
    for (const { allocation, itemName } of (shortagesByEvent.get(eventId) ?? []).filter(({ allocation }) => allocation.shortage > 0))
      items.push({ ...base, id: `ordering:${allocation.id}:${allocation.updatedAt.toISOString()}`, type: "shortage",
        title: `Order ${allocation.shortage} ${itemName}`, due: allocation.orderBy ? businessTimeToUtc(allocation.orderBy, "09:00").toISOString() : due,
        complete: false, team: "Purchasing", assignedUserIds: [] });
    const relevant = relevantLists.filter((list) => list.fromDate <= eventDate && list.toDate >= eventDate
      && list.lines.some((line) => line.eventIds.includes(eventId)));
    for (const list of relevant) for (const line of list.lines.filter((line) => line.eventIds.includes(eventId))) {
      const order = orderRows.find((candidate) => candidate.orderListId === list.id && candidate.lines.some((entry) => entry.itemId === line.itemId));
      items.push({ ...base, id: `order:${list.id}:${line.itemId}`, type: "order", title: `Order ${line.itemName}`,
        due: line.orderBy ? businessTimeToUtc(line.orderBy, "09:00").toISOString() : due,
        complete: Boolean(order), team: "Purchasing", assignedUserIds: [] });
      if (order) items.push({ ...base, id: `receive:${order.id}:${line.itemId}`, type: "order",
        title: `Receive ${line.itemName}`, due: businessTimeToUtc(order.expectedDelivery, "09:00").toISOString(),
        complete: (order.lines.find((entry) => entry.itemId === line.itemId)?.received ?? 0) >= (order.lines.find((entry) => entry.itemId === line.itemId)?.ordered ?? Infinity),
        team: "Purchasing", assignedUserIds: [] });
    }
    for (const check of readiness.get(eventId) ?? [])
      if (check.state === "open") items.push({ ...base, id: `readiness:${check.key}`, type: "readiness",
        title: check.question, due, complete: false, team: "Production", assignedUserIds: [] });
    const visible = all ? items : items.filter((item) => item.assignedUserIds.includes(actor.userId));
    result.set(eventId, { eventId, eventTitle: event.title, eventDate, items: visible.sort((a, b) => a.due.localeCompare(b.due)), ...completion(visible) });
  }
  return result;
}

export async function getProductionOverview(db: DbLike, actor: Actor, days: ProductionWindow, now = new Date()): Promise<ProductionOverview> {
  if (!mayViewAllProduction(actor) && !await primaryLead(db, actor)) throw forbidden();
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
  // Readiness questions show in the overview's panel, not among the day's work.
  const readiness: ProductionOverview["readiness"] = [];
  for (const list of lists) {
    const keys = new Set(list.items.filter((entry) => entry.type === "readiness").map((entry) => entry.id.slice("readiness:".length)));
    if (!keys.size) continue;
    for (const check of await getReadiness(db, actor, list.eventId, now))
      if (keys.has(check.key)) readiness.push({ ...check, eventId: list.eventId, eventTitle: list.eventTitle });
  }
  for (const list of lists) for (const item of list.items) {
    if (item.type === "readiness") continue;
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
  return { days: buckets, readiness };
}
