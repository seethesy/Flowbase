import type { Bindings } from "../bindings";
import { withDb } from "../db/client";
import type { RunWithDb } from "../hono";
import { registerIngestProcessing } from "../ingest/receipts";
import {
  registerNotifications,
  type NotificationOptions,
} from "../notifications/fanout";
import { registerInventoryPlanning } from "../records/inventory/allocations";
import { registerPlanning } from "../records/events/planning";
import { registerRecipeCostChanges } from "../records/kitchen/recipes";
import { registerBeoDocuments } from "../records/beo/beo-documents";
import { emitDueSoonTaskEvents, emitDueTaskEvents } from "../records/tasks/tasks";
import { emitPaymentReminders } from "../records/sales/payments";
import { scanCollectorHealth } from "../records/home/collector-health";
import { refreshUsage } from "../records/settings/usage";
import { cleanupAttachments } from "../attachments/cleanup";
import { cleanupJobs } from "./cleanup";
import { emitAddendumReminders } from "../records/sales/contracts";
import { scanProductionAlerts } from "../records/events/production-alerts";
import { registerGoogleCalendar, sweepGoogleCalendars } from "../records/events/google-calendar";
import { JobRegistry, runDueJobs, type RunOptions } from "./queue";

// Every job handler the Worker knows. New handlers register here.
export function createJobRegistry(options: NotificationOptions = {}) {
  const registry = new JobRegistry();
  registerIngestProcessing(registry);
  registerRecipeCostChanges(registry);
  registerBeoDocuments(registry);
  // Reservation conflicts and consumable allocations follow stock (FLOW-77, FLOW-85).
  registerInventoryPlanning(registry);
  // Start planning: one job per step (FLOW-133).
  registerPlanning(registry);
  // Notifications (FLOW-43): one subscriber per notification type, plus email.
  registerNotifications(registry, options);
  // Per-user Google Calendar copies (FLOW-268).
  registerGoogleCalendar(registry);
  registry.register("production.scan", async (job, { db }) => {
    const payload = job.payload as { eventId?: string } | null;
    await scanProductionAlerts(db, new Date(), payload?.eventId);
  });
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
    const addendumsDue = await emitAddendumReminders(db, now);
    const paymentReminders = await emitPaymentReminders(db, now);
    const productionAlerts = await scanProductionAlerts(db, now);
    await scanCollectorHealth(db, now);
    await refreshUsage(db, now);
    const googleSyncs = await sweepGoogleCalendars(db, now);
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
    return { tasksDue, tasksDueSoon, addendumsDue, paymentReminders, productionAlerts, googleSyncs, ...ran, ...cleaned };
  });
  console.log(JSON.stringify({ event: "jobs_run", ...summary }));
  return summary;
}
