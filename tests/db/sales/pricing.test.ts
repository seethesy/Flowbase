import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../../worker/db/schema";
import { createApp } from "../../../worker/app";
import type { RunWithDb } from "../../../worker/hono";
import type { Actor, Role } from "../../../shared/access";
import type { PriceInput, PriceItem } from "../../../shared/pricing";

// Sales › Pricing's price list (FLOW-329) against the CI Postgres service,
// through the real API.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const signedInAs = (userId: string, role: Role) => {
  const actor: Actor = { userId, role, employmentType: "full_time" };
  const app = createApp({ withDb, resolveActor: async () => actor });
  return async (path: string, method = "GET", body?: unknown) => {
    const response = await app.request(path, {
      method,
      ...(body !== undefined && { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    }, env);
    return { status: response.status, json: await response.json() };
  };
};
const admin = signedInAs("a3290000-0000-4000-8000-000000000001", "admin");
const salesperson = signedInAs("a3290000-0000-4000-8000-000000000002", "salesperson");
const kitchenLead = signedInAs("a3290000-0000-4000-8000-000000000003", "kitchen_lead");

const buffet: PriceInput = { name: "Buffet package", category: "package", basis: "per_guest", amount: 4500, description: "Two entrées, three sides." };
const serviceFee: PriceInput = { name: "Service charge", category: "fee", basis: "percent", amount: 1800 };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(sql`truncate table price_list_items, audit_log`);
});
afterAll(async () => {
  await client.end();
});

describe("price list (FLOW-329)", () => {
  it("lets the Admin add, edit and archive prices, each audited", async () => {
    const created = await admin("/api/pricing", "POST", buffet);
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const price = created.json as PriceItem;
    expect(price).toMatchObject({ name: "Buffet package", category: "package", basis: "per_guest", amount: 4500 });
    expect((await admin("/api/pricing", "POST", serviceFee)).status).toBe(201);

    const edited = await admin(`/api/pricing/${price.id}`, "PUT", { ...buffet, amount: 5000 });
    expect(edited.status).toBe(200);
    expect((edited.json as PriceItem).amount).toBe(5000);

    const list = await salesperson("/api/pricing");
    expect(list.status).toBe(200);
    // By category key, then name.
    expect((list.json as PriceItem[]).map((row) => row.name)).toEqual(["Service charge", "Buffet package"]);

    expect((await admin(`/api/pricing/${price.id}/archive`, "POST", {})).status).toBe(200);
    expect(((await salesperson("/api/pricing")).json as PriceItem[]).map((row) => row.name)).toEqual(["Service charge"]);
    expect((await admin(`/api/pricing/${price.id}/restore`, "POST", {})).status).toBe(200);
    expect(((await salesperson("/api/pricing")).json as PriceItem[])).toHaveLength(2);

    const audit = await db.select({ action: schema.auditLog.action }).from(schema.auditLog)
      .where(and(eq(schema.auditLog.entityType, "price_list_item"), eq(schema.auditLog.entityId, price.id)));
    expect(audit.map((row) => row.action).sort()).toEqual(["archive", "create", "restore", "update"]);
  });

  it("is read by roles that read proposals and kept by the Admin only", async () => {
    expect((await salesperson("/api/pricing")).status).toBe(200);
    expect((await kitchenLead("/api/pricing")).status).toBe(403);
    expect((await salesperson("/api/pricing", "POST", buffet)).status).toBe(403);
    const created = (await admin("/api/pricing", "POST", buffet)).json as PriceItem;
    expect((await salesperson(`/api/pricing/${created.id}`, "PUT", buffet)).status).toBe(403);
    expect((await salesperson(`/api/pricing/${created.id}/archive`, "POST", {})).status).toBe(403);
  });

  it("refuses a nameless or negative price and an unknown id", async () => {
    expect((await admin("/api/pricing", "POST", { ...buffet, name: " " })).status).toBe(400);
    expect((await admin("/api/pricing", "POST", { ...buffet, amount: -1 })).status).toBe(400);
    expect((await admin("/api/pricing", "POST", { ...buffet, category: "discount" })).status).toBe(400);
    expect((await admin("/api/pricing/0b9e7a8e-0000-4000-8000-000000000000", "PUT", buffet)).status).toBe(404);
  });
});
