import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { recordSchemas } from "../shared/records";
import {
  connectionCheckInputSchema,
  healthSchema,
  type ConnectionCheck,
  type DatabaseStatus,
} from "../shared/api";
import { DatabaseNotConfiguredError } from "./db/errors";
import { APP_VERSION } from "../shared/version";
import type { Bindings } from "./bindings";
import type { ResolveActor } from "./auth";
import { ApiError, type AppEnv, type RunWithDb } from "./hono";
import type { IngestSource } from "./ingest/sources";
import { adminRoutes } from "./routes/admin";
import { ingestRoutes } from "./routes/ingest";
import { inventoryRoutes } from "./routes/inventory";
import { leadRoutes } from "./routes/leads";
import { recordRoutes } from "./routes/records";
import { attachmentRoutes } from "./routes/attachments";
import { timeTrackingRoutes } from "./routes/time-tracking";
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
        path: c.req.path,
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
  // Hyperdrive read/write proof for the dev environment only (FLOW-24). It has no
  // sign-in yet, so it answers 404 unless DB_CHECK_ROUTE is "enabled" in that env.
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
    if (!options.dbCheck)
      return c.json(dbUnavailable(c.get("requestId")), 503);
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
    if (!options.dbCheck)
      return c.json(dbUnavailable(c.get("requestId")), 503);
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
  app.route("/api/leads", leadRoutes(options));
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
