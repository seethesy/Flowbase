import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { calendarEventStatuses } from "../../shared/calendar";
import {
  KITCHEN_OVERVIEW_DAYS,
  kitchenRoles,
  type KitchenInChargeInput,
  type KitchenOverview,
  type KitchenOverviewRow,
} from "../../shared/kitchen-overview";
import { mayEditKitchenMenu } from "../../shared/policy";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import { writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { events, kitchenMenuLines, kitchenMenus, recipes, users } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { visibleEvents } from "./events";

// Kitchen › Overview (FLOW-293): one row per kitchen menu line of every event the
// viewer may open that starts today through the next 14 days (New York time) at
// Negotiation or later, never Lost. Sorted by date, food ready time, event.

// Active staff whose role is a kitchen role or who hold a Kitchen position.
const kitchenStaff = and(
  eq(users.status, "active"),
  or(
    inArray(users.role, [...kitchenRoles]),
    sql`exists (select 1 from jsonb_array_elements_text(${users.positions}) as held(name) where held.name ilike '%kitchen%')`,
  ),
);

export async function getKitchenOverview(db: DbLike, actor: Actor, now = new Date()): Promise<KitchenOverview> {
  const today = utcToBusinessTime(now).date;
  const from = businessTimeToUtc(today, "00:00");
  const until = businessTimeToUtc(addLocalDays(today, KITCHEN_OVERVIEW_DAYS + 1), "00:00");
  const found = await db
    .select({
      lineId: kitchenMenuLines.id,
      course: kitchenMenuLines.course,
      plannedQuantity: kitchenMenuLines.plannedQuantity,
      notes: kitchenMenuLines.notes,
      inChargeStaffId: kitchenMenuLines.inChargeStaffId,
      createdAt: kitchenMenuLines.createdAt,
      menuItem: recipes.name,
      allergens: recipes.allergens,
      leavesKitchenAt: kitchenMenus.leavesKitchenAt,
      eventId: events.id,
      eventTitle: events.title,
      startsAt: events.startsAt,
      guestCount: events.guestCount,
    })
    .from(kitchenMenuLines)
    .innerJoin(kitchenMenus, eq(kitchenMenus.id, kitchenMenuLines.menuId))
    .innerJoin(events, eq(events.id, kitchenMenus.eventId))
    .innerJoin(recipes, eq(recipes.id, kitchenMenuLines.recipeId))
    .where(
      and(
        isNull(kitchenMenuLines.archivedAt),
        isNull(kitchenMenus.archivedAt),
        isNull(events.archivedAt),
        inArray(events.status, [...calendarEventStatuses]),
        gte(events.startsAt, from),
        lt(events.startsAt, until),
        visibleEvents(actor),
      ),
    )
    .orderBy(asc(events.startsAt), asc(kitchenMenuLines.course), asc(kitchenMenuLines.createdAt), asc(kitchenMenuLines.id));

  const rows: KitchenOverviewRow[] = found.map((row) => {
    const ready = utcToBusinessTime(row.leavesKitchenAt ?? row.startsAt);
    return {
      lineId: row.lineId,
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      date: utcToBusinessTime(row.startsAt).date,
      foodReadyTime: ready.time,
      guestCount: row.guestCount,
      menuItem: row.menuItem,
      course: row.course,
      servingSize: row.plannedQuantity,
      specialRequests: row.notes,
      allergies: row.allergens,
      inChargeStaffId: row.inChargeStaffId,
    };
  });
  // Date, then food ready time, then event; a stable order within an event.
  rows.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      a.foodReadyTime.localeCompare(b.foodReadyTime) ||
      a.eventTitle.localeCompare(b.eventTitle) ||
      a.eventId.localeCompare(b.eventId),
  );

  const assigned = [...new Set(rows.flatMap((row) => (row.inChargeStaffId ? [row.inChargeStaffId] : [])))];
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(assigned.length ? or(kitchenStaff, inArray(users.id, assigned)) : kitchenStaff);
  const staff = people
    .map((person) => ({ id: person.id, name: person.name || person.email }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { rows, staff, canEdit: mayEditKitchenMenu(actor) };
}

// Sets who in the kitchen is in charge of a menu line; anyone who may edit the
// kitchen menu can (FLOW-293). Only kitchen staff can be chosen.
export async function setKitchenInCharge(db: Db, actor: Actor, lineId: string, input: KitchenInChargeInput) {
  if (!mayEditKitchenMenu(actor)) throw forbidden();
  return db.transaction(async (tx) => {
    const [line] = await tx
      .select({ line: kitchenMenuLines, name: recipes.name })
      .from(kitchenMenuLines)
      .innerJoin(kitchenMenus, eq(kitchenMenus.id, kitchenMenuLines.menuId))
      .innerJoin(events, eq(events.id, kitchenMenus.eventId))
      .innerJoin(recipes, eq(recipes.id, kitchenMenuLines.recipeId))
      .where(and(eq(kitchenMenuLines.id, lineId), isNull(kitchenMenuLines.archivedAt), visibleEvents(actor)))
      .for("update", { of: kitchenMenuLines });
    if (!line) throw notFound("Menu line");
    if (input.staffId) {
      const [person] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, input.staffId), kitchenStaff));
      if (!person) throw new ApiError(400, "INVALID_REQUEST", "Choose someone on the kitchen staff.");
    }
    await tx
      .update(kitchenMenuLines)
      .set({ inChargeStaffId: input.staffId, updatedBy: actor.userId })
      .where(eq(kitchenMenuLines.id, lineId));
    await writeAudit(tx, actor, {
      entityType: "kitchen_menu_line",
      entityId: lineId,
      action: "update",
      before: { name: line.name, inChargeStaffId: line.line.inChargeStaffId },
      after: { name: line.name, inChargeStaffId: input.staffId },
    });
    return { lineId, inChargeStaffId: input.staffId };
  });
}
