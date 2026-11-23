import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, Role } from "../../shared/access";
import type { UploadTicket } from "../../shared/attachments";
import type { Photo } from "../../shared/photos";

// Photo galleries (FLOW-271, FLOW-298) against the real schema and routes.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const stored = new Map<string, number>();
const env = {
  ASSETS: { fetch },
  R2_ACCOUNT_ID: "acct",
  R2_BUCKET: "flowbase-files",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  FILES: { head: async (key: string) => (stored.has(key) ? { size: stored.get(key) ?? 0 } : null) },
};
const signedIn = (userId: string, role: Role) => {
  const actor: Actor = { userId, role };
  const app = createApp({ withDb, resolveActor: async () => actor });
  return (method: string, path: string, body?: unknown) =>
    app.request(path, { method, ...(body !== undefined && { body: JSON.stringify(body) }) }, env);
};
const ids = {
  admin: "a7100000-0000-4000-8000-000000000001",
  sam: "a7100000-0000-4000-8000-000000000002",
  stan: "a7100000-0000-4000-8000-000000000003",
  kim: "a7100000-0000-4000-8000-000000000004",
  pat: "a7100000-0000-4000-8000-000000000005",
};
const admin = signedIn(ids.admin, "admin");
const sam = signedIn(ids.sam, "salesperson");
const stan = signedIn(ids.stan, "staff");
const kim = signedIn(ids.kim, "kitchen_staff");
const pat = signedIn(ids.pat, "part_time_staff");
type Caller = typeof admin;

// Only this file's uploads: other files keep their attachments (and contracts
// reference them), so each gallery below is read as this file's rows alone.
const ownIds = Object.values(ids);
const clearOwnPhotos = () =>
  db.execute(sql`delete from attachments where created_by in ${sql.raw(`(${ownIds.map((id) => `'${id}'`).join(", ")})`)}`);
const own = <T extends { uploadedBy: string | null }>(rows: T[]) =>
  rows.filter((row) => row.uploadedBy !== null && ownIds.includes(row.uploadedBy));

let eventA: string;
let eventB: string;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  stored.clear();
  await clearOwnPhotos();
  await db.execute(sql`delete from events where title like 'Synthetic photo event%'`);
  // The tags migration 0070 seeds, in case another file cleared the lists.
  await db
    .insert(schema.listValues)
    .values(["Food", "Team"].map((label, sortOrder) => ({ listKey: "photo_tag" as const, label, sortOrder })))
    .onConflictDoNothing();
  [{ id: eventA }, { id: eventB }] = await db
    .insert(schema.events)
    .values([
      { title: "Synthetic photo event A", startsAt: new Date("2026-12-05T23:00:00Z"), assignedSalespersonId: ids.sam },
      { title: "Synthetic photo event B", startsAt: new Date("2026-12-06T23:00:00Z") },
    ])
    .returning({ id: schema.events.id });
});
afterAll(async () => {
  await clearOwnPhotos();
  await db.execute(sql`delete from events where title like 'Synthetic photo event%'`);
  await client.end();
});

// Uploads one resized photo through /api/attachments and completes it.
async function upload(
  caller: Caller,
  target: { recordType: string; recordId: string; group?: string; caption?: string; photoDate?: string },
) {
  const started = await caller("POST", "/api/attachments", {
    group: "",
    fileName: "IMG_0042.jpg",
    ...target,
    variants: [
      { name: "thumb", contentType: "image/jpeg", size: 18_000 },
      { name: "display", contentType: "image/jpeg", size: 240_000 },
    ],
  });
  if (started.status !== 201) return started.status;
  const ticket = (await started.json()) as UploadTicket;
  for (const entry of ticket.uploads)
    stored.set(
      decodeURIComponent(new URL(entry.url).pathname.replace("/flowbase-files/", "")),
      entry.name === "thumb" ? 18_000 : 240_000,
    );
  const done = await caller("POST", `/api/attachments/${ticket.attachment.id}/complete`);
  expect(done.status).toBe(200);
  return ticket.attachment.id;
}
const gallery = async (caller: Caller, area: string) => {
  const response = await caller("GET", `/api/photos?area=${area}`);
  expect(response.status).toBe(200);
  return own((await response.json()) as Photo[]);
};
const loose = () => ({ recordType: "document", recordId: crypto.randomUUID() });

