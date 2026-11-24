import { Hono } from "hono";
import { kitchenInChargeInputSchema } from "../../../shared/kitchen-overview";
import { requirePermission } from "../../auth";
import { idParam, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../../hono";
import { getKitchenOverview, setKitchenInCharge } from "../../records/kitchen/kitchen-overview";

// Kitchen › Overview (FLOW-293), mounted at /api/kitchen. Reading follows event
// visibility; In charge also needs kitchen menu edit rights (checked in records).
export function kitchenRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.get("/overview", requirePermission("events.read"), async (c) =>
    c.json(await record(c, (db, actor) => getKitchenOverview(db, actor))),
  );
  routes.patch("/lines/:id/in-charge", requirePermission("events.read"), async (c) => {
    const menuLineId = idParam(c, "Menu line");
    const input = await parseBody(c, kitchenInChargeInputSchema);
    return c.json(await record(c, (db, actor) => setKitchenInCharge(db, actor, menuLineId, input)));
  });
  return routes;
}
