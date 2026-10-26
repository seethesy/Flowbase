import { expect, it } from "vitest";
import { assertTestDatabaseUrl } from "./test-database";

it("accepts only local or CI test databases (FLOW-182 AC3)", () => {
  for (const url of [
    "postgres://flowbase:flowbase@localhost:5432/flowbase_ci",
    "postgres://u:p@127.0.0.1:5432/test",
    "postgres://u:p@[::1]:5432/test",
    "postgresql://u:p@postgres:5432/test",
  ])
    expect(assertTestDatabaseUrl(url)).toBe(url);

  expect(() => assertTestDatabaseUrl(undefined)).toThrow(/DATABASE_URL must point/);
  expect(() => assertTestDatabaseUrl("not a url")).toThrow(/not a valid connection string/);
  for (const url of [
    "postgresql://postgres.abc:secret@aws-0-us-east-1.pooler.supabase.com:5432/postgres",
    "postgres://u:p@db.example.com:5432/flowbase",
    "postgres://u:p@localhost.example.com/flowbase",
  ])
    expect(() => assertTestDatabaseUrl(url)).toThrow(/Refusing to run the DB tests/);
});