it("shows every photo the viewer can see in Marketing, with approval and tags that persist (FLOW-271)", async () => {
  await upload(admin, { recordType: "event", recordId: eventA });
  await upload(admin, { recordType: "event", recordId: eventB });
  expect(typeof (await upload(sam, { ...loose(), group: "marketing" }))).toBe("string");
  // Staff read Marketing photos but don't upload or change them.
  expect(await upload(stan, { ...loose(), group: "marketing" })).toBe(403);

  const all = await gallery(admin, "marketing");
  expect(all).toHaveLength(3);
  expect(all.map((photo) => photo.eventTitle ?? "").sort()).toEqual(["", "Synthetic photo event A", "Synthetic photo event B"]);
  for (const photo of all) expect(photo.urls?.thumb).toMatch(/thumb\.jpg/);
  // A salesperson sees their own event's photos only; staff see neither event.
  expect((await gallery(sam, "marketing")).map((photo) => photo.eventTitle ?? "").sort()).toEqual(["", "Synthetic photo event A"]);
  expect(await gallery(stan, "marketing")).toHaveLength(1);

  const photoA = all.find((photo) => photo.eventId === eventA)!;
  // Staff can't change a photo they see, and an event photo they can't see is hidden.
  const loosePhoto = all.find((photo) => photo.eventId === null)!;
  expect((await stan("PATCH", `/api/photos/${loosePhoto.id}`, { approvedForMarketing: true })).status).toBe(403);
  expect((await stan("PATCH", `/api/photos/${photoA.id}`, { approvedForMarketing: true })).status).toBe(404);
  const approved = await sam("PATCH", `/api/photos/${photoA.id}`, { approvedForMarketing: true, tags: ["Food", "Food", "Team"] });
  expect(approved.status).toBe(200);
  expect(await approved.json()).toMatchObject({ approvedForMarketing: true, tags: ["Food", "Team"] });
  expect((await sam("PATCH", `/api/photos/${photoA.id}`, { tags: ["Not a tag"] })).status).toBe(400);
  const reloaded = await gallery(admin, "marketing");
  expect(reloaded.filter((photo) => photo.approvedForMarketing).map((photo) => photo.id)).toEqual([photoA.id]);
  expect(reloaded.find((photo) => photo.id === photoA.id)?.tags).toEqual(["Food", "Team"]);
  // A photo is one Document of type Photo, not a copy.
  const documents = (await (await admin("GET", "/api/documents?docType=photo")).json()) as { id: string }[];
  expect(documents.map((document) => document.id)).toEqual(expect.arrayContaining(all.map((photo) => photo.id)));
});

it("deletes with Undo and checks who may delete (FLOW-271 AC3)", async () => {
  await upload(sam, { ...loose(), group: "marketing" });
  const [photo] = await gallery(sam, "marketing");
  expect((await stan("POST", `/api/photos/${photo.id}/archive`)).status).toBe(403);
  expect(await (await sam("POST", `/api/photos/${photo.id}/archive`)).json()).toEqual({ id: photo.id, restored: false });
  expect(await gallery(sam, "marketing")).toEqual([]);
  expect((await sam("POST", `/api/photos/${photo.id}/archive`)).status).toBe(404);
  expect(await (await sam("POST", `/api/photos/${photo.id}/restore`)).json()).toEqual({ id: photo.id, restored: true });
  expect((await gallery(sam, "marketing")).map((entry) => entry.id)).toEqual([photo.id]);
});

it("keeps Kitchen and Inventory photos in their own gallery, with label and date (FLOW-298)", async () => {
  // Kitchen staff write the Kitchen area; part-time staff only read it.
  await upload(kim, { ...loose(), group: "kitchen", caption: "Walk-in", photoDate: "2026-11-01" });
  expect(await upload(pat, { ...loose(), group: "kitchen" })).toBe(403);
  // Staff read Inventory but don't write it.
  expect(await upload(stan, { ...loose(), group: "inventory" })).toBe(403);
  await upload(admin, { ...loose(), group: "inventory" });

  const kitchen = await gallery(pat, "kitchen");
  expect(kitchen).toHaveLength(1);
  expect(kitchen[0]).toMatchObject({ area: "kitchen", label: "Walk-in", title: "Walk-in", date: "2026-11-01" });
  const inventory = await gallery(stan, "inventory");
  expect(inventory.map((photo) => photo.area)).toEqual(["inventory"]);
  expect(inventory[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  // Every photo also shows in Marketing.
  expect((await gallery(admin, "marketing")).map((photo) => photo.area).sort()).toEqual(["inventory", "kitchen"]);

  const id = kitchen[0].id;
  expect((await pat("PATCH", `/api/photos/${id}`, { label: "Mine" })).status).toBe(403);
  expect((await kim("PATCH", `/api/photos/${id}`, { date: "2026-02-31" })).status).toBe(400);
  const edited = await kim("PATCH", `/api/photos/${id}`, { label: "Prep line", date: "2026-11-02" });
  expect(await edited.json()).toMatchObject({ label: "Prep line", date: "2026-11-02" });
  expect((await gallery(kim, "kitchen"))[0]).toMatchObject({ label: "Prep line", date: "2026-11-02" });

  expect((await pat("POST", `/api/photos/${id}/archive`)).status).toBe(403);
  expect((await kim("POST", `/api/photos/${id}/archive`)).status).toBe(200);
  expect(await gallery(kim, "kitchen")).toEqual([]);
});

it("rejects an unknown gallery", async () => {
  expect((await admin("GET", "/api/photos?area=garage")).status).toBe(400);
});
