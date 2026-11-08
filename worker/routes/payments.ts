import { Hono } from "hono";
import {
  paymentInputSchema,
  scheduleItemInputSchema,
} from "../../shared/payments";
import { id as uuid } from "../../shared/schema-primitives";
import { requirePermission } from "../auth";
import {
  notFound,
  parseBody,
  recordRunner,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  archivePayment,
  archiveScheduleItem,
  createScheduleItem,
  getEventPayments,
  recordPayment,
  updateScheduleItem,
} from "../records/payments";

// Payment schedule and log (FLOW-131), mounted at /api/events. The record layer
// answers 403 unless the user is full-time staff who may see the event's
// financials, so a part-time user never receives an amount.
export function paymentRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const param = (c: AppContext, name: string, what: string) => {
    const parsed = uuid.safeParse(c.req.param(name));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };

  routes.get("/:id/payments", requirePermission("events.read"), async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => getEventPayments(db, actor, id)));
  });
  routes.post(
    "/:id/payments/schedule",
    requirePermission("payments.record"),
    async (c) => {
      const id = param(c, "id", "Event");
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
      const id = param(c, "id", "Event");
      const itemId = param(c, "itemId", "Schedule item");
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
      const id = param(c, "id", "Event");
      const itemId = param(c, "itemId", "Schedule item");
      return c.json(
        await record(c, (db, actor) => archiveScheduleItem(db, actor, id, itemId)),
      );
    },
  );
  routes.post("/:id/payments", requirePermission("payments.record"), async (c) => {
    const id = param(c, "id", "Event");
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
      const id = param(c, "id", "Event");
      const paymentId = param(c, "paymentId", "Payment");
      return c.json(
        await record(c, (db, actor) => archivePayment(db, actor, id, paymentId)),
      );
    },
  );
  return routes;
}
