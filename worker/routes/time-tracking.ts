import { Hono } from "hono";
import { activityBatchSchema } from "../../shared/time-tracking";
import { id as uuid, localDate } from "../../shared/schema-primitives";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import {
  ApiError,
  parseBody,
  recordRunner,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import { recordSessions, timeReport } from "../records/time-tracking";

// Activity time tracking (FLOW-119), mounted at /api/time. Every signed-in user
// records their own sessions; reports follow timeReportScope in worker/policy.ts.
export function timeTrackingRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));

  // The browser's batch of new and still-open sessions, at most once a minute.
  routes.post("/sessions", requirePermission("time.record"), async (c) => {
    const { sessions } = await parseBody(c, activityBatchSchema);
    return c.json(
      await record(c, (db, actor) => recordSessions(db, actor, sessions)),
    );
  });

  // ?from=&to= (New York dates, inclusive; the last 30 days by default) and, for
  // Admin and Sales Manager, ?userId= to narrow to one person.
  routes.get("/report", requirePermission("time.read"), async (c) => {
    const today = utcToBusinessTime(new Date()).date;
    const date = (key: string, fallback: string) => {
      const value = c.req.query(key);
      if (!value) return fallback;
      // An impossible date (2026-02-31) is refused, never rolled into March.
      if (!localDate.safeParse(value).success)
        throw new ApiError(400, "INVALID_REQUEST", "Enter a date.");
      return value;
    };
    const from = date("from", addLocalDays(today, -29));
    const to = date("to", today);
    if (from > to)
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        "The start date must come first.",
      );
    const userId = c.req.query("userId");
    if (userId && !uuid.safeParse(userId).success)
      throw new ApiError(400, "INVALID_REQUEST", "Choose a valid user.");
    return c.json(
      await record(c, (db, actor) =>
        timeReport(db, actor, { from, to, userId }),
      ),
    );
  });
  return routes;
}
