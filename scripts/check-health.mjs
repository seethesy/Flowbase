// Fails the production deploy unless the new version reports a reachable
// database (FLOW-173). Workers Builds keeps serving the previous version when a
// deploy fails, and a Worker without its database still answers /api/health with
// 200, so the status code alone proves nothing: the body must say
// `"database":"reachable"`.
//
// Usage: node scripts/check-health.mjs
// Environment (all optional):
//   HEALTH_URL       base URL to check (default: the production Worker)
//   HEALTH_ATTEMPTS  tries before giving up (default 8)
//   HEALTH_RETRY_MS  wait between tries, while the new version activates (default 5000)
import { pathToFileURL } from "node:url";

export const DEFAULT_URL = "https://flowbase.sybertechlabs.workers.dev";
const REQUEST_TIMEOUT_MS = 10_000;

// Returns { ok, attempts, status } where status describes the last try.
export async function checkHealth({
  url = DEFAULT_URL,
  attempts = 8,
  delayMs = 5000,
  fetchImpl = fetch,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  log = () => {},
} = {}) {
  const target = new URL("/api/health", url).href;
  let status = "no attempt made";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(target, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.database === "reachable")
        return { ok: true, attempts: attempt, status: "database reachable" };
      status = `HTTP ${response.status}, database: ${body.database ?? "missing"}`;
    } catch (error) {
      status = `request failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    log(`Health check ${attempt}/${attempts} failed (${status}).`);
    if (attempt < attempts) await sleep(delayMs);
  }
  return { ok: false, attempts, status };
}

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.error(`${name} must be a whole number, got "${raw}".`);
    process.exit(2);
  }
  return value;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const url = process.env.HEALTH_URL || DEFAULT_URL;
  const result = await checkHealth({
    url,
    attempts: Math.max(positiveInteger("HEALTH_ATTEMPTS", 8), 1),
    delayMs: positiveInteger("HEALTH_RETRY_MS", 5000),
    log: (message) => console.error(message),
  });
  if (!result.ok) {
    console.error(
      `Deploy verification failed: ${url}/api/health did not report "database":"reachable" ` +
        `after ${result.attempts} tries (${result.status}). The new version is live but ` +
        `cannot reach its database; roll back with "npx wrangler rollback --env production".`,
    );
    process.exit(1);
  }
  console.log(`Deploy verified: ${url}/api/health reports the database reachable.`);
}
