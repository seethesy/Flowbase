import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { recordSchemas } from "../shared/records";
import {
  connectionCheckInputSchema,
  healthSchema,
  type ConnectionCheck,
  type DatabaseStatus,
} from "../shared/api";
import {
  constraintErrors,
  DatabaseNotConfiguredError,
  postgresErrorCode,
} from "./db/errors";
import { APP_VERSION } from "../shared/version";
import type { Bindings } from "./bindings";
import { createActorResolver, requireActor, type ResolveActor } from "./auth";
import { authRoutes, userRoutes } from "./routes/settings/users";
import { afterResponse, ApiError, type AppEnv, type RunWithDb } from "./hono";
import type { IngestSource } from "./ingest/sources";
import { googleCalendarRoutes } from "./routes/events/google-calendar";
import type { ImportModule } from "./records/settings/imports";
import { adminRoutes } from "./routes/settings/admin";
import { ingestRoutes } from "./routes/leads/ingest";
import { importRoutes } from "./routes/settings/imports";
import { inventoryRoutes } from "./routes/inventory/inventory";
import { leadRoutes } from "./routes/leads/leads";
import { communicationRoutes } from "./routes/sales/communications";
import { recipeRoutes } from "./routes/kitchen/recipes";
import { recordRoutes } from "./routes/core/records";
import { searchRoutes } from "./routes/home/search";
import { attachmentRoutes } from "./routes/documents/attachments";
import { documentRoutes } from "./routes/documents/documents";
import { photoRoutes } from "./routes/documents/photos";
import { timeTrackingRoutes } from "./routes/staff/time-tracking";
import { settingsRoutes } from "./routes/settings/settings";
import { copyRoutes } from "./routes/settings/copy";
import { layoutRoutes } from "./routes/settings/layout";
import { permissionRoutes } from "./routes/settings/permissions";
import { invalidatePolicy, lastMatrix, loadMatrix } from "./records/settings/permissions";
import { setPolicyMatrix } from "../shared/role-permissions";
import { fieldProjection } from "./fields";
import { staffRoutes } from "./routes/staff/staff";
import { staffPayRoutes } from "./routes/staff/staff-pay";
import { eventStaffRoutes } from "./routes/events/event-staff";
import { eventTimelineRoutes } from "./routes/events/event-timeline";
import { preparationRoutes } from "./routes/events/preparation";
import { beoListRoutes, beoRoutes, offlineBeoRoutes } from "./routes/beo/beo";
import { beoSync } from "./beo-sync";
import { paymentRoutes } from "./routes/sales/payments";
import { planningRoutes } from "./routes/events/planning";
import { notificationRoutes } from "./routes/home/notifications";
import { taskRoutes } from "./routes/tasks/tasks";
import { sopRoutes } from "./routes/tasks/sops";
import { approvalRoutes } from "./routes/inventory/approvals";
import { calendarRoutes } from "./routes/events/calendar";
import { productionRoutes } from "./routes/events/production";
import { kitchenRoutes } from "./routes/kitchen/kitchen";
import { enqueueJob } from "./jobs/queue";
import { tasks } from "./db/schema";
import { eq } from "drizzle-orm";
import { id as uuid } from "../shared/schema-primitives";
import { proposalRoutes } from "./routes/sales/proposals";
import { salesRoutes } from "./routes/sales/sales";
import { pricingRoutes } from "./routes/sales/pricing";
import { operationalReportRoutes } from "./routes/home/operational-reports";
import { homeRoutes } from "./routes/home/home";
import { areaNoteRoutes } from "./routes/home/area-notes";
import { vendorRoutes } from "./routes/inventory/vendors";
import { deletionRoutes } from "./routes/settings/deletions";
import { orderListRoutes } from "./routes/inventory/order-lists";
import { announceChanges } from "./realtime";
import type { ChangeArea } from "../shared/realtime";
import * as fixtures from "../src/data/mock/fixtures";
import { countUsage, flushUsage, providerMetricsConfigured, usageFlushDue } from "./records/settings/usage";
import { requestDb } from "./db/request";
import { productionScanJob } from "./jobs/production-scan";

