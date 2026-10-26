import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { jobs } from "../../worker/db/schema";
import { postgresErrorCode } from "../../worker/db/errors";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor } from "../../shared/access";

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
// Two connections, so two requests can run their transactions at the same time.
const client = postgres(url, { max: 2 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };
const admin: Actor = {
  userId: "b0000000-0000-4000-8000-000000000001",
  role: "admin",
  employmentType: "full_time",
};
const app = createApp({ withDb, resolveActor: async () => admin });

// Runs the statements in a transaction that is always rolled back, so a test
// leaves no rows behind (the default inventory sections stay untouched).
const rolledBack = (run: (tx: postgres.TransactionSql) => Promise<unknown>) =>
  client.begin(async (tx) => {
    await run(tx);
    throw new Error("rolled back");
  });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items, ingest_receipts, jobs`,
  );
});
afterAll(async () => {
  await client.end();
});

describe("CHECK constraints (FLOW-187 AC1)", () => {
  it("rejects an unknown status written directly in SQL", async () => {
    await expect(
      client`insert into jobs (type, payload, idempotency_key, status) values ('test', '{}', 'unknown-status', 'paused')`,
    ).rejects.toThrow(/jobs_status_check/);
    await expect(
      rolledBack(async (tx) => {
        const [row] = await tx`insert into clients (name, kind) values ('Check Client', 'person') returning id`;
        await tx`insert into events (title, starts_at, client_id, status) values ('Check Event', now(), ${row.id}, 'tentative')`;
      }),
    ).rejects.toThrow(/events_status_check/);
    await expect(
      rolledBack((tx) => tx`insert into clients (name, kind) values ('Check Client', 'robot')`),
    ).rejects.toThrow(/clients_kind_check/);
  });

  it("accepts known values and NULL in nullable enum columns", async () => {
    await client`insert into jobs (type, payload, idempotency_key, status) values ('test', '{}', 'known-status', 'pending')`;
    await expect(
      rolledBack((tx) => tx`insert into venues (name, jurisdiction) values ('No Jurisdiction', null), ('In DC', 'DC')`),
    ).rejects.toThrow("rolled back");
  });

  it("rejects negative stock written directly in SQL", async () => {
    await expect(
      rolledBack(async (tx) => {
        const [item] = await tx`insert into inventory_items (kind, subtype, name) values ('rental', 'furniture', 'Check Chair') returning id`;
        const [section] = await tx`insert into inventory_sections (name, kind) values ('Check Section', 'rental') returning id`;
        await tx`insert into inventory_stock (item_id, section_id, quantity) values (${item.id}, ${section.id}, -1)`;
      }),
    ).rejects.toThrow(/inventory_stock_quantity_check/);
  });

  it("reports the SQLSTATE through Drizzle's wrapped error", async () => {
    const values = { type: "test", payload: {}, idempotencyKey: "same-key" };
    await db.insert(jobs).values(values);
    const unique = await db.insert(jobs).values(values).catch((error: unknown) => error);
    expect(postgresErrorCode(unique)).toBe("23505");
    const invalid = await db
      .insert(jobs)
      .values({ ...values, idempotencyKey: "other-key", status: "paused" as never })
      .catch((error: unknown) => error);
    expect(postgresErrorCode(invalid)).toBe("23514");
  });
});

describe("unique violations (FLOW-187 AC2)", () => {
  it("answers 409, not 500, to the second of two concurrent creates with the same code", async () => {
    const create = () =>
      app.request(
        "/api/inventory/items",
        {
          method: "POST",
          body: JSON.stringify({
            kind: "rental",
            subtype: "furniture",
            code: "CH-RACE",
            name: "Race Chair",
          }),
          headers: { "Content-Type": "application/json" },
        },
        env,
      );
    const responses = await Promise.all([create(), create()]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    const conflict = responses.find((r) => r.status === 409)!;
    const body = (await conflict.json()) as { error: { code: string } };
    // DUPLICATE_CODE when the code check sees the first row, ALREADY_EXISTS when
    // both pass it and the unique index rejects the second insert.
    expect(["DUPLICATE_CODE", "ALREADY_EXISTS"]).toContain(body.error.code);
  });
});
