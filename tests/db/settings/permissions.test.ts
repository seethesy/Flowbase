import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../../worker/db/schema";
import { createApp } from "../../../worker/app";
import type { RunWithDb } from "../../../worker/hono";
import type { Bindings } from "../../../worker/bindings";
import type { Actor, Role } from "../../../shared/access";
import { areas, defaultMatrix, setPolicyMatrix, type AreaKey, type Level, type Matrix } from "../../../shared/role-permissions";
import { invalidatePolicy, loadMatrix, POLICY_TTL_MS } from "../../../worker/records/settings/permissions";
import { emptyNavHidden } from "../../../shared/nav-visibility";

// Roles and permissions (FLOW-269) through the real API and database.

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } } as Bindings;

const signedInAs = (role: Role) => {
  const actor: Actor = { userId: "26900000-0000-4000-8000-000000000001", role };
  const app = createApp({ withDb, resolveActor: async () => actor, loadPolicy: true });
  return (method: string, path: string, body?: unknown) =>
    app.request(
      path,
      {
        method,
        ...(body !== undefined && {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
      },
      env,
    );
};
const admin = signedInAs("admin");
const staff = signedInAs("staff");

const edited = (matrix: Matrix, role: Role, area: AreaKey, level: Level): Matrix => ({
  ...matrix,
  [role]: { ...matrix[role], [area]: level },
});
const storedLevel = async (role: Role, area: string) =>
  (
    await db
      .select({ level: schema.rolePermissions.level })
      .from(schema.rolePermissions)
      .where(and(eq(schema.rolePermissions.role, role), eq(schema.rolePermissions.area, area)))
  )[0]?.level;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(sql`truncate table role_permissions, role_nav_hidden, audit_log`);
  invalidatePolicy();
  setPolicyMatrix(null);
});
afterAll(async () => {
  setPolicyMatrix(null);
  await client.end();
});

describe("the stored matrix", () => {
  it("creates role_permissions with RLS on and one row per role and area", async () => {
    const [table] = await db.execute<{ relrowsecurity: boolean }>(
      sql`select relrowsecurity from pg_class where relname = 'role_permissions'`,
    );
    expect(table.relrowsecurity).toBe(true);
    await staff("GET", "/api/permissions");
    const rows = await db.select().from(schema.rolePermissions);
    expect(rows).toHaveLength(8 * areas.length);
    await expect(
      db.insert(schema.rolePermissions).values({ role: "staff", area: "leads", level: "read" }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.rolePermissions).values({ role: "staff", area: "nowhere" as never, level: "read" }),
    ).rejects.toThrow();
  });

  it("AC1: seeds from today's rules, so the first answers match the built-in ones", async () => {
    const response = await staff("GET", "/api/permissions");
    expect(response.status).toBe(200);
    expect((await response.json()).matrix).toEqual(defaultMatrix);
    // Staff pay: Admin and Technical (FLOW-270 A1).
    expect(await storedLevel("staff", "staff_pay")).toBe("none");
    expect(await storedLevel("sales_manager", "staff_pay")).toBe("none");
    expect(await storedLevel("technical", "staff_pay")).toBe("write");
    expect(await storedLevel("admin", "staff_pay")).toBe("write");
    expect((await staff("GET", "/api/inventory/items")).status).toBe(200);
  });
});

describe("saving", () => {
  it("AC2: Staff Inventory Read → None gives Staff 403, applying on the next request", async () => {
    expect((await staff("GET", "/api/inventory/items")).status).toBe(200);
    const saved = await admin("PUT", "/api/permissions", {
      matrix: edited(defaultMatrix, "staff", "inventory_bar", "none"),
    });
    expect(saved.status).toBe(200);
    expect(await storedLevel("staff", "inventory_bar")).toBe("none");
    const refused = await staff("GET", "/api/inventory/items");
    expect(refused.status).toBe(403);
    // Counts and the item page are gone with the area; Admin and others keep it.
    expect((await staff("GET", "/api/inventory/counts")).status).toBe(403);
    expect((await admin("GET", "/api/inventory/items")).status).toBe(200);
    expect((await signedInAs("kitchen_staff")("GET", "/api/inventory/items")).status).toBe(200);
    // Back to Read restores it.
    await admin("PUT", "/api/permissions", { matrix: defaultMatrix });
    expect((await staff("GET", "/api/inventory/items")).status).toBe(200);
  });

  it("AC3: the Admin column can't be changed (400), and nothing is saved", async () => {
    const response = await admin("PUT", "/api/permissions", {
      matrix: edited(defaultMatrix, "admin", "inventory_bar", "read"),
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_PERMISSIONS");
    expect(body.error.message).toMatch(/Admin always has Write/);
    expect(await storedLevel("admin", "inventory_bar")).not.toBe("read");
    // A level the area doesn't offer, and a malformed body, are also 400.
    expect(
      (await admin("PUT", "/api/permissions", { matrix: edited(defaultMatrix, "staff", "inventory_bar", "own") })).status,
    ).toBe(400);
    expect((await admin("PUT", "/api/permissions", { matrix: { staff: {} } })).status).toBe(400);
  });

  it("only Admin saves", async () => {
    const response = await staff("PUT", "/api/permissions", { matrix: defaultMatrix });
    expect(response.status).toBe(403);
    expect((await signedInAs("sales_manager")("PUT", "/api/permissions", { matrix: defaultMatrix })).status).toBe(403);
  });

  it("is audit-logged with before and after for each changed cell", async () => {
    await admin("PUT", "/api/permissions", {
      matrix: edited(edited(defaultMatrix, "staff", "inventory_bar", "none"), "sales_manager", "staff_pay", "read"),
    });
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityType, "role_permissions"));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: "update", createdBy: "26900000-0000-4000-8000-000000000001" });
    expect(audit[0].changes).toEqual({
      "staff.inventory_bar": { before: "read", after: "none" },
      "sales_manager.staff_pay": { before: "none", after: "read" },
    });
    // Saving the same matrix again changes nothing and logs nothing.
    await admin("PUT", "/api/permissions", {
      matrix: edited(edited(defaultMatrix, "staff", "inventory_bar", "none"), "sales_manager", "staff_pay", "read"),
    });
    expect(
      await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "role_permissions")),
    ).toHaveLength(1);
  });
});

