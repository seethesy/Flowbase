import postgres from "postgres";
import type { Bindings } from "./bindings";
import type { DatabaseStatus } from "../shared/api";

const CACHE_MS = 30_000;
let cached: { connectionString: string; expires: number; result: Promise<DatabaseStatus> } | undefined;

// One request-local client. Hyperdrive owns the actual origin connection pool.
export async function checkDatabase(env: Bindings): Promise<DatabaseStatus> {
  if (!env.HYPERDRIVE) return "not_configured";
  const connectionString = env.HYPERDRIVE.connectionString;
  if (cached?.connectionString === connectionString && cached.expires > Date.now())
    return cached.result;
  const result = probeDatabase(connectionString);
  cached = { connectionString, expires: Date.now() + CACHE_MS, result };
  return result;
}

async function probeDatabase(connectionString: string): Promise<DatabaseStatus> {
  const sql = postgres(connectionString, {
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
