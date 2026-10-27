import { describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { assertSeedDatabaseUrl, seedDatabase } from "../../worker/db/seed";

vi.mock("postgres", () => ({
  default: vi.fn(() => {
    throw new Error("Connection must not be attempted.");
  }),
}));

describe("development seed destination guard", () => {
  it.each([
    "postgres://postgres:public@db.lfsznrmrzxiohzydetbd.supabase.co/postgres",
    "postgres://postgres.lfsznrmrzxiohzydetbd:public@aws-0-us-east-1.pooler.supabase.com/postgres",
    "postgres://postgres.lfsznrmrzxiohzydetbd:public@localhost/postgres",
    "postgres://postgres:public@unknown.example/postgres",
    "https://localhost/postgres",
    "postgres://postgres.qlnjdckcrawrcgcoecpl:public@aws-0-us-east-1.pooler.supabase.com/postgres?user=postgres.lfsznrmrzxiohzydetbd",
    "postgres://postgres.qlnjdckcrawrcgcoecpl:public@aws-0-us-east-1.pooler.supabase.com/postgres?%75ser=postgres.lfsznrmrzxiohzydetbd",
    "postgres://flowbase:flowbase@localhost/flowbase_ci?database=production",
  ])(
    "refuses production and unrecognized targets before opening a connection: %s",
    async (url) => {
      expect(() => assertSeedDatabaseUrl(url)).toThrow("Refusing to seed");
      await expect(seedDatabase(url)).rejects.toThrow("Refusing to seed");
      expect(postgres).not.toHaveBeenCalled();
    },
  );
  it.each([
    "postgres://flowbase:flowbase@localhost/flowbase_ci",
    "postgres://flowbase:flowbase@localhost/flowbase_ci?sslmode=disable&application_name=flowbase-seed",
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
