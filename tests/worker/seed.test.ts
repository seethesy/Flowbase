import { describe, expect, it } from "vitest";
import { assertSeedDatabaseUrl } from "../../worker/db/seed";

describe("development seed destination guard", () => {
  it.each([
    "postgres://postgres:public@db.lfsznrmrzxiohzydetbd.supabase.co/postgres",
    "postgres://postgres.lfsznrmrzxiohzydetbd:public@aws-0-us-east-1.pooler.supabase.com/postgres",
    "postgres://postgres.lfsznrmrzxiohzydetbd:public@localhost/postgres",
    "postgres://postgres:public@unknown.example/postgres",
    "https://localhost/postgres",
  ])(
    "refuses production and unrecognized targets before opening a connection: %s",
    (url) => {
      expect(() => assertSeedDatabaseUrl(url)).toThrow("Refusing to seed");
    },
  );
  it.each([
    "postgres://flowbase:flowbase@localhost/flowbase_ci",
    "postgresql://postgres:public@db.qlnjdckcrawrcgcoecpl.supabase.co/postgres",
    "postgres://postgres.qlnjdckcrawrcgcoecpl:public@aws-0-us-east-1.pooler.supabase.com/postgres",
  ])("accepts local/CI and the known development project: %s", (url) => {
    expect(assertSeedDatabaseUrl(url)).toBe(url);
    expect(() => assertSeedDatabaseUrl(url, "production")).toThrow(
      "Refusing to seed",
    );
  });
  it("refuses missing configuration", () => {
    expect(() => assertSeedDatabaseUrl(undefined)).toThrow("DATABASE_URL");
  });
});
