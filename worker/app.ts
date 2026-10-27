import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
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
import { authRoutes, userRoutes } from "./routes/users";
import { ApiError, type AppEnv, type RunWithDb } from "./hono";
import type { IngestSource } from "./ingest/sources";
import type { ImportModule } from "./records/imports";
import { adminRoutes } from "./routes/admin";
import { ingestRoutes } from "./routes/ingest";
import { importRoutes } from "./routes/imports";
import { inventoryRoutes } from "./routes/inventory";
import { leadRoutes } from "./routes/leads";
import { recipeRoutes } from "./routes/recipes";
import { recordRoutes } from "./routes/records";
import { searchRoutes } from "./routes/search";
import { attachmentRoutes } from "./routes/attachments";
import { timeTrackingRoutes } from "./routes/time-tracking";
import { settingsRoutes } from "./routes/settings";
import { staffRoutes } from "./routes/staff";
import { eventStaffRoutes } from "./routes/event-staff";
import * as fixtures from "../src/data/mock/fixtures";

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
};
export function createApp(options: Options = {}) {
  const app = new Hono<AppEnv>();
  app.use("/api/*", async (c, next) => {
    const requestId = crypto.randomUUID();
    c.set("requestId", requestId);
    c.header("X-Request-ID", requestId);
    await next();
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
      ["/api/health", "/api/auth/config"].includes(c.req.path) ||
      c.req.path.startsWith("/api/ingest/")
    ) {
      await next();
      return;
    }
    return requireActor(resolveActor)(c, next);
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
  app.route("/api/recipes", recipeRoutes(options));
  app.route("/api/search", searchRoutes(options));
  app.route("/api/settings", settingsRoutes(options));
  app.route("/api/staff", staffRoutes(options));
  app.route("/api/events", eventStaffRoutes(options));
  app.route("/api", recordRoutes(options));
  app.route("/api/attachments", attachmentRoutes(options));
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
