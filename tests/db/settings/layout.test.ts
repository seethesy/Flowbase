import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq, sql } from "drizzle-orm";
import * as schema from "../../../worker/db/schema";
import type { Actor } from "../../../shared/access";
import { emptyLayout, type LayoutDoc } from "../../../shared/layout";
import { getLayout, resetLayout, saveLayout } from "../../../worker/records/settings/layout";

// Page layouts (FLOW-253): the ui_layout migration, upsert, reset and audit.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const admin: Actor = { userId: "b2530000-0000-4000-8000-000000000001", role: "admin" };
const layout: LayoutDoc = {
  ...emptyLayout(),
  blocks: [{ kind: "builtin", id: "notes", x: 0, y: 0, w: 6, h: 8, hidden: true }],
};

beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(sql`truncate table ui_layout, audit_log, users cascade`);
  await db.insert(schema.users).values({
    id: admin.userId, role: "admin",
    email: "layout-admin@example.test", name: "Layout Admin", mobile: "2025551301", status: "active",
  });
});
afterAll(async () => { await client.end(); });

it("creates ui_layout with a unique page key and RLS on", async () => {
  const [table] = await db.execute<{ relrowsecurity: boolean }>(
    sql`select relrowsecurity from pg_class where relname = 'ui_layout'`,
  );
  expect(table.relrowsecurity).toBe(true);
  await db.insert(schema.uiLayout).values({ pageKey: "leads.detail", layout });
  await expect(db.insert(schema.uiLayout).values({ pageKey: "leads.detail", layout })).rejects.toThrow();
});

it("saves, updates and reads one layout per page, audit-logged", async () => {
  expect(await getLayout(db, "leads.detail")).toBeNull();
  const first = await saveLayout(db, admin, "leads.detail", layout);
  expect(first).toMatchObject({ pageKey: "leads.detail", layout, updatedBy: admin.userId });
  const changed: LayoutDoc = { ...layout, blocks: [{ ...layout.blocks[0], hidden: undefined }] as LayoutDoc["blocks"] };
  await saveLayout(db, admin, "leads.detail", changed);
  expect((await db.select().from(schema.uiLayout))).toHaveLength(1);
  expect((await getLayout(db, "leads.detail"))?.layout.blocks[0].id).toBe("notes");
  const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "ui_layout"));
  expect(audit.map((row) => row.action).sort()).toEqual(["create", "update"]);
});

it("resets a page to its code default and logs it; resetting nothing is a no-op", async () => {
  await saveLayout(db, admin, "leads.detail", layout);
  await resetLayout(db, admin, "leads.detail");
  await resetLayout(db, admin, "events.detail");
  expect(await getLayout(db, "leads.detail")).toBeNull();
  const audit = await db.select().from(schema.auditLog).where(eq(schema.auditLog.entityType, "ui_layout"));
  expect(audit.map((row) => row.action).sort()).toEqual(["archive", "create"]);
});
