import { Hono } from "hono";
import { id } from "../../shared/schema-primitives";
import { orderListInputSchema, orderListLinesSchema, receiveInputSchema,
  recordOrderInputSchema } from "../../shared/order-lists";
import { requirePermission } from "../auth";
import { notFound, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { cancelOrder, cancelOrderList, createOrderList, getOrderList, listOrderLists, receiveOrder,
  recordOrder, submitOrderList, updateOrderList } from "../records/order-lists";

export function orderListRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const param = (value: string) => {
    const result = id.safeParse(value);
    if (!result.success) throw notFound("Order list");
    return result.data;
  };
  const orderParam = (value: string) => {
    const result = id.safeParse(value);
    if (!result.success) throw notFound("Order");
    return result.data;
  };
  routes.get("/", requirePermission("order_lists.write"), async (c) => c.json(await record(c, (db, actor) => listOrderLists(db, actor))));
  routes.post("/", requirePermission("order_lists.write"), async (c) => {
    const { from, to } = await parseBody(c, orderListInputSchema);
    return c.json(await record(c, (db, actor) => createOrderList(db, actor, from, to)), 201);
  });
  routes.get("/:id", requirePermission("order_lists.write"), async (c) => c.json(await record(c, (db, actor) => getOrderList(db, actor, param(c.req.param("id"))))));
  routes.put("/:id", requirePermission("order_lists.write"), async (c) => {
    const { lines } = await parseBody(c, orderListLinesSchema);
    return c.json(await record(c, (db, actor) => updateOrderList(db, actor, param(c.req.param("id")), lines)));
  });
  routes.post("/:id/submit", requirePermission("order_lists.write"), async (c) => c.json(await record(c, (db, actor) => submitOrderList(db, actor, param(c.req.param("id"))))));
  // Ordering record (FLOW-87): Admin records each vendor's portal order.
  routes.post("/:id/orders", requirePermission("order_lists.approve"), async (c) => {
    const input = await parseBody(c, recordOrderInputSchema);
    return c.json(await record(c, (db, actor) => recordOrder(db, actor, param(c.req.param("id")), input)), 201);
  });
  routes.post("/:id/cancel", requirePermission("order_lists.approve"), async (c) =>
    c.json(await record(c, (db, actor) => cancelOrderList(db, actor, param(c.req.param("id"))))));
  routes.post("/:id/orders/:orderId/cancel", requirePermission("order_lists.approve"), async (c) =>
    c.json(await record(c, (db, actor) => cancelOrder(db, actor, param(c.req.param("id")), orderParam(c.req.param("orderId"))))));
  // Receiving (FLOW-88): whoever builds order lists receives deliveries.
  routes.post("/:id/orders/:orderId/receive", requirePermission("order_lists.write"), async (c) => {
    const input = await parseBody(c, receiveInputSchema);
    return c.json(await record(c, (db, actor) =>
      receiveOrder(db, actor, param(c.req.param("id")), orderParam(c.req.param("orderId")), input)));
  });
  return routes;
}
