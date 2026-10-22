import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, Role } from "../../shared/access";
import type { Attachment, UploadTicket } from "../../shared/attachments";
import type { Client, Venue } from "../../shared/core-records";

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
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
  // Stands in for the R2 binding: what has "arrived" in the bucket.
  FILES: {
    head: async (key: string) =>
      stored.has(key) ? { size: stored.get(key) ?? 0 } : null,
  },
};
const signedIn = (userId: string, role: Role) => {
  const actor: Actor = { userId, role, employmentType: "full_time" };
  const app = createApp({ withDb, resolveActor: async () => actor });
  return (method: string, path: string, body?: unknown) =>
    app.request(
      path,
      { method, ...(body !== undefined && { body: JSON.stringify(body) }) },
      env,
    );
};
const admin = signedIn("a0000000-0000-4000-8000-000000000001", "admin");
const sam = signedIn("a0000000-0000-4000-8000-000000000003", "salesperson");
const sue = signedIn("a0000000-0000-4000-8000-000000000004", "salesperson");

const photo = (recordType: string, recordId: string, group = "") => ({
  recordType,
  recordId,
  group,
  fileName: "IMG_0042.HEIC",
  variants: [
    { name: "thumb", contentType: "image/jpeg", size: 18_000 },
    { name: "display", contentType: "image/jpeg", size: 240_000 },
  ],
});
// Pretends the browser PUT each variant to its signed URL.
const arrive = (ticket: UploadTicket) => {
  for (const upload of ticket.uploads) {
    const key = decodeURIComponent(
      new URL(upload.url).pathname.replace("/flowbase-files/", ""),
    );
    stored.set(key, upload.name === "thumb" ? 18_000 : 240_000);
  }
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  stored.clear();
  await db.execute(
    sql`truncate table attachments, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

const newVenue = async () =>
  (await (
    await admin("POST", "/api/venues", { name: "The Glasshouse" })
  ).json()) as Venue;

it("stores only the resized photo variants and lists them once uploaded", async () => {
  const venue = await newVenue();
  const started = await admin(
    "POST",
    "/api/attachments",
    photo("venue", venue.id, "floor_plan"),
  );
  expect(started.status).toBe(201);
  const ticket = (await started.json()) as UploadTicket;
  expect(ticket.uploads.map((upload) => upload.name).sort()).toEqual([
    "display",
    "thumb",
  ]);
  for (const upload of ticket.uploads) {
    const signed = new URL(upload.url);
    expect(signed.searchParams.get("X-Amz-Expires")).toBe("300");
    // Keys are generated; the user's file name never becomes a storage path.
    expect(signed.pathname).not.toContain("IMG_0042");
  }
  const list = `/api/attachments?recordType=venue&recordId=${venue.id}`;
  expect(await (await admin("GET", list)).json()).toEqual([]);

  // Completing before the files arrive fails.
  expect(
    (await admin("POST", `/api/attachments/${ticket.attachment.id}/complete`))
      .status,
  ).toBe(404);
  arrive(ticket);
  const done = await admin(
    "POST",
    `/api/attachments/${ticket.attachment.id}/complete`,
  );
  expect(done.status).toBe(200);
  const [listed] = (await (await admin("GET", list)).json()) as Attachment[];
  expect(listed).toMatchObject({
    group: "floor_plan",
    kind: "photo",
    fileName: "IMG_0042.HEIC",
  });
  expect(Object.keys(listed.urls).sort()).toEqual(["display", "thumb"]);
  expect(new URL(listed.urls.display ?? "").searchParams.get("X-Amz-Expires")).toBe(
    "300",
  );
  expect(listed.urlsExpireAt).not.toBeNull();
});

it("hides another salesperson's client files", async () => {
  const owned = (await (
    await sue("POST", "/api/clients", { name: "Sue's client", kind: "person" })
  ).json()) as Client;
  expect(
    (await sam("POST", "/api/attachments", photo("client", owned.id))).status,
  ).toBe(404);
  const ticket = (await (
    await sue("POST", "/api/attachments", photo("client", owned.id))
  ).json()) as UploadTicket;
  arrive(ticket);
  await sue("POST", `/api/attachments/${ticket.attachment.id}/complete`);
  expect(
    (
      await sam(
        "GET",
        `/api/attachments?recordType=client&recordId=${owned.id}`,
      )
    ).status,
  ).toBe(404);
  expect(
    (await sam("POST", `/api/attachments/${ticket.attachment.id}/archive`))
      .status,
  ).toBe(404);
});

it("updates captions and archives files", async () => {
  const venue = await newVenue();
  const ticket = (await (
    await admin("POST", "/api/attachments", photo("venue", venue.id))
  ).json()) as UploadTicket;
  arrive(ticket);
  await admin("POST", `/api/attachments/${ticket.attachment.id}/complete`);
  const captioned = (await (
    await admin("PATCH", `/api/attachments/${ticket.attachment.id}`, {
      caption: "Tent layout",
    })
  ).json()) as Attachment;
  expect(captioned.caption).toBe("Tent layout");
  await admin("POST", `/api/attachments/${ticket.attachment.id}/archive`);
  expect(
    await (
      await admin("GET", `/api/attachments?recordType=venue&recordId=${venue.id}`)
    ).json(),
  ).toEqual([]);
});