describe("the in-memory copy", () => {
  it("serves a cached matrix until it ages out, and a save invalidates it at once", async () => {
    const now = Date.now();
    expect((await loadMatrix(db, now)).staff.inventory_bar).toBe("read");
    // Another Worker isolate saves: this one still answers from memory...
    await db
      .update(schema.rolePermissions)
      .set({ level: "none" })
      .where(and(eq(schema.rolePermissions.role, "staff"), eq(schema.rolePermissions.area, "inventory_bar")));
    expect((await loadMatrix(db, now + POLICY_TTL_MS - 1)).staff.inventory_bar).toBe("read");
    // ...until its copy is older than the TTL.
    expect((await loadMatrix(db, now + POLICY_TTL_MS + 1)).staff.inventory_bar).toBe("none");
    // A save here replaces the copy immediately, without waiting for the TTL.
    await admin("PUT", "/api/permissions", { matrix: defaultMatrix });
    expect((await loadMatrix(db)).staff.inventory_bar).toBe("read");
    expect((await staff("GET", "/api/inventory/items")).status).toBe(200);
  });
});

// Which roles see each sidebar heading and tab (FLOW-284).
describe("navigation by role", () => {
  const hidden = { ...emptyNavHidden(), part_time_staff: ["sales.network", "sales.time-tracking"] };
  const partTime = signedInAs("part_time_staff");

  it("everyone reads it, starting with nothing hidden", async () => {
    const response = await partTime("GET", "/api/permissions/navigation");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ hidden: emptyNavHidden() });
  });

  it("AC1, AC2: Admin hides Network (FLOW-340: Venues) and Time Tracking for Part-time Staff; the API still answers by area", async () => {
    const saved = await admin("PUT", "/api/permissions/navigation", { hidden });
    expect(saved.status).toBe(200);
    expect((await saved.json()).hidden.part_time_staff).toEqual(["sales.network", "sales.time-tracking"]);
    expect((await (await partTime("GET", "/api/permissions/navigation")).json()).hidden.part_time_staff).toEqual([
      "sales.network",
      "sales.time-tracking",
    ]);
    // Not a security boundary: Venues still answers by the Events area.
    expect((await partTime("GET", "/api/venues")).status).toBe(200);
  });

  it("AC4: Admin's list stays empty, keys must exist, and only Admin saves", async () => {
    const locked = await admin("PUT", "/api/permissions/navigation", { hidden: { ...emptyNavHidden(), admin: ["sales"] } });
    expect(locked.status).toBe(400);
    expect((await locked.json()).error.code).toBe("INVALID_NAV_VISIBILITY");
    expect(
      (await admin("PUT", "/api/permissions/navigation", { hidden: { ...emptyNavHidden(), staff: ["sales.nowhere"] } })).status,
    ).toBe(400);
    expect((await admin("PUT", "/api/permissions/navigation", { hidden: { staff: [] } })).status).toBe(400);
    expect((await staff("PUT", "/api/permissions/navigation", { hidden })).status).toBe(403);
    expect(await db.select().from(schema.roleNavHidden)).toEqual([]);
  });

  it("is audit-logged with each changed role's list before and after", async () => {
    await admin("PUT", "/api/permissions/navigation", { hidden });
    await admin("PUT", "/api/permissions/navigation", { hidden });
    const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "role_nav_hidden"));
    expect(audit).toHaveLength(1);
    expect(audit[0].changes).toEqual({ part_time_staff: { before: [], after: ["sales.network", "sales.time-tracking"] } });
  });
});
