import { Hono } from "hono";
import { isLocalDate } from "../../../shared/schema-primitives";
import { salesViewInputSchema } from "../../../shared/sales";
import { requireActor, requirePermission, type ResolveActor } from "../../auth";
import { ApiError, idParam, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../../hono";
import { createSalesView, deleteSalesView, listSalesViews, salesClient, salesDataset, salesReport } from "../../records/sales/sales";

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
    const viewId = idParam(c, "View");
    await record(c, (db, actor) => deleteSalesView(db, actor, viewId));
    return c.body(null, 204);
  });
  routes.get("/clients/:id/proposals", requirePermission("proposals.read"), async (c) => {
    const clientId = idParam(c, "Client");
    const data = await record(c, (db, actor) => salesClient(db, actor, clientId));
    return c.json(data.events.flatMap((event) => event.proposals.map((proposal) => ({
      id: proposal.id, eventId: event.eventId, title: proposal.title, stage: proposal.stage,
      currentVersion: proposal.versions[0]?.number ?? null,
    }))));
  });
  routes.get("/clients/:id", requirePermission("proposals.read"), async (c) => {
    const clientId = idParam(c, "Client");
    return c.json(await record(c, (db, actor) => salesClient(db, actor, clientId)));
  });
  return routes;
}
