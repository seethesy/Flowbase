import { Hono } from "hono";
import { id as uuid, isLocalDate } from "../../shared/schema-primitives";
import { salesViewInputSchema } from "../../shared/sales";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import { ApiError, notFound, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { createSalesView, deleteSalesView, listSalesViews, salesClient, salesDataset, salesReport } from "../records/sales";

export function salesRoutes(options: { withDb?: RunWithDb; resolveActor?: ResolveActor }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  routes.get("/", requirePermission("proposals.read"), async (c) => c.json({ rows: (await record(c, salesDataset)).rows }));
  routes.get("/reports", requirePermission("proposals.read"), async (c) => {
    const from = c.req.query("from"), to = c.req.query("to");
    if ((from && !isLocalDate(from)) || (to && !isLocalDate(to)) || (from && to && from > to))
      throw new ApiError(400, "INVALID_REQUEST", "Enter a valid date range.");
    return c.json(await record(c, (db, actor) => salesReport(db, actor, { from, to })));
  });
  routes.get("/views", requirePermission("proposals.read"), async (c) => c.json(await record(c, listSalesViews)));
  routes.post("/views", requirePermission("proposals.read"), async (c) => {
    const input = await parseBody(c, salesViewInputSchema);
    return c.json(await record(c, (db, actor) => createSalesView(db, actor, input)), 201);
  });
  routes.delete("/views/:id", requirePermission("proposals.read"), async (c) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("View");
    await record(c, (db, actor) => deleteSalesView(db, actor, parsed.data));
    return c.body(null, 204);
  });
  routes.get("/clients/:id", requirePermission("proposals.read"), async (c) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Client");
    return c.json(await record(c, (db, actor) => salesClient(db, actor, parsed.data)));
  });
  return routes;
}
