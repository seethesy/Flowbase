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
import { emitDueSoonTaskEvents, emitDueTaskEvents } from "../records/tasks";
import { emitPaymentReminders } from "../records/payments";
import { scanCollectorHealth } from "../records/collector-health";
import { refreshUsage } from "../records/usage";
import { cleanupAttachments } from "../attachments/cleanup";
import { cleanupJobs } from "./cleanup";
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
// (FLOW-58) or will soon (FLOW-60), runs one batch of due jobs, then prunes old
// jobs, ingest bodies and abandoned or archived files.
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
    const now = options.now?.() ?? new Date();
    const tasksDue = await emitDueTaskEvents(db, now);
    const tasksDueSoon = await emitDueSoonTaskEvents(db, now);
    const paymentReminders = await emitPaymentReminders(db, now);
    await scanCollectorHealth(db, now);
    await refreshUsage(db, now);
    const ran = await runDueJobs(db, registry, { ...options, env });
    // Housekeeping runs after the batch so it never delays real work (FLOW-184,
    // FLOW-188). A failure is logged and retried on the next run.
    let cleaned = {};
    try {
      cleaned = {
        ...(await cleanupJobs(db, now)),
        ...(await cleanupAttachments(db, env, now)),
      };
    } catch (error) {
      console.log(
        JSON.stringify({
          event: "cleanup_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    return { tasksDue, tasksDueSoon, paymentReminders, ...ran, ...cleaned };
  });
  console.log(JSON.stringify({ event: "jobs_run", ...summary }));
  return summary;
}
