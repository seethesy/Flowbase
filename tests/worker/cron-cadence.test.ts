// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import type { Db } from "../../worker/db/client";
import type { RunWithDb } from "../../worker/hono";

const { sweeps, partial } = vi.hoisted(() => {
  const sweeps = {
    emitDueTaskEvents: vi.fn(async () => 0),
    emitDueSoonTaskEvents: vi.fn(async () => 0),
    emitAddendumReminders: vi.fn(async () => 0),
    emitPaymentReminders: vi.fn(async () => 0),
    scanProductionAlerts: vi.fn(async () => 0),
    scanCollectorHealth: vi.fn(async () => undefined),
    refreshUsage: vi.fn(async () => []),
    flushUsage: vi.fn(async () => 0),
    storeProviderMetrics: vi.fn(async () => true),
    sweepGoogleCalendars: vi.fn(async () => 0),
    runDueJobs: vi.fn(async () => ({ skipped: 0, claimed: 0, succeeded: 0, failed: 0, retried: 0 })),
    cleanupJobs: vi.fn(async () => ({})),
    cleanupAttachments: vi.fn(async () => ({})),
  };
  // Keeps a module's other exports and swaps in the named sweeps.
  const partial = (names: (keyof typeof sweeps)[]) =>
    async (original: () => Promise<Record<string, unknown>>) => ({
      ...(await original()),
      ...Object.fromEntries(names.map((name) => [name, sweeps[name]])),
    });
  return { sweeps, partial };
});
vi.mock("../../worker/records/tasks/tasks", partial(["emitDueTaskEvents", "emitDueSoonTaskEvents"]));
vi.mock("../../worker/records/sales/contracts", partial(["emitAddendumReminders"]));
vi.mock("../../worker/records/sales/payments", partial(["emitPaymentReminders"]));
vi.mock("../../worker/records/events/production-alerts", partial(["scanProductionAlerts"]));
vi.mock("../../worker/records/home/collector-health", partial(["scanCollectorHealth"]));
vi.mock("../../worker/records/settings/usage", partial(["refreshUsage", "flushUsage", "storeProviderMetrics"]));
vi.mock("../../worker/records/events/google-calendar", partial(["sweepGoogleCalendars"]));
vi.mock("../../worker/jobs/queue", partial(["runDueJobs"]));
vi.mock("../../worker/jobs/cleanup", partial(["cleanupJobs"]));
vi.mock("../../worker/attachments/cleanup", partial(["cleanupAttachments"]));

import { JobRegistry } from "../../worker/jobs/queue";
import { runScheduledJobs, tickWork } from "../../worker/jobs/cron";

const env = { ASSETS: { fetch }, HYPERDRIVE: { connectionString: "postgres://unused" } };
const withDb: RunWithDb = (_env, run) => run({} as Db);
const at = (time: string) => Date.parse(`2026-11-24T${time}:00.000Z`);
const run = (options: Parameters<typeof runScheduledJobs>[2] = {}) =>
  runScheduledJobs(env, new JobRegistry(), { withDb, ...options });
const called = () => Object.fromEntries(Object.entries(sweeps).map(([name, fn]) => [name, fn.mock.calls.length > 0]));

beforeEach(() => {
  for (const fn of Object.values(sweeps)) fn.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

it("decides each tick's work from its scheduled time (FLOW-307 AC1)", () => {
  expect(tickWork(at("10:05"))).toEqual({ productionScan: false, hourly: false });
  expect(tickWork(at("10:15"))).toEqual({ productionScan: true, hourly: false });
  expect(tickWork(at("10:30"))).toEqual({ productionScan: true, hourly: false });
  expect(tickWork(at("10:00"))).toEqual({ productionScan: true, hourly: true });
  // A few seconds' jitter in the scheduled time doesn't move the tick.
  expect(tickWork(at("10:00") - 2_000)).toEqual({ productionScan: true, hourly: true });
  expect(tickWork(at("10:05"), true)).toEqual({ productionScan: true, hourly: true });
  expect(tickWork(undefined)).toEqual({ productionScan: true, hourly: true });
});

it("runs only the 5-minute sweeps at :05", async () => {
  await run({ scheduledTime: at("10:05") });
  expect(called()).toMatchObject({ emitDueTaskEvents: true, emitDueSoonTaskEvents: true, runDueJobs: true,
    sweepGoogleCalendars: true, scanProductionAlerts: false, emitAddendumReminders: false,
    emitPaymentReminders: false, scanCollectorHealth: false, refreshUsage: false, cleanupJobs: false,
    cleanupAttachments: false });
  // The isolate's pending counts are written at the end of every run (FLOW-305).
  expect(sweeps.flushUsage).toHaveBeenCalledTimes(1);
});

it("adds the production scan at :15", async () => {
  await run({ scheduledTime: at("10:15") });
  expect(called()).toMatchObject({ runDueJobs: true, scanProductionAlerts: true, emitPaymentReminders: false,
    refreshUsage: false });
});

it("runs everything at :00, and on request", async () => {
  for (const options of [{ scheduledTime: at("10:00") }, { scheduledTime: at("10:05"), everything: true }]) {
    for (const fn of Object.values(sweeps)) fn.mockClear();
    await run(options);
    expect(called()).toMatchObject({ emitDueTaskEvents: true, runDueJobs: true, sweepGoogleCalendars: true,
      scanProductionAlerts: true, emitAddendumReminders: true, emitPaymentReminders: true,
      scanCollectorHealth: true, refreshUsage: true, cleanupJobs: true, cleanupAttachments: true,
      storeProviderMetrics: false });
  }
});

it("runs the job batch before any scan", async () => {
  await run({ scheduledTime: at("10:00") });
  const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0];
  expect(order(sweeps.emitDueSoonTaskEvents)).toBeLessThan(order(sweeps.runDueJobs));
  expect(order(sweeps.runDueJobs)).toBeLessThan(order(sweeps.scanProductionAlerts));
  expect(order(sweeps.runDueJobs)).toBeLessThan(order(sweeps.emitPaymentReminders));
});

it("still runs the jobs and the other sweeps when a sweep throws (FLOW-307 AC2)", async () => {
  sweeps.emitDueTaskEvents.mockRejectedValueOnce(new Error("due sweep failed"));
  sweeps.scanProductionAlerts.mockRejectedValueOnce(new Error("scan failed"));
  const summary = await run({ scheduledTime: at("10:00") });
  expect(sweeps.runDueJobs).toHaveBeenCalledTimes(1);
  expect(sweeps.emitPaymentReminders).toHaveBeenCalledTimes(1);
  expect(sweeps.cleanupJobs).toHaveBeenCalledTimes(1);
  expect(summary).toMatchObject({ failedSweeps: ["tasks_due", "production_alerts"] });
});

it("reads Cloudflare's figures hourly when the token is set, and counts nothing locally", async () => {
  await runScheduledJobs({ ...env, CF_ANALYTICS_TOKEN: "token", CF_ACCOUNT_ID: "account" }, new JobRegistry(),
    { withDb, scheduledTime: at("10:00") });
  expect(sweeps.storeProviderMetrics).toHaveBeenCalledTimes(1);
  expect(sweeps.flushUsage).not.toHaveBeenCalled();
  expect(sweeps.refreshUsage).toHaveBeenCalledWith(expect.anything(), expect.any(Date), { provider: true });
});
