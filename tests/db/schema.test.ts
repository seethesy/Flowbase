import { afterAll, beforeAll, expect, it } from "vitest";
import postgres from "postgres";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { withDb } from "../../worker/db/client";
import {
  createConnectionCheck,
  listConnectionChecks,
} from "../../worker/db/connection-checks";

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
afterAll(async () => {
  await client`delete from public.connection_checks`;
  await client.end();
});

it("creates connection_checks with the base column conventions", async () => {
  const rows = await client`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = 'connection_checks'`;
  const columns = Object.fromEntries(rows.map((r) => [r.column_name, r]));
  expect(columns.id).toMatchObject({ data_type: "uuid", is_nullable: "NO" });
  expect(columns.id.column_default).toContain("gen_random_uuid()");
  for (const name of ["created_at", "updated_at"]) {
    expect(columns[name]).toMatchObject({
      data_type: "timestamp with time zone",
      is_nullable: "NO",
    });
    expect(columns[name].column_default).toContain("now()");
  }
  expect(columns.archived_at).toMatchObject({
    data_type: "timestamp with time zone",
    is_nullable: "YES",
  });
  for (const name of ["created_by", "updated_by"])
    expect(columns[name]).toMatchObject({
      data_type: "uuid",
      is_nullable: "YES",
    });
  expect(columns.note).toMatchObject({ data_type: "text", is_nullable: "NO" });
});
it("enables RLS on the migrated table and defines no policies for it", async () => {
  const table = await client`select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = 'connection_checks'`;
  expect(table).toHaveLength(1);
  expect(table[0].relrowsecurity).toBe(true);
  const policies = await client`select policyname from pg_policies where schemaname = 'public' and tablename = 'connection_checks'`;
  expect([...policies]).toEqual([]);
});
it("round trips rows, maintains updated_at and honors soft delete", async () => {
  const created = await createConnectionCheck(db, "round trip");
  expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
  expect(Number.isNaN(Date.parse(created.createdAt))).toBe(false);
  expect((await listConnectionChecks(db)).map((c) => c.id)).toContain(
    created.id,
  );

  const [before] = await db
    .select()
    .from(schema.connectionChecks)
    .where(eq(schema.connectionChecks.id, created.id));
  await new Promise((resolve) => setTimeout(resolve, 25));
  await db
    .update(schema.connectionChecks)
    .set({ note: "edited" })
    .where(eq(schema.connectionChecks.id, created.id));
  const [after] = await db
    .select()
    .from(schema.connectionChecks)
    .where(eq(schema.connectionChecks.id, created.id));
  expect(after.note).toBe("edited");
  expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());

  await db
    .update(schema.connectionChecks)
    .set({ archivedAt: new Date() })
    .where(eq(schema.connectionChecks.id, created.id));
  expect((await listConnectionChecks(db)).map((c) => c.id)).not.toContain(
    created.id,
  );
});
it("withDb reads and writes using the binding's connection string", async () => {
  const note = `via withDb ${crypto.randomUUID()}`;
  const created = await withDb({ HYPERDRIVE: { connectionString: url } }, (d) =>
    createConnectionCheck(d, note),
  );
  const listed = await withDb({ HYPERDRIVE: { connectionString: url } }, (d) =>
    listConnectionChecks(d),
  );
  expect(listed.find((c) => c.id === created.id)?.note).toBe(note);
});
