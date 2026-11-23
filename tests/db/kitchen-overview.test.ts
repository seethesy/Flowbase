import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, Role } from "../../shared/access";
import type { KitchenOverview } from "../../shared/kitchen-overview";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../shared/time";

// Kitchen › Overview (FLOW-293) through the real API and database: which menu
// items show, their order, and In charge.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "f2930000-0000-4000-8000-000000000001",
  lead: "f2930000-0000-4000-8000-000000000002",
  cook: "f2930000-0000-4000-8000-000000000003",
  chef: "f2930000-0000-4000-8000-000000000004",
  server: "f2930000-0000-4000-8000-000000000005",
  gone: "f2930000-0000-4000-8000-000000000006",
};
type Who = keyof typeof people;
const roles: Record<Who, Role> = {
  admin: "admin",
  lead: "kitchen_lead",
  cook: "kitchen_staff",
  chef: "staff",
  server: "staff",
  gone: "kitchen_staff",
};
const as = (who: Who) => {
  const actor: Actor = { userId: people[who], role: roles[who], employmentType: "full_time" };
  const app = createApp({ withDb, resolveActor: async () => actor });
  return async <T>(method: string, path: string, body?: unknown, status = 200) => {
    const response = await app.request(
      path,
      { method, ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }) },
      env,
    );
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
};
const admin = as("admin");

const tables = sql`truncate table kitchen_menu_lines, kitchen_menus, recipes, audit_log, events, users cascade`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(tables);
  await db.insert(schema.users).values(
    (Object.keys(people) as Who[]).map((who) => ({
      id: people[who],
      email: `${who}@kitchen.example`,
      name: who[0].toUpperCase() + who.slice(1),
      role: roles[who],
      mobile: "2025550100",
      status: who === "gone" ? ("deactivated" as const) : ("active" as const),
      // A staff member whose position is Kitchen counts; a server doesn't.
      positions: who === "chef" ? ["Kitchen prep"] : who === "server" ? ["Server"] : [],
    })),
  );
});
afterAll(async () => {
  await db.execute(tables);
  await client.end();
});

const today = utcToBusinessTime(new Date()).date;
async function eventWithMenu(
  title: string,
  days: number,
  options: { status?: "negotiation" | "closed" | "pitching" | "lost"; start?: string; leaves?: string | null; archived?: boolean } = {},
) {
  const date = addLocalDays(today, days);
  const [event] = await db
    .insert(schema.events)
    .values({
      title,
      status: options.status ?? "closed",
      startsAt: businessTimeToUtc(date, options.start ?? "18:00"),
      guestCount: 60,
      archivedAt: options.archived ? new Date() : null,
    })
    .returning();
  const [menu] = await db
    .insert(schema.kitchenMenus)
    .values({ eventId: event.id, leavesKitchenAt: options.leaves ? businessTimeToUtc(date, options.leaves) : null })
    .returning();
  return { event, menu };
}
const dish = async (name: string, allergens: string[] = []) =>
  (await db.insert(schema.recipes).values({ name, category: "Mains", allergens }).returning())[0];

