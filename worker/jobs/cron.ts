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
import { flushUsage, providerMetricsConfigured, refreshUsage, storeProviderMetrics } from "../records/settings/usage";
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

// Which sweeps a tick runs (FLOW-307), from the tick's scheduled time, never the
// clock: every 5 minutes the due-task sweeps, the job batch and the Google
// Calendar sweep; at :00, :15, :30 and :45 also the full production-alert scan;
// at :00 also reminders, collector health, usage and cleanup. Every sweep is
// state-based and idempotent, so a slower cadence only delays it. `everything`
// (tests, manual runs, and any run without a scheduled time) runs them all.
export type TickWork = { productionScan: boolean; hourly: boolean };
export function tickWork(scheduledTime?: number, everything = false): TickWork {
  if (everything || scheduledTime === undefined || !Number.isFinite(scheduledTime))
    return { productionScan: true, hourly: true };
  const minute = new Date(Math.round(scheduledTime / 60_000) * 60_000).getUTCMinutes();
  return { productionScan: minute % 15 === 0, hourly: minute === 0 };
}

export type ScheduledOptions = RunOptions & {
  withDb?: RunWithDb;
  // The Cron Trigger's controller.scheduledTime (ms).
  scheduledTime?: number;
  everything?: boolean;
  // The Cloudflare Analytics read (FLOW-305); global fetch by default.
  fetch?: typeof fetch;
};

// The single Cron Trigger (wrangler.jsonc). Queued jobs run right after the
// due-task sweeps, before any scan, and each sweep has its own try/catch so one
// failure never blocks the job batch or the other sweeps (FLOW-307). A failed
// sweep is logged and runs again on its next tick.
export async function runScheduledJobs(
  env: Bindings,
  registry: JobRegistry,
  options: ScheduledOptions = {},
) {
  if (!env.HYPERDRIVE) {
    console.log(
      JSON.stringify({ event: "jobs_skipped", reason: "database_not_configured" }),
    );
    return;
  }
  const run: RunWithDb = options.withDb ?? withDb;
  const work = tickWork(options.scheduledTime, options.everything);
  const summary = await run(env, async (db) => {
    const now = options.now?.() ?? new Date();
    const failedSweeps: string[] = [];
    const sweep = async <T>(name: string, task: () => Promise<T>): Promise<T | undefined> => {
      try {
        return await task();
      } catch (error) {
        failedSweeps.push(name);
        console.log(
          JSON.stringify({
            event: "sweep_failed",
            sweep: name,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        return undefined;
      }
    };
    const tasksDue = await sweep("tasks_due", () => emitDueTaskEvents(db, now));
    const tasksDueSoon = await sweep("tasks_due_soon", () => emitDueSoonTaskEvents(db, now));
    const ran = await sweep("jobs", () => runDueJobs(db, registry, { ...options, env }));
    const googleSyncs = await sweep("google_calendar", () => sweepGoogleCalendars(db, now));
    const productionAlerts = work.productionScan
      ? await sweep("production_alerts", () => scanProductionAlerts(db, now)) : undefined;
    let hourly = {};
    const provider = providerMetricsConfigured(env);
    if (work.hourly) {
      const addendumsDue = await sweep("addendum_reminders", () => emitAddendumReminders(db, now));
      const paymentReminders = await sweep("payment_reminders", () => emitPaymentReminders(db, now));
      await sweep("collector_health", () => scanCollectorHealth(db, now));
      // Today's requests and queries from Cloudflare, or this isolate's estimate.
      if (provider) await sweep("provider_usage", () => storeProviderMetrics(db, env, now, options.fetch));
      else await sweep("usage_flush", () => flushUsage(db));
      await sweep("usage", () => refreshUsage(db, now, { provider }));
      // Housekeeping (FLOW-184, FLOW-188).
      const cleaned = await sweep("cleanup", async () => ({
        ...(await cleanupJobs(db, now)),
        ...(await cleanupAttachments(db, env, now)),
      }));
      hourly = { addendumsDue, paymentReminders, ...cleaned };
    }
    // Every run ends by writing the isolate's pending counts (FLOW-305).
    if (!provider) await sweep("usage_flush", () => flushUsage(db));
    return { tasksDue, tasksDueSoon, googleSyncs, productionAlerts, ...hourly, ...ran,
      ...(failedSweeps.length ? { failedSweeps } : {}) };
  });
  console.log(JSON.stringify({ event: "jobs_run", ...work, ...summary }));
  return summary;
}
