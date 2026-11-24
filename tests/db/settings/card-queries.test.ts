import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import { applyCardQuery, parseCardQuery } from "../../worker/fields";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, Role } from "../../shared/access";
import { projectRecord } from "../../shared/fields";

// FLOW-308: a custom card runs as one list query with its filters, sort and
// LIMIT in SQL, and returns the rows the in-memory card query returned before.
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const queries: { sql: string; params: unknown[] }[] = [];
const db = drizzle(client, {
  schema,
  logger: { logQuery: (query, params) => queries.push({ sql: query, params }) },
});
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const people = {
  admin: "30800000-0000-4000-8000-000000000001",
  sam: "30800000-0000-4000-8000-000000000002",
  riley: "30800000-0000-4000-8000-000000000003",
};
const actors: Record<"admin" | "sam", Actor> = {
  admin: { userId: people.admin, role: "admin" },
  sam: { userId: people.sam, role: "salesperson" },
};
const as = (actor: Actor) => {
  const app = createApp({ withDb, resolveActor: async () => actor });
  return async (path: string) => {
    const response = await app.request(path, {}, env);
    expect(response.status).toBe(200);
    return (await response.json()) as Record<string, unknown>[];
  };
};
const statuses = ["inquiry", "pitching", "p_sent"] as const;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(sql`truncate table leads, audit_log, jobs, users cascade`);
  await db.insert(schema.users).values(
    ([["admin", "admin"], ["sam", "salesperson"], ["riley", "salesperson"]] as const).map(([name, role], i) => ({
      id: people[name],
      email: `${name}@card-queries.example`,
      name: name[0].toUpperCase() + name.slice(1),
      role: role as Role,
      mobile: `20255574${i}`,
      status: "active" as const,
    })),
  );
  // 36 leads: three statuses, guest counts with ties, half of them Sam's.
  await db.insert(schema.leads).values(
    Array.from({ length: 36 }, (_, i) => ({
      channel: "manual" as const,
      source: i % 2 ? "Phone" : "Website",
      name: `${i % 3 ? "lead" : "Lead"} ${String(i).padStart(2, "0")}`,
      status: statuses[i % 3],
      guestCount: i % 4 === 0 ? null : (i % 9) * 10,
      budgetCents: 1_000 * (36 - i),
      eventDate: `2026-12-${String((i % 28) + 1).padStart(2, "0")}`,
      assignedSalespersonId: i % 2 ? people.sam : people.riley,
      receivedAt: new Date(Date.UTC(2026, 10, 1, 12, i)),
    })),
  );
  queries.length = 0;
});
afterAll(async () => {
  await client.end();
});

// The same card the old way: every lead the viewer may see, then the card
// applied in memory.
async function expected(actor: Actor, params: Record<string, string>) {
  const all = await as(actor)("/api/leads?limit=500");
  const card = parseCardQuery("leads", new URLSearchParams(params))!;
  const fields = params.fields.split(",");
  return applyCardQuery(actor, "leads", all, card).map((row) => projectRecord(actor, "leads", row, fields));
}
const cardPath = (params: Record<string, string>) => `/api/leads?${new URLSearchParams(params)}`;
// Selects that read leads rows with a row limit: the card's own list query.
const leadReads = () => queries.filter((query) => /from "leads"/.test(query.sql) && /\blimit \$\d+/i.test(query.sql));

it("AC1: filters, a sort and take 10 run as one query with LIMIT 10", async () => {
  const params = {
    fields: "name,status,guestCount",
    where: JSON.stringify([
      { field: "status", op: "is_not", value: "p_sent" },
      { field: "guestCount", op: "after", value: 10 },
    ]),
    orderBy: "guestCount:desc",
    take: "10",
  };
  const rows = await as(actors.admin)(cardPath(params));
  const reads = leadReads();
  expect(reads).toHaveLength(1);
  expect(reads[0].params.at(-1)).toBe(10);
  expect(rows).toHaveLength(10);
  // AC2: the same rows in the same order as reading every lead and filtering here.
  expect(rows).toEqual(await expected(actors.admin, params));
});

it("AC2: text, date and person filters and sorts return the same rows as before", async () => {
  const cases: Record<string, string>[] = [
    { fields: "name", orderBy: "name:asc", take: "7" },
    { fields: "name", orderBy: "name:desc", take: "7" },
    { fields: "name,eventDate", where: JSON.stringify([{ field: "eventDate", op: "before", value: "2026-12-10" }]), orderBy: "eventDate:asc", take: "12" },
    { fields: "name", where: JSON.stringify([{ field: "name", op: "contains", value: "LEAD 1" }]), take: "20" },
    { fields: "name", where: JSON.stringify([{ field: "guestCount", op: "is_empty" }]), orderBy: "receivedAt:asc", take: "5" },
    { fields: "name", where: JSON.stringify([{ field: "assignedSalespersonId", op: "is", value: people.sam }]), take: "4" },
    { fields: "name", where: JSON.stringify([{ field: "status", op: "is", value: "PITCHING" }]), take: "100" },
  ];
  for (const params of cases) {
    queries.length = 0;
    const rows = await as(actors.admin)(cardPath(params));
    expect(leadReads()).toHaveLength(1);
    expect(leadReads()[0].params.at(-1)).toBe(Number(params.take));
    expect(rows).toEqual(await expected(actors.admin, params));
  }
});

it("AC3: a field the viewer can't read filters and sorts as empty, as before", async () => {
  // A salesperson reads the budget on their own leads only.
  const params = { fields: "name,budgetCents", orderBy: "budgetCents:desc", take: "5" };
  const rows = await as(actors.sam)(cardPath(params));
  expect(rows).toEqual(await expected(actors.sam, params));
  for (const row of rows) expect(row.budgetCents).toEqual(expect.any(Number));
  // Sorting on a hidden-on-some-rows field reads one page in memory, not take rows.
  queries.length = 0;
  await as(actors.sam)(cardPath(params));
  expect(leadReads()).toHaveLength(1);
  expect(leadReads()[0].params.at(-1)).toBe(500);
});
