import { readFileSync } from "node:fs";
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

// FLOW-277: renamed keys and trimmed line breaks.
const renames = {
  copy: { "staff.staff-form.save-profile": "staff.staff-form.save" },
  blocks: {},
  removed: { copy: [], blocks: [] },
};

it("drops a renamed key's old row when the new key is saved, so the alias can go", async () => {
  await db.insert(schema.uiCopy).values({ key: "staff.staff-form.save-profile", text: "Save staff" });
  expect(await saveCopy(db, admin, [{ key: "staff.staff-form.save", text: "Save member", placeholders: [] }], renames))
    .toEqual({ "staff.staff-form.save": "Save member" });
});

it("resets a renamed key's old row too, or the alias would bring it back", async () => {
  await db.insert(schema.uiCopy).values({ key: "staff.staff-form.save-profile", text: "Save staff" });
  await resetCopy(db, "staff.staff-form.save", renames);
  expect(await listCopy(db)).toEqual({});
});

it("cleans line breaks saved before the trim (AC6 migration)", async () => {
  await db.insert(schema.uiCopy).values([
    { key: "staff.positions.add", text: "Add Position\n" },
    { key: "staff.form.save", text: "Save Changes\n\n" },
    { key: "inventory.list.status", text: "\r\nStatus\n" },
    { key: "planning.auto", text: " · automatic" },
    { key: "only.breaks", text: "\n\n" },
  ]);
  const migration = readFileSync("drizzle/0067_flow_277_trim_copy_line_breaks.sql", "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) await db.execute(sql.raw(statement));
  expect(await listCopy(db)).toEqual({
    "staff.positions.add": "Add Position",
    "staff.form.save": "Save Changes",
    "inventory.list.status": "Status",
    "planning.auto": " · automatic",
  });
});
