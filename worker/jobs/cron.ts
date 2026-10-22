import type { Bindings } from "../bindings";
import { withDb } from "../db/client";
import type { RunWithDb } from "../hono";
import { registerIngestProcessing } from "../ingest/receipts";
import { JobRegistry, runDueJobs, type RunOptions } from "./queue";

// Every job handler the Worker knows. New handlers register here.
export function createJobRegistry() {
  const registry = new JobRegistry();
  registerIngestProcessing(registry);
  return registry;
}

// The single Cron Trigger (wrangler.jsonc) runs one batch of due jobs.
export async function runScheduledJobs(
  env: Bindings,
  registry: JobRegistry,
  options: RunOptions & { withDb?: RunWithDb } = {},
) {
  if (!env.HYPERDRIVE) {
    console.log(
      JSON.stringify({ event: "jobs_skipped", reason: "database_not_configured" }),
    );
    return;
  }
  const run: RunWithDb = options.withDb ?? withDb;
  const summary = await run(env, (db) => runDueJobs(db, registry, options));
  console.log(JSON.stringify({ event: "jobs_run", ...summary }));
  return summary;
}
