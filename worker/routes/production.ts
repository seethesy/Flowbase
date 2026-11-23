import { Hono } from "hono";
import { id } from "../../shared/schema-primitives";
import { readinessResponseSchema } from "../../shared/readiness";
import { requirePermission } from "../auth";
import { notFound, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { getProductionList, getProductionOverview } from "../records/production";
import { getReadiness, respondToReadiness } from "../records/readiness";

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
    const parsed = id.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Event");
    return c.json(await record(c, (db, actor) => getProductionList(db, actor, parsed.data)));
  });
  routes.get("/events/:id/readiness", requirePermission("production.read"), async (c) => {
    const parsed = id.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Event");
    return c.json(await record(c, (db, actor) => getReadiness(db, actor, parsed.data)));
  });
  routes.post("/events/:id/readiness/:key", requirePermission("production.read"), async (c) => {
    const parsed = id.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Event");
    const input = await parseBody(c, readinessResponseSchema);
    return c.json(await record(c, (db, actor) => respondToReadiness(db, actor, parsed.data, decodeURIComponent(c.req.param("key")), input)));
  });
  return routes;
}