type DbCheck = {
  list: (env: Bindings) => Promise<ConnectionCheck[]>;
  create: (env: Bindings, note: string) => Promise<ConnectionCheck>;
};
type Options = {
  checkDatabase?: (env: Bindings) => Promise<DatabaseStatus>;
  dbCheck?: DbCheck;
  captureError?: (error: Error, requestId: string) => void;
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
  ingestSources?: Map<string, IngestSource>;
  // Module importers (FLOW-47); the registered ones by default.
  importModules?: ImportModule[];
  // Sends the "changed" ping after a write (FLOW-206), with the areas it
  // changed (FLOW-304); Supabase Realtime by default.
  publishChanged?: (env: Bindings | undefined, areas: ChangeArea[] | null) => Promise<void>;
  // Loads the Admin-edited roles and permissions matrix (FLOW-269) before each
  // request. On by default wherever the database is bound (Hyperdrive); the
  // database tests turn it on for the real API.
  loadPolicy?: boolean;
  // Per-isolate copies of the matrix and the business settings, 60 s (FLOW-306).
  // On wherever the database is bound; the browser tests turn them off because
  // they reset the database under a running Worker.
  isolateCaches?: boolean;
};
export function createApp(options: Options = {}) {
  const app = new Hono<AppEnv>();
  app.use("/api/*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-ID", requestId);
    // One lazy database client for the whole request (FLOW-306), closed after
    // the response.
    const scope = options.withDb ? requestDb(options.withDb, c.env) : undefined;
    if (scope) c.set("db", scope.run);
    try {
      await next();
    } finally {
      if (scope?.opened) await afterResponse(c, scope.close());
    }
    // Usage (FLOW-305): no database write per request. Without the Cloudflare
    // token the isolate counts and flushes at most once a minute.
    const withDb = options.withDb;
    if (withDb && c.env?.HYPERDRIVE && !providerMetricsConfigured(c.env)) {
      countUsage("worker_requests", 1);
      if (usageFlushDue())
        await afterResponse(c, withDb(c.env, (db) => flushUsage(db)).catch((error: unknown) =>
          console.error("usage_flush_failed", error)));
    }
    console.log(
      JSON.stringify({
        event: "api_request",
        requestId,
        method: c.req.method,
        // A token in an ingestion path (FLOW-108) never reaches the logs.
        path: c.req.path.replace(/^(\/api\/ingest\/[^/]+)\/.+$/, "$1/[token]"),
        status: c.res.status,
      }),
    );
  });
  app.use("/api/*", announceChanges(options.publishChanged));
  app.onError((error, c) => {
    const requestId = c.get("requestId") ?? crypto.randomUUID();
    c.header("X-Request-ID", requestId);
    if (error instanceof ApiError)
      return c.json(
        {
          error: { code: error.code, message: error.message, requestId },
          ...error.extra,
        },
        error.status,
      );
    if (error instanceof ZodError)
      return c.json({ error: {
        code: "INVALID_REQUEST",
        message: error.issues[0]?.message ?? "Invalid request.",
        requestId,
      } }, 400);
    if (error instanceof DatabaseNotConfiguredError)
      return c.json(
        {
          error: {
            code: "DATABASE_NOT_CONFIGURED",
            message: "The database is not configured.",
            requestId,
          },
        },
        503,
      );
    const sqlState = postgresErrorCode(error);
    const constraint = sqlState ? constraintErrors[sqlState] : undefined;
    if (constraint) {
      console.error(
        JSON.stringify({
          event: "api_error",
          requestId,
          code: constraint.code,
          status: constraint.status,
        }),
      );
      return c.json(
        {
          error: { code: constraint.code, message: constraint.message, requestId },
        },
        constraint.status,
      );
    }
    const status = error instanceof HTTPException ? error.status : 500;
    if (status >= 500) options.captureError?.(error, requestId);
    const code = status >= 500 ? "INTERNAL_ERROR" : "INVALID_REQUEST";
    console.error(
      JSON.stringify({ event: "api_error", requestId, code, status }),
    );
    return c.json(
      {
        error: {
          code,
          message:
            status >= 500
              ? "An unexpected error occurred."
              : "Invalid request.",
          requestId,
        },
      },
      status,
    );
  });
  const resolveActor =
    options.resolveActor ?? createActorResolver(options.withDb);
  app.use("/api/*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    // Liveness and public Auth configuration have no user data. Machine intake
    // authenticates with its own service token/webhook signature.
    if (
      ["/api/health", "/api/auth/config", "/api/google-calendar/callback"].includes(c.req.path) ||
      c.req.path.startsWith("/api/ingest/")
    ) {
      await next();
      return;
    }
    return requireActor(resolveActor)(c, next);
  });
  // The matrix is cached in memory and re-read when it ages out or after a save.
  // If it can't be read, the last one stands, else the built-in rules.
  app.use("/api/*", async (c, next) => {
    const withDb = c.get("db") ?? options.withDb;
    if (withDb && c.get("actor") && (options.loadPolicy ?? Boolean(c.env?.HYPERDRIVE))) {
      if (options.isolateCaches === false) invalidatePolicy();
      try {
        setPolicyMatrix(await withDb(c.env, (db) => loadMatrix(db)));
      } catch (error) {
        console.error("policy_load_failed", error);
        setPolicyMatrix(lastMatrix());
      }
    }
    await next();
  });
  // fields= and card queries on list and detail endpoints (FLOW-253/256).
  app.use("/api/*", fieldProjection());
  // BEO change tracking (FLOW-144) runs after every write under /api/events/<id>.
  app.use("/api/events/*", beoSync(options.withDb));
  // Writes queue a scan of their event for the next cron tick; edits before that
  // tick share one job (FLOW-307).
  app.use("/api/events/*", async (c, next) => {
    await next();
    const eventId = c.req.path.split("/")[3];
    const withDb = c.get("db") ?? options.withDb;
    if (c.req.method !== "GET" && c.res.status < 400 && c.env?.HYPERDRIVE && uuid.safeParse(eventId).success && withDb)
      await withDb(c.env, (db) => enqueueJob(db, productionScanJob(eventId)).then(() => undefined));
  });
  app.use("/api/tasks/*", async (c, next) => {
    await next();
    const taskId = c.req.path.split("/")[3];
    const withDb = c.get("db") ?? options.withDb;
    if (c.req.method === "GET" || c.res.status >= 400 || !c.env?.HYPERDRIVE || !uuid.safeParse(taskId).success || !withDb) return;
    await withDb(c.env, async (db) => {
      const [task] = await db.select({ eventId: tasks.eventId }).from(tasks).where(eq(tasks.id, taskId));
      if (task?.eventId) await enqueueJob(db, productionScanJob(task.eventId));
    });
  });
  app.route("/api/auth", authRoutes(options));
  app.route("/api/admin/users", userRoutes(options));
  app.get("/api/health", async (c) => {
    const database = await (options.checkDatabase?.(c.env) ??
      Promise.resolve("not_configured" as const));
    return c.json(
      healthSchema.parse({
        ok: true,
        version: c.env?.APP_VERSION ?? APP_VERSION,
        database,
      }),
    );
  });
  const errorBody = (requestId: string, code: string, message: string) => ({
    error: { code, message, requestId },
  });
  // Hyperdrive read/write proof for dev (FLOW-24). It answers 404 unless
  // DB_CHECK_ROUTE is "enabled"; staff authentication also applies.
  app.use("/api/dev/*", async (c, next) => {
    if (c.env?.DB_CHECK_ROUTE !== "enabled")
      return c.json(
        errorBody(c.get("requestId"), "NOT_FOUND", "API route not found."),
        404,
      );
    await next();
  });
  const dbUnavailable = (requestId: string) =>
    errorBody(
      requestId,
      "DATABASE_NOT_CONFIGURED",
      "The database is not configured.",
    );
  app.get("/api/dev/db-check", async (c) => {
    if (!options.dbCheck) return c.json(dbUnavailable(c.get("requestId")), 503);
    try {
      return c.json(await options.dbCheck.list(c.env));
    } catch (error) {
      if (error instanceof DatabaseNotConfiguredError)
        return c.json(dbUnavailable(c.get("requestId")), 503);
      throw error;
    }
  });
  app.post("/api/dev/db-check", async (c) => {
    const parsed = connectionCheckInputSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success)
      return c.json(
        errorBody(c.get("requestId"), "INVALID_REQUEST", "Invalid request."),
        400,
      );
    if (!options.dbCheck) return c.json(dbUnavailable(c.get("requestId")), 503);
    try {
      return c.json(await options.dbCheck.create(c.env, parsed.data.note), 201);
    } catch (error) {
      if (error instanceof DatabaseNotConfiguredError)
        return c.json(dbUnavailable(c.get("requestId")), 503);
      throw error;
    }
  });
  // Temporary demo adapters. Writes validate and echo, without database storage.
  for (const resource of ["clients", "proposals", "inventory"] as const) {
    const schema = recordSchemas[resource];
    app.get(`/api/demo/${resource}`, (c) =>
      c.json(schema.array().parse(fixtures[resource])),
    );
    app.put(`/api/demo/${resource}/:id`, async (c) => {
      const parsed = schema.safeParse(await c.req.json().catch(() => null));
      if (!parsed.success || parsed.data.id !== c.req.param("id"))
        return c.json(
          {
            error: {
              code: "INVALID_RECORD",
              message: "Invalid record.",
              requestId: c.get("requestId"),
            },
          },
          400,
        );
      return c.json(parsed.data);
    });
    app.delete(`/api/demo/${resource}/:id`, (c) => c.body(null, 204));
  }
  app.route("/api/admin", adminRoutes(options));
  app.route("/api/inventory", inventoryRoutes(options));
  app.route(
    "/api/imports",
    importRoutes({
      withDb: options.withDb,
      resolveActor: options.resolveActor,
      modules: options.importModules,
    }),
  );
  app.route("/api/leads", leadRoutes(options));
  app.route("/api/communications", communicationRoutes(options));
  app.route("/api/recipes", recipeRoutes(options));
  app.route("/api/search", searchRoutes(options));
  app.route("/api/settings", settingsRoutes(options));
  app.route("/api/copy", copyRoutes(options));
  app.route("/api/layout", layoutRoutes(options));
  app.route("/api/permissions", permissionRoutes(options));
  app.route("/api/staff", staffRoutes(options));
  app.route("/api/staff-pay", staffPayRoutes(options));
  app.route("/api/events", eventStaffRoutes(options));
  app.route("/api/events", eventTimelineRoutes(options));
  app.route("/api/events", preparationRoutes(options));
  app.route("/api/events", beoRoutes(options));
  app.route("/api/offline-beos", offlineBeoRoutes(options));
  app.route("/api/beos", beoListRoutes(options));
  app.route("/api/events", paymentRoutes(options));
  app.route("/api/tasks", taskRoutes(options));
  app.route("/api/sops", sopRoutes(options));
  app.route("/api/approvals", approvalRoutes(options));
  app.route("/api/order-lists", orderListRoutes(options));
  app.route("/api/calendar", calendarRoutes(options));
  app.route("/api/google-calendar", googleCalendarRoutes(options));
  app.route("/api/production", productionRoutes(options));
  // Kitchen › Overview (FLOW-293).
  app.route("/api/kitchen", kitchenRoutes(options));
  app.route("/api/notifications", notificationRoutes(options));
  app.route("/api/proposals", proposalRoutes(options));
  app.route("/api/sales", salesRoutes(options));
  app.route("/api/pricing", pricingRoutes(options));
  app.route("/api/operational-reports", operationalReportRoutes(options));
  app.route("/api/home", homeRoutes(options));
  app.route("/api/area-notes", areaNoteRoutes(options));
  app.route("/api/vendors", vendorRoutes(options));
  app.route("/api/deletions", deletionRoutes(options));
  app.route("/api", planningRoutes(options));
  app.route("/api", recordRoutes(options));
  app.route("/api/attachments", attachmentRoutes(options));
  app.route("/api/documents", documentRoutes(options));
  app.route("/api/photos", photoRoutes(options));
  app.route("/api/time", timeTrackingRoutes(options));
  app.route(
    "/api/ingest",
    ingestRoutes({ withDb: options.withDb, sources: options.ingestSources }),
  );
  app.all("/api/*", (c) =>
    c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "API route not found.",
          requestId: c.get("requestId"),
        },
      },
      404,
    ),
  );
  app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
  return app;
}
export const app = createApp();