describe("FLOW-293: Kitchen › Overview", () => {
  it("lists every menu item of qualifying events in the next 14 days, one row each, in order (AC2)", async () => {
    const rib = await dish("Short rib", ["Milk"]);
    const salad = await dish("Beet salad");
    const late = await eventWithMenu("Late supper", 2, { start: "20:00" });
    const early = await eventWithMenu("Brunch", 2, { start: "10:00", leaves: "09:15" });
    const edge = await eventWithMenu("Edge of window", 14);
    const tooFar = await eventWithMenu("Too far", 15);
    const pitching = await eventWithMenu("Pitching", 1, { status: "pitching" });
    const lost = await eventWithMenu("Lost", 1, { status: "lost" });
    const archived = await eventWithMenu("Archived", 1, { archived: true });
    const pending = await eventWithMenu("Pending", 3, { status: "negotiation" });
    for (const { menu } of [late, edge, tooFar, pitching, lost, archived, pending])
      await db.insert(schema.kitchenMenuLines).values({ menuId: menu.id, recipeId: rib.id, course: "Mains", plannedQuantity: 60 });
    await db.insert(schema.kitchenMenuLines).values([
      { menuId: early.menu.id, recipeId: rib.id, course: "Mains", plannedQuantity: null, notes: "No pepper" },
      { menuId: early.menu.id, recipeId: salad.id, course: "Starters", plannedQuantity: 40 },
    ]);
    // A removed line never shows.
    await db.insert(schema.kitchenMenuLines).values({ menuId: late.menu.id, recipeId: salad.id, course: "Starters", archivedAt: new Date() });

    const overview = await admin<KitchenOverview>("GET", "/api/kitchen/overview");
    expect(overview.rows.map((row) => [row.eventTitle, row.menuItem])).toEqual([
      // One event's items by course.
      ["Brunch", "Short rib"],
      ["Brunch", "Beet salad"],
      ["Late supper", "Short rib"],
      ["Pending", "Short rib"],
      ["Edge of window", "Short rib"],
    ]);
    const brunchRib = overview.rows[0];
    expect(brunchRib).toMatchObject({
      date: addLocalDays(today, 2),
      // Food leaves the kitchen at 9:15; without that time, the event start.
      foodReadyTime: "09:15",
      guestCount: 60,
      course: "Mains",
      servingSize: null,
      specialRequests: "No pepper",
      allergies: ["Milk"],
      inChargeStaffId: null,
    });
    expect(overview.rows[2].foodReadyTime).toBe("20:00");
    expect(overview.canEdit).toBe(true);
    // Active kitchen roles and Kitchen positions only.
    expect(overview.staff.map((person) => person.name)).toEqual(["Chef", "Cook", "Lead"]);
  });

  it("saves In charge for kitchen staff only, and keeps it (AC3)", async () => {
    const rib = await dish("Short rib");
    const { menu } = await eventWithMenu("Gala", 4);
    const [line] = await db.insert(schema.kitchenMenuLines).values({ menuId: menu.id, recipeId: rib.id, course: "Mains" }).returning();

    const lead = as("lead");
    expect(await lead("PATCH", `/api/kitchen/lines/${line.id}/in-charge`, { staffId: people.cook })).toEqual({
      lineId: line.id,
      inChargeStaffId: people.cook,
    });
    expect((await admin<KitchenOverview>("GET", "/api/kitchen/overview")).rows[0].inChargeStaffId).toBe(people.cook);
    const [stored] = await db.select().from(schema.kitchenMenuLines).where(eq(schema.kitchenMenuLines.id, line.id));
    expect(stored).toMatchObject({ inChargeStaffId: people.cook, edited: false });

    // Not kitchen staff, or no longer active.
    await lead("PATCH", `/api/kitchen/lines/${line.id}/in-charge`, { staffId: people.server }, 400);
    await lead("PATCH", `/api/kitchen/lines/${line.id}/in-charge`, { staffId: people.gone }, 400);
    // Clearing it.
    await lead("PATCH", `/api/kitchen/lines/${line.id}/in-charge`, { staffId: null });
    expect((await admin<KitchenOverview>("GET", "/api/kitchen/overview")).rows[0].inChargeStaffId).toBeNull();
  });

  it("refuses In charge to people who can't edit the kitchen menu", async () => {
    const rib = await dish("Short rib");
    const { menu } = await eventWithMenu("Gala", 4);
    const [line] = await db.insert(schema.kitchenMenuLines).values({ menuId: menu.id, recipeId: rib.id, course: "Mains" }).returning();
    await as("server")("PATCH", `/api/kitchen/lines/${line.id}/in-charge`, { staffId: people.cook }, 403);
  });
});
