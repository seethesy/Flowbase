import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
beforeAll(async () => {
  await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  // An isolated CI fixture exercises round trips before FLOW-24 adds real tables.
  await client`create schema ci_fixture`;
  await client`create table ci_fixture.records (id uuid primary key default gen_random_uuid(), name text not null)`;
  await client`alter table ci_fixture.records enable row level security`;
});
afterAll(async () => {
  await client`drop schema if exists ci_fixture cascade`;
  await client.end();
});
it("writes and reads through Postgres, rolling back a failed transaction", async () => {
  const [record] = await client`insert into ci_fixture.records (name) values ('CI record') returning id, name`;
  expect(record.id).toMatch(/^[0-9a-f-]{36}$/);
  const [read] = await client`select name from ci_fixture.records where id = ${record.id}`;
  expect(read.name).toBe("CI record");
  await expect(client.begin(async (tx) => {
    await tx`update ci_fixture.records set name = 'Should roll back' where id = ${record.id}`;
    throw new Error("rollback fixture");
  })).rejects.toThrow("rollback fixture");
  expect((await client`select name from ci_fixture.records where id = ${record.id}`)[0].name).toBe("CI record");
});
it("checks RLS through pg_class and rejects browser-facing policies", async () => {
  const fixture = await client`select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'ci_fixture' and c.relname = 'records'`;
  expect(fixture).toHaveLength(1);
  expect(fixture[0].relrowsecurity).toBe(true);
  const unprotected = await client`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity`;
  expect([...unprotected]).toEqual([]);
  const browserPolicies = await client`select policyname from pg_policies where schemaname = 'public' and roles && array['public', 'anon', 'authenticated']::name[]`;
  expect([...browserPolicies]).toEqual([]);
});
