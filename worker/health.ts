import postgres from "postgres";
import type { Bindings } from "./bindings";
import type { DatabaseStatus } from "../shared/api";

// One request-local client. Hyperdrive owns the actual origin connection pool.
export async function checkDatabase(env: Bindings): Promise<DatabaseStatus> {
  if (!env.HYPERDRIVE) return "not_configured";
  const sql = postgres(env.HYPERDRIVE.connectionString, {
    max: 1,
    connect_timeout: 3,
    idle_timeout: 1,
  });
  try {
    await sql`select 1`;
    return "reachable";
  } catch {
    return "unreachable";
  } finally {
    await sql.end({ timeout: 1 });
  }
}
