import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
import type { Bindings } from "../bindings";
import { DatabaseNotConfiguredError } from "./errors";

export type Db = PostgresJsDatabase<typeof schema>;

// One request-local client; Hyperdrive owns the pooled connections to the origin.
// max: 5 stays under the Workers limit on concurrent outbound connections, and
// fetch_types: false skips a type-lookup round trip (no array columns yet; revisit
// if a table adds one). Prepared statements stay on, as Hyperdrive requires.
export async function withDb<T>(
  env: Pick<Bindings, "HYPERDRIVE">,
  run: (db: Db) => Promise<T>,
): Promise<T> {
  if (!env.HYPERDRIVE) throw new DatabaseNotConfiguredError();
  const client = postgres(env.HYPERDRIVE.connectionString, {
    max: 5,
    fetch_types: false,
    connect_timeout: 5,
  });
  try {
    return await run(drizzle(client, { schema }));
  } finally {
    await client.end({ timeout: 1 });
  }
}
