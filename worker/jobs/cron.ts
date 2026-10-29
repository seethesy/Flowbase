import type { Bindings } from "../bindings";
import { withDb } from "../db/client";
import type { RunWithDb } from "../hono";
import { registerIngestProcessing } from "../ingest/receipts";
import {
  registerNotifications,
  type NotificationOptions,
} from "../notifications/fanout";
import { registerInventoryPlanning } from "../records/allocations";
import { registerRecipeCostChanges } from "../records/recipes";
import { emitDueTaskEvents } from "../records/tasks";
import { JobRegistry, runDueJobs, type RunOptions } from "./queue";

// Every job handler the Worker knows. New handlers register here.
export function createJobRegistry(options: NotificationOptions = {}) {
  const registry = new JobRegistry();
  registerIngestProcessing(registry);
  registerRecipeCostChanges(registry);
  // Reservation conflicts and consumable allocations follow stock (FLOW-77, FLOW-85).
  registerInventoryPlanning(registry);
  // Notifications (FLOW-43): one subscriber per notification type, plus email.
  registerNotifications(registry, options);
  return registry;
}

// The single Cron Trigger (wrangler.jsonc) announces tasks that came due
// (FLOW-58), then runs one batch of due jobs.
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
  const summary = await run(env, async (db) => {
    const tasksDue = await emitDueTaskEvents(db, options.now?.() ?? new Date());
    return {
      tasksDue,
      ...(await runDueJobs(db, registry, { ...options, env })),
    };
  });
  console.log(JSON.stringify({ event: "jobs_run", ...summary }));
  return summary;
}
