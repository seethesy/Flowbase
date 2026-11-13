import { Hono } from "hono";
import { localDate } from "../../shared/schema-primitives";
import { addLocalDays, utcToBusinessTime } from "../../shared/time";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import { ApiError, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { operationalReport } from "../records/operational-reports";

export function operationalReportRoutes(options: { withDb?: RunWithDb; resolveActor?: ResolveActor }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  routes.get("/", requirePermission("reports.operations.read"), async (c) => {
    const today = utcToBusinessTime(new Date()).date;
    const from = c.req.query("from") ?? addLocalDays(today, -29);
    const to = c.req.query("to") ?? today;
    if (!localDate.safeParse(from).success || !localDate.safeParse(to).success || from > to)
      throw new ApiError(400, "INVALID_REQUEST", "Enter a valid date range.");
    return c.json(await record(c, (db) => operationalReport(db, from, to)));
  });
  return routes;
}
