// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  JobRegistry,
  backoffMs,
  type JobHandler,
} from "../../worker/jobs/queue";
import { createJobRegistry, runScheduledJobs } from "../../worker/jobs/cron";
import { INGEST_JOB_TYPE } from "../../worker/ingest/receipts";
import type { RunWithDb } from "../../worker/hono";

it("backs off exponentially from 30 seconds and caps at one hour", () => {
  expect([1, 2, 3, 4].map(backoffMs)).toEqual([
    30_000, 60_000, 120_000, 240_000,
  ]);
  expect(backoffMs(20)).toBe(60 * 60_000);
});
it("registers one handler per job type", () => {
  const handler = vi.fn<JobHandler>();
  const registry = new JobRegistry().register("demo", handler);
  expect(registry.get("demo")).toBe(handler);
  expect(registry.get("missing")).toBeUndefined();
  expect(() => registry.register("demo", handler)).toThrow(
    "already registered",
  );
});
it("registers ingest processing in the Worker's registry", () => {
  expect(createJobRegistry().get(INGEST_JOB_TYPE)).toBeTypeOf("function");
});
it("skips the cron run without a database binding", async () => {
  const withDb = vi.fn<RunWithDb>();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await runScheduledJobs({ ASSETS: { fetch } }, new JobRegistry(), {
      withDb: withDb as unknown as RunWithDb,
    });
    expect(withDb).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      JSON.stringify({ event: "jobs_skipped", reason: "database_not_configured" }),
    );
  } finally {
    log.mockRestore();
  }
});
