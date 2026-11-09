import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { attachments } from "../../worker/db/schema";
import {
  ATTACHMENT_CLEANUP_BATCH,
  cleanupAttachments,
} from "../../worker/attachments/cleanup";

// Abandoned uploads and long-archived files leave R2 (FLOW-188).
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(sql`truncate table contracts, attachments`);
});
afterAll(async () => {
  await client.end();
});

const NOW = new Date("2026-11-08T12:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 60 * 60_000);
const daysAgo = (days: number) => hoursAgo(days * 24);

const files = () => {
  const deleted: string[] = [];
  return {
    deleted,
    FILES: {
      head: async () => null,
      delete: vi.fn(async (keys: string | string[]) => {
        deleted.push(...(Array.isArray(keys) ? keys : [keys]));
      }),
    },
  };
};

const add = async (
  name: string,
  values: Partial<typeof attachments.$inferInsert> = {},
) => {
  const [row] = await db
    .insert(attachments)
    .values({
      recordType: "venue",
      recordId: crypto.randomUUID(),
      fileName: `${name}.jpg`,
      variants: [
        { name: "thumb", key: `venue/x/${name}/thumb.jpg`, contentType: "image/jpeg", size: 1 },
        { name: "display", key: `venue/x/${name}/display.jpg`, contentType: "image/jpeg", size: 2 },
      ],
      ...values,
    })
    .returning();
  return row;
};
const names = async () =>
  (await db.select().from(attachments)).map((row) => row.fileName.replace(".jpg", "")).sort();

it("removes a pending upload older than 24 hours with its objects, and keeps a newer one", async () => {
  await add("abandoned", { status: "pending", createdAt: hoursAgo(25) });
  await add("in-flight", { status: "pending", createdAt: hoursAgo(23) });
  await add("ready-old", { status: "ready", createdAt: daysAgo(400) });
  const env = files();

  expect(await cleanupAttachments(db, env, NOW)).toEqual({
    abandonedUploadsRemoved: 1,
    archivedAttachmentsRemoved: 0,
  });

  expect(env.deleted.sort()).toEqual([
    "venue/x/abandoned/display.jpg",
    "venue/x/abandoned/thumb.jpg",
  ]);
  expect(await names()).toEqual(["in-flight", "ready-old"]);
});

it("removes an attachment archived more than 365 days ago, and keeps a more recent one", async () => {
  await add("archived-long", { status: "ready", archivedAt: daysAgo(366) });
  await add("archived-recent", { status: "ready", archivedAt: daysAgo(364) });
  const env = files();

  expect(await cleanupAttachments(db, env, NOW)).toEqual({
    abandonedUploadsRemoved: 0,
    archivedAttachmentsRemoved: 1,
  });

  expect(env.deleted).toContain("venue/x/archived-long/thumb.jpg");
  expect(env.deleted).not.toContain("venue/x/archived-recent/thumb.jpg");
  expect(await names()).toEqual(["archived-recent"]);
});

it("keeps the row when the objects can't be deleted, so the next run retries", async () => {
  await add("abandoned", { status: "pending", createdAt: hoursAgo(30) });
  const env = { FILES: { head: async () => null, delete: async () => { throw new Error("R2 down"); } } };
  await expect(cleanupAttachments(db, env, NOW)).rejects.toThrow("R2 down");
  expect(await names()).toEqual(["abandoned"]);
});

it("does nothing without the R2 binding", async () => {
  await add("abandoned", { status: "pending", createdAt: hoursAgo(30) });
  expect(await cleanupAttachments(db, {}, NOW)).toEqual({
    abandonedUploadsRemoved: 0,
    archivedAttachmentsRemoved: 0,
  });
  expect(await names()).toEqual(["abandoned"]);
});

it("works through a backlog one batch per run", async () => {
  for (let index = 0; index < ATTACHMENT_CLEANUP_BATCH + 5; index += 1)
    await add(`orphan-${index}`, { status: "pending", createdAt: hoursAgo(48) });
  const env = files();
  const first = await cleanupAttachments(db, env, NOW);
  expect(first.abandonedUploadsRemoved).toBe(ATTACHMENT_CLEANUP_BATCH);
  const second = await cleanupAttachments(db, env, NOW);
  expect(second.abandonedUploadsRemoved).toBe(5);
  expect(await names()).toEqual([]);
});
