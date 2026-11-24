import { Hono } from "hono";
import { priceInputSchema } from "../../../shared/pricing";
import { requireActor, requirePermission, type ResolveActor } from "../../auth";
import { archiveRoutes, idParam, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../../hono";
import { createPrice, listPrices, setPriceArchived, updatePrice } from "../../records/sales/pricing";

// Sales › Pricing (FLOW-329), mounted at /api/pricing. Roles that read proposals
// read the price list; the Admin (settings.manage) keeps it.
export function pricingRoutes(options: { withDb?: RunWithDb; resolveActor?: ResolveActor }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  const manage = requirePermission("settings.manage");

  routes.get("/", requirePermission("proposals.read"), async (c) =>
    c.json(await record(c, (db) => listPrices(db))));
  routes.post("/", manage, async (c) => {
    const input = await parseBody(c, priceInputSchema);
    return c.json(await record(c, (db, actor) => createPrice(db, actor, input)), 201);
  });
  routes.put("/:id", manage, async (c) => {
    const id = idParam(c, "Price");
    const input = await parseBody(c, priceInputSchema);
    return c.json(await record(c, (db, actor) => updatePrice(db, actor, id, input)));
  });
  archiveRoutes(routes, record, { path: "/:id", what: "Price", guard: manage, set: setPriceArchived });
  return routes;
}
