import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { assertTestDatabaseUrl } from "./test-database";

// Runs once per `npm run test:db` (FLOW-182): every run starts from an empty
// public schema with the committed migrations applied once, so the suite passes
// again on the same database.
export default async function setup() {
  const url = assertTestDatabaseUrl(process.env.DATABASE_URL);
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  try {
    await client`drop schema if exists drizzle cascade`;
    await client`drop schema if exists ci_fixture cascade`;
    await client`drop schema if exists public cascade`;
    await client`create schema public`;
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
  } finally {
    await client.end();
  }
}
