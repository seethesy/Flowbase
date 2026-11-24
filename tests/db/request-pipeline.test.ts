import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { eq } from "drizzle-orm";
import type { JWTPayload } from "jose";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { createActorResolver } from "../../worker/auth";
import type { RunWithDb } from "../../worker/hono";

// FLOW-306 AC1: a GET by an active user opens one database connection and runs
// one auth query, with no transaction or row lock.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const statements: string[] = [];
const client = postgres(url, { max: 1, debug: (_connection, query) => { statements.push(String(query)); } });
const db = drizzle(client, { schema });
const userId = "30610000-0000-4000-8000-000000000001";
const sub = "30610000-0000-4000-8000-000000000002";
const verify = async (): Promise<JWTPayload> => ({ sub, email: "pipeline@example.test", user_metadata: { full_name: "Pipeline" } });
let connections = 0;
const withDb: RunWithDb = (_env, run) => {
  connections++;
  return run(db);
};
const app = createApp({ withDb, resolveActor: createActorResolver(withDb, verify) });
const get = (path: string) => app.request(path, { headers: { Authorization: "Bearer test-token" } }, { ASSETS: { fetch } });

beforeAll(async () => { await migrate(db, { migrationsFolder: "drizzle" }); });
beforeEach(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  connections = 0;
  statements.length = 0;
});
afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  await client.end();
});

const authQueries = () => statements.filter((query) => /from "users"/i.test(query));

it("serves an active user's GET with one connection and one plain auth query", async () => {
  await db.insert(schema.users).values({ id: userId, email: "pipeline@example.test", name: "Pipeline",
    role: "admin", mobile: "2025550100", status: "active", authId: sub, activatedAt: new Date() });
  statements.length = 0;
  connections = 0;
  const response = await get("/api/settings");
  expect(response.status).toBe(200);
  expect(connections).toBe(1);
  expect(authQueries()).toHaveLength(1);
  expect(statements.some((query) => /for update/i.test(query))).toBe(false);
  expect(statements.some((query) => /^\s*begin/i.test(query))).toBe(false);
});

it("still activates a first sign-in through the locked path", async () => {
  await db.insert(schema.users).values({ id: userId, email: "pipeline@example.test", name: "",
    role: "admin", mobile: "2025550100", status: "pending" });
  statements.length = 0;
  connections = 0;
  expect((await get("/api/settings")).status).toBe(200);
  expect(connections).toBe(1);
  expect(statements.some((query) => /for update/i.test(query))).toBe(true);
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  expect(row).toMatchObject({ status: "active", authId: sub, name: "Pipeline" });
  // The next request takes the plain lookup.
  statements.length = 0;
  expect((await get("/api/settings")).status).toBe(200);
  expect(authQueries()).toHaveLength(1);
});

it("refuses a deactivated account as before", async () => {
  await db.insert(schema.users).values({ id: userId, email: "pipeline@example.test", name: "Pipeline",
    role: "admin", mobile: "2025550100", status: "deactivated", authId: sub });
  const response = await get("/api/settings");
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("ACCOUNT_NOT_ALLOWED");
});
