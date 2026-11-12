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
  routes.get("/overview", requirePermission("events.read"), async (c) => {
    const days = c.req.query("days") === "14" ? 14 : 7;
    return c.json(await record(c, (db, actor) => getProductionOverview(db, actor, days)));
  });
  routes.get("/events/:id", requirePermission("events.read"), async (c) => {
    const parsed = id.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Event");
    return c.json(await record(c, (db, actor) => getProductionList(db, actor, parsed.data)));
  });
  routes.get("/events/:id/readiness", requirePermission("events.read"), async (c) => {
    const parsed = id.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Event");
    return c.json(await record(c, (db, actor) => getReadiness(db, actor, parsed.data)));
  });
  routes.post("/events/:id/readiness/:key", requirePermission("events.read"), async (c) => {
    const parsed = id.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Event");
    const input = await parseBody(c, readinessResponseSchema);
    return c.json(await record(c, (db, actor) => respondToReadiness(db, actor, parsed.data, decodeURIComponent(c.req.param("key")), input)));
  });
  return routes;
}
