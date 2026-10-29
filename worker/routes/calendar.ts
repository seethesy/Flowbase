import { Hono } from "hono";
import { calendarRangeSchema } from "../../shared/calendar";
import { requirePermission } from "../auth";
import { ApiError, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { getCalendar } from "../records/calendar";

// Basic calendar (FLOW-63), mounted at /api/calendar.
export function calendarRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.get("/", requirePermission("events.read"), async (c) => {
    const range = calendarRangeSchema.safeParse(c.req.query());
    if (!range.success)
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        range.error.issues[0]?.message ?? "Invalid calendar range.",
      );
    return c.json(
      await record(c, (db, actor) => getCalendar(db, actor, range.data)),
    );
  });
  return routes;
}
