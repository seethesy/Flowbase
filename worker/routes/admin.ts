import { Hono } from "hono";
import { jobStatusSchema } from "../../shared/api";
import { id as idSchema } from "../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import { fail, runDb, type AppEnv, type RunWithDb } from "../hono";
import { listReceipts, replayReceipt } from "../ingest/receipts";
import { listJobs, retryFailedJob } from "../jobs/queue";

// Admin-only operations for background work (FLOW-27) and ingestion (FLOW-28).
export function adminRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const admin = new Hono<AppEnv>();
  admin.use("*", requireActor(options.resolveActor));

  admin.get("/jobs", requirePermission("jobs.manage"), async (c) => {
    const status = jobStatusSchema.safeParse(c.req.query("status") ?? "failed");
    if (!status.success)
      return fail(c, 400, "INVALID_REQUEST", "Invalid request.");
    return c.json(
      await runDb(options.withDb, c.env, (db) => listJobs(db, status.data)),
    );
  });
  admin.post("/jobs/:id/retry", requirePermission("jobs.manage"), async (c) => {
    const id = idSchema.safeParse(c.req.param("id"));
    const job =
      id.success &&
      (await runDb(options.withDb, c.env, (db) => retryFailedJob(db, id.data)));
    if (!job) return fail(c, 404, "NOT_FOUND", "No failed job has that id.");
    return c.json(job);
  });

  admin.get(
    "/ingest-receipts",
    requirePermission("ingest.manage"),
    async (c) => {
      const status = c.req.query("status") ?? "all";
      if (status !== "all" && status !== "failed" && status !== "unprocessed")
        return fail(c, 400, "INVALID_REQUEST", "Invalid request.");
      return c.json(
        await runDb(options.withDb, c.env, (db) =>
          listReceipts(db, {
            source: c.req.query("source"),
            status,
          }),
        ),
      );
    },
  );
  admin.post(
    "/ingest-receipts/:id/replay",
    requirePermission("ingest.manage"),
    async (c) => {
      const id = idSchema.safeParse(c.req.param("id"));
      const receipt =
        id.success &&
        (await runDb(options.withDb, c.env, (db) => replayReceipt(db, id.data)));
      if (!receipt)
        return fail(
          c,
          404,
          "NOT_FOUND",
          "No replayable receipt has that id.",
        );
      return c.json(receipt);
    },
  );
  return admin;
}
