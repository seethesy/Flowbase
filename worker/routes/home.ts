import { Hono } from "hono";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { requireActor, type ResolveActor } from "../auth";
import { forbidden, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { eventShifts, eventStaffSlots, events, orderLists, kitchenMenus } from "../db/schema";
import { visibleEvents } from "../records/events";

export function homeRoutes(options: { withDb?: RunWithDb; resolveActor?: ResolveActor }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  routes.get("/my-shifts", async (c) => c.json(await record(c, async (db, actor) => {
    const [row] = await db.select({ count: sql<number>`count(distinct ${eventShifts.id})::int` })
      .from(eventStaffSlots).innerJoin(eventShifts, eq(eventShifts.id, eventStaffSlots.shiftId))
      .innerJoin(events, eq(events.id, eventShifts.eventId))
      .where(and(eq(eventStaffSlots.assigneeId, actor.userId), isNull(eventStaffSlots.archivedAt),
        isNull(eventShifts.archivedAt), isNull(events.archivedAt), gte(eventShifts.endsAt, new Date())));
    return { count: row?.count ?? 0 };
  })));
  routes.get("/kitchen", async (c) => c.json(await record(c, async (db, actor) => {
    if (actor.role !== "kitchen_lead" && actor.role !== "kitchen_staff") throw forbidden();
    const [menus, orders] = await Promise.all([
      db.select({ count: sql<number>`count(*)::int` }).from(kitchenMenus)
        .innerJoin(events, eq(events.id, kitchenMenus.eventId))
        .where(and(isNull(kitchenMenus.archivedAt), isNull(events.archivedAt),
          visibleEvents(actor), gte(events.startsAt, new Date()))),
      db.select({ count: sql<number>`count(*)::int` }).from(orderLists)
        .where(and(isNull(orderLists.archivedAt), sql`${orderLists.status} not in ('received', 'cancelled')`)),
    ]);
    return { menus: menus[0]?.count ?? 0, openOrderLists: orders[0]?.count ?? 0 };
  })));
  routes.get("/kitchen-orders", async (c) => c.json(await record(c, (db, actor) => {
    if (actor.role !== "kitchen_lead" && actor.role !== "kitchen_staff") throw forbidden();
    return db.select({ id: orderLists.id, fromDate: orderLists.fromDate, toDate: orderLists.toDate, status: orderLists.status })
      .from(orderLists).where(isNull(orderLists.archivedAt)).orderBy(desc(orderLists.createdAt)).limit(100);
  })));
  return routes;
}
