import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import * as schema from "../../worker/db/schema";
import type { Actor } from "../../shared/access";
import { listCopy, resetCopy, saveCopy } from "../../worker/records/copy";

// Admin live text editing (FLOW-240): the ui_copy migration, upsert and reset.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const admin: Actor = { userId: "b2400000-0000-4000-8000-000000000001", role: "admin" };

beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.execute(sql`truncate table ui_copy, users cascade`);
  await db.insert(schema.users).values({
    id: admin.userId, role: "admin",
    email: "copy-admin@example.test", name: "Copy Admin", mobile: "2025551300", status: "active",
  });
});
afterAll(async () => { await client.end(); });

it("creates ui_copy with a unique key and RLS on", async () => {
  const [table] = await db.execute<{ relrowsecurity: boolean }>(
    sql`select relrowsecurity from pg_class where relname = 'ui_copy'`,
  );
  expect(table.relrowsecurity).toBe(true);
  await db.insert(schema.uiCopy).values({ key: "nav.sales", text: "Selling" });
  await expect(db.insert(schema.uiCopy).values({ key: "nav.sales", text: "Again" })).rejects.toThrow();
});

it("upserts a batch and records who saved it", async () => {
  expect(await saveCopy(db, admin, [
    { key: "nav.sales", text: "Selling", placeholders: [] },
    { key: "shared.empty-state.title", text: "Nothing yet", placeholders: [] },
  ])).toEqual({ "nav.sales": "Selling", "shared.empty-state.title": "Nothing yet" });
  expect(await saveCopy(db, admin, [{ key: "nav.sales", text: "Sales desk", placeholders: [] }]))
    .toEqual({ "nav.sales": "Sales desk", "shared.empty-state.title": "Nothing yet" });
  const rows = await db.select().from(schema.uiCopy);
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => row.updatedBy === admin.userId)).toBe(true);
});

it("saves all of a batch or none of it", async () => {
  await expect(saveCopy(db, admin, [
    { key: "nav.sales", text: "Selling", placeholders: [] },
    { key: "nav.events", text: null as unknown as string, placeholders: [] },
  ])).rejects.toThrow();
  expect(await listCopy(db)).toEqual({});
});

it("resets a key by deleting its row", async () => {
  await saveCopy(db, admin, [{ key: "nav.sales", text: "Selling", placeholders: [] }]);
  await resetCopy(db, "nav.sales");
  await resetCopy(db, "nav.missing");
  expect(await listCopy(db)).toEqual({});
});
