import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { PDFDocument } from "pdf-lib";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Role } from "../../shared/access";

// The Kitchen screen's follow-ups (FLOW-301): the client recipe book stored as a
// Menu PDF, and recipes on upcoming event menus can't be deleted.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
// Stands in for the R2 binding: the objects in the bucket.
const bucket = new Map<string, { body: ArrayBuffer; contentType: string }>();
const env = {
  ASSETS: { fetch },
  R2_ACCOUNT_ID: "acct",
  R2_BUCKET: "flowbase-files",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  FILES: {
    head: async (key: string) => (bucket.has(key) ? { size: bucket.get(key)!.body.byteLength } : null),
    delete: async (keys: string | string[]) => { for (const key of [keys].flat()) bucket.delete(key); },
    put: async (key: string, body: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }) => {
      bucket.set(key, { body, contentType: options?.httpMetadata?.contentType ?? "" });
    },
  },
};
const people: Record<string, { id: string; role: Role }> = {
  admin: { id: "c3010000-0000-4000-8000-000000000001", role: "admin" },
  chef: { id: "c3010000-0000-4000-8000-000000000002", role: "kitchen_lead" },
};
const as = (who: keyof typeof people) => {
  const person = people[who];
  const app = createApp({ withDb, resolveActor: async () => ({ userId: person.id, role: person.role }) });
  return (method: string, path: string, body?: unknown) => app.request(path, {
    method, ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
  }, env);
};
const admin = as("admin");
const tables = sql`truncate table deletions, attachments, kitchen_menu_lines, kitchen_menus, recipe_lines, recipes, events, clients, jobs cascade`;
beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  bucket.clear();
  await db.execute(tables);
  await db.insert(schema.users).values(Object.entries(people).map(([name, person]) => ({
    id: person.id, email: `${name}@kitchen-menus.example`, name, role: person.role,
    status: "active" as const, mobile: "555-0100",
  }))).onConflictDoNothing({ target: schema.users.id });
});
afterAll(async () => {
  await db.execute(tables);
  await db.delete(schema.users).where(sql`${schema.users.id} in (${sql.join(Object.values(people).map((person) => sql`${person.id}`), sql`, `)})`);
  await client.end();
});

const dish = async (name: string, category = "Mains") =>
  (await db.insert(schema.recipes).values({ name, category, description: `${name}, synthetic.` }).returning())[0];

it("stores the client recipe book as a Menu PDF in the recipe book group, versioned per book (AC2)", async () => {
  await dish("Synthetic short rib");
  await dish("Synthetic tart", "Desserts");

  const first = await admin("POST", "/api/recipes/client-book", {});
  expect(first.status).toBe(201);
  const book = await first.json();
  expect(book).toMatchObject({ name: "Client recipe book", docType: "menu", recordType: "document", group: "recipe_book" });
  expect(book.versions).toHaveLength(1);
  // The stored file is a real PDF.
  const [stored] = [...bucket.values()];
  expect(stored.contentType).toBe("application/pdf");
  expect((await PDFDocument.load(stored.body)).getPageCount()).toBeGreaterThan(0);

  // Generating the same book again adds a version; a category is its own book.
  const again = await (await admin("POST", "/api/recipes/client-book", {})).json();
  expect(again.id).toBe(book.id);
  expect(again.versions.map((version: { number: number }) => version.number)).toEqual([2, 1]);
  const desserts = await (await admin("POST", "/api/recipes/client-book", { category: "Desserts" })).json();
  expect(desserts.id).not.toBe(book.id);
  expect(desserts.name).toBe("Client recipe book - Desserts");

  // Both appear among the Menu documents, so the Menus tab lists them.
  const menus = await (await admin("GET", "/api/documents?docType=menu")).json();
  expect(menus.filter((document: { group: string }) => document.group === "recipe_book")).toHaveLength(2);

  expect((await admin("POST", "/api/recipes/client-book", { category: "Nothing here" })).status).toBe(400);
});

it("refuses to delete a recipe on an upcoming event's menu, single and bulk, and allows it once the event is finished (AC4)", async () => {
  const rib = await dish("Synthetic short rib");
  const tart = await dish("Synthetic tart", "Desserts");
  const [owner] = await db.insert(schema.clients).values({ name: "Synthetic client", kind: "organization" }).returning();
  const [gala] = await db.insert(schema.events).values({ clientId: owner.id, title: "Synthetic gala",
    startsAt: new Date("2027-01-15T23:00:00.000Z"), status: "preparation" }).returning();
  const [menu] = await db.insert(schema.kitchenMenus).values({ eventId: gala.id }).returning();
  await db.insert(schema.kitchenMenuLines).values({ menuId: menu.id, recipeId: rib.id, course: "Mains" });

  const single = await admin("POST", `/api/recipes/${rib.id}/archive`);
  expect(single.status).toBe(409);
  expect(JSON.stringify(await single.json())).toMatch(/upcoming event \(Synthetic gala\)/);

  const bulk = await (await admin("POST", "/api/deletions/recipe", { ids: [rib.id, tart.id] })).json();
  expect(bulk.deleted).toEqual([tart.id]);
  expect(bulk.skipped).toEqual([expect.objectContaining({ id: rib.id, reason: expect.stringMatching(/Synthetic gala/) })]);

  await db.update(schema.events).set({ status: "finished" }).where(sql`${schema.events.id} = ${gala.id}`);
  expect((await admin("POST", `/api/recipes/${rib.id}/archive`)).status).toBe(200);
});
