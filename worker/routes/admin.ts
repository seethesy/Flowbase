import { Hono } from "hono";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { jobStatusSchema } from "../../shared/api";
import { id as idSchema } from "../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import { fail, forbidden, runDb, type AppEnv, type RunWithDb } from "../hono";
import { listReceipts, replayReceipt } from "../ingest/receipts";
import { listJobs, retryFailedJob } from "../jobs/queue";
import { collectorSites, smsOutbox } from "../db/schema";
import { collectorSiteNames, listCollectorHealth } from "../records/collector-health";
import { refreshUsage } from "../records/usage";

// Admin-only operations for background work (FLOW-27) and ingestion (FLOW-28).
export function adminRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const admin = new Hono<AppEnv>();
  admin.use("*", requireActor(options.resolveActor));

  const operationsReader = async (c: import("../hono").AppContext, next: () => Promise<void>) => {
    if (!(["admin", "technical"] as string[]).includes(c.get("actor").role)) throw forbidden();
    await next();
  };
  admin.get("/usage", operationsReader, async (c) =>
    c.json(await runDb(options.withDb, c.env, (db) => refreshUsage(db))),
  );

  admin.get("/sms-outbox", requirePermission("settings.manage"), async (c) =>
    c.json(await runDb(options.withDb, c.env, (db) => db.select().from(smsOutbox)
      .orderBy(desc(smsOutbox.createdAt)).limit(100))),
  );
  admin.get("/collector-health", operationsReader, async (c) =>
    c.json(await runDb(options.withDb, c.env, listCollectorHealth)),
  );
  admin.put("/collector-health/:site", requirePermission("settings.manage"), async (c) => {
    const site = c.req.param("site");
    if (!collectorSiteNames.includes(site as typeof collectorSiteNames[number]))
      return fail(c, 400, "INVALID_REQUEST", "Unknown collector site.");
    const parsed = z.object({ noLeadsGapHours: z.number().int().min(1).max(720),
      failureThreshold: z.number().int().min(1).max(20) }).safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return fail(c, 400, "INVALID_REQUEST", "Invalid collector limits.");
    await runDb(options.withDb, c.env, (db) => db.insert(collectorSites)
      .values({ site, ...parsed.data })
      .onConflictDoUpdate({ target: collectorSites.site, set: parsed.data }));
    return c.json({ saved: true });
  });

  admin.get("/jobs", operationsReader, async (c) => {
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
    operationsReader,
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
