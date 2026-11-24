import { Hono } from "hono";
import { calendarRangeSchema } from "../../../shared/calendar";
import { requirePermission } from "../../auth";
import { ApiError, recordRunner, runDb, type AppEnv, type RunWithDb } from "../../hono";
import {
  completeConnect,
  disconnect,
  googleStatus,
  overlayEvents,
  startConnect,
} from "../../records/events/google-calendar";

// Per-user Google Calendar (FLOW-268), mounted at /api/google-calendar. Every
// route answers the signed-in person about their own Google account only. The
// callback is a plain browser redirect from Google, so it skips the bearer
// check (app.ts) and identifies the user by the signed state instead.
export function googleCalendarRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.get("/callback", async (c) => {
    const path = await runDb(options.withDb, c.env, (db) =>
      completeConnect(db, c.env, {
        code: c.req.query("code"),
        state: c.req.query("state"),
        error: c.req.query("error"),
      }),
    ).catch((error) => {
      console.error("google_connect_failed", error instanceof Error ? error.message : String(error));
      return "/#/calendar?google=failed";
    });
    const base = (c.env?.APP_URL ?? "").replace(/\/$/, "");
    return c.redirect(`${base}${path}`, 302);
  });
  routes.get("/", requirePermission("events.read"), async (c) =>
    c.json(await record(c, (db, actor) => googleStatus(db, c.env, actor))),
  );
  routes.post("/connect", requirePermission("events.read"), async (c) =>
    c.json(await startConnect(c.env, c.get("actor"))),
  );
  routes.delete("/", requirePermission("events.read"), async (c) =>
    c.json(await record(c, (db, actor) => disconnect(db, c.env, actor))),
  );
  routes.get("/events", requirePermission("events.read"), async (c) => {
    const range = calendarRangeSchema.safeParse(c.req.query());
    if (!range.success)
      throw new ApiError(400, "INVALID_REQUEST", range.error.issues[0]?.message ?? "Invalid calendar range.");
    return c.json({
      events: await record(c, (db, actor) => overlayEvents(db, c.env, actor, range.data)),
    });
  });
  return routes;
}
