import { Hono } from "hono";
import {
  paymentInputSchema,
  scheduleItemInputSchema,
} from "../../../shared/payments";
import { requirePermission } from "../../auth";
import {
  idParam,
  parseBody,
  recordRunner,
  type AppEnv,
  type RunWithDb,
} from "../../hono";
import {
  archivePayment,
  archiveScheduleItem,
  createScheduleItem,
  getEventPayments,
  recordPayment,
  updateScheduleItem,
} from "../../records/sales/payments";

// Payment schedule and log (FLOW-131), mounted at /api/events. The record layer
// answers 403 unless the user is full-time staff who may see the event's
// financials, so a part-time user never receives an amount.
export function paymentRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);

  routes.get("/:id/payments", requirePermission("events.read"), async (c) => {
    const id = idParam(c, "Event");
    return c.json(await record(c, (db, actor) => getEventPayments(db, actor, id)));
  });
  routes.post(
    "/:id/payments/schedule",
    requirePermission("payments.record"),
    async (c) => {
      const id = idParam(c, "Event");
      const input = await parseBody(c, scheduleItemInputSchema);
      return c.json(
        await record(c, (db, actor) => createScheduleItem(db, actor, id, input)),
        201,
      );
    },
  );
  routes.put(
    "/:id/payments/schedule/:itemId",
    requirePermission("payments.record"),
    async (c) => {
      const id = idParam(c, "Event");
      const itemId = idParam(c, "Schedule item", "itemId");
      const input = await parseBody(c, scheduleItemInputSchema);
      return c.json(
        await record(c, (db, actor) =>
          updateScheduleItem(db, actor, id, itemId, input),
        ),
      );
    },
  );
  routes.post(
    "/:id/payments/schedule/:itemId/archive",
    requirePermission("payments.record"),
    async (c) => {
      const id = idParam(c, "Event");
      const itemId = idParam(c, "Schedule item", "itemId");
      return c.json(
        await record(c, (db, actor) => archiveScheduleItem(db, actor, id, itemId)),
      );
    },
  );
  routes.post("/:id/payments", requirePermission("payments.record"), async (c) => {
    const id = idParam(c, "Event");
    const input = await parseBody(c, paymentInputSchema);
    return c.json(
      await record(c, (db, actor) => recordPayment(db, actor, id, input)),
      201,
    );
  });
  routes.post(
    "/:id/payments/:paymentId/archive",
    requirePermission("payments.record"),
    async (c) => {
      const id = idParam(c, "Event");
      const paymentId = idParam(c, "Payment", "paymentId");
      return c.json(
        await record(c, (db, actor) => archivePayment(db, actor, id, paymentId)),
      );
    },
  );
  return routes;
}
