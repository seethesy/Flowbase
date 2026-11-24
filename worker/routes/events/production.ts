import { Hono } from "hono";
import { readinessResponseSchema } from "../../../shared/readiness";
import { requirePermission } from "../../auth";
import { idParam, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../../hono";
import { getProductionList, getProductionOverview } from "../../records/events/production";
import { getReadiness, respondToReadiness } from "../../records/events/readiness";

export function productionRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.get("/overview", requirePermission("production.read"), async (c) => {
    // 7, 14 or 30 days (FLOW-265); anything else is the default week.
    const asked = Number(c.req.query("days"));
    const days = asked === 14 ? 14 : asked === 30 ? 30 : 7;
    return c.json(await record(c, (db, actor) => getProductionOverview(db, actor, days)));
  });
  routes.get("/events/:id", requirePermission("production.read"), async (c) => {
    const eventId = idParam(c, "Event");
    return c.json(await record(c, (db, actor) => getProductionList(db, actor, eventId)));
  });
  routes.get("/events/:id/readiness", requirePermission("production.read"), async (c) => {
    const eventId = idParam(c, "Event");
    return c.json(await record(c, (db, actor) => getReadiness(db, actor, eventId)));
  });
  routes.post("/events/:id/readiness/:key", requirePermission("production.read"), async (c) => {
    const eventId = idParam(c, "Event");
    const input = await parseBody(c, readinessResponseSchema);
    return c.json(await record(c, (db, actor) => respondToReadiness(db, actor, eventId, decodeURIComponent(c.req.param("key")), input)));
  });
  return routes;
}
