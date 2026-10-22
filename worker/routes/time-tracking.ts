import { Hono } from "hono";
import { z } from "zod";
import { activityBatchSchema } from "../../shared/time-tracking";
import { utcToBusinessTime } from "../../shared/time";
import { requireActor, type ResolveActor } from "../auth";
import { ApiError, parseBody, runDb, type AppEnv, type RunWithDb } from "../hono";
import { recordSessions, timeReport } from "../records/time-tracking";

const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const uuid = z.string().uuid();

// Activity time tracking (FLOW-119), mounted at /api/time. Every signed-in user
// records their own sessions; reports follow timeReportScope in worker/policy.ts.
export function timeTrackingRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  routes.use("*", requireActor(options.resolveActor));

  // The browser's batch of new and still-open sessions, at most once a minute.
  routes.post("/sessions", async (c) => {
    const { sessions } = await parseBody(c, activityBatchSchema);
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        recordSessions(tx, c.get("actor"), sessions),
      ),
    );
  });

  // ?from=&to= (New York dates, inclusive; the last 30 days by default) and, for
  // Admin and Sales Manager, ?userId= to narrow to one person.
  routes.get("/report", async (c) => {
    const today = new Date();
    const date = (key: string, fallback: Date) => {
      const value = c.req.query(key);
      return value && localDate.safeParse(value).success
        ? value
        : utcToBusinessTime(fallback).date;
    };
    const from = date("from", new Date(today.getTime() - 29 * 24 * 60 * 60_000));
    const to = date("to", today);
    if (from > to)
      throw new ApiError(400, "INVALID_REQUEST", "The start date must come first.");
    const userId = c.req.query("userId");
    if (userId && !uuid.safeParse(userId).success)
      throw new ApiError(400, "INVALID_REQUEST", "Choose a valid user.");
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        timeReport(tx, c.get("actor"), { from, to, userId }),
      ),
    );
  });
  return routes;
}
