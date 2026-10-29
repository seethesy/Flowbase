import { Hono } from "hono";
import {
  productionLeadsInputSchema,
  removalOptionsSchema,
  shiftInputSchema,
  slotInputSchema,
  slotUpdateSchema,
} from "../../shared/event-staff";
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
  addSlots,
  archiveShift,
  archiveSlot,
  createShift,
  getRoster,
  updateShift,
  updateSlot,
} from "../records/event-staff";
import { setProductionLeads } from "../records/events";

// Staff roster and Production Leads (FLOW-140), mounted at /api/events. Every
// roster call answers with the whole roster. Events the user can't see answer 404.
export function eventStaffRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const param = (c: AppContext, name: string, what: string) => {
    const parsed = uuid.safeParse(c.req.param(name));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };
  const eventId = (c: AppContext) => param(c, "id", "Event");

  routes.get("/:id/roster", requirePermission("events.read"), async (c) => {
    const id = eventId(c);
    return c.json(await record(c, (db, actor) => getRoster(db, actor, id)));
  });
  routes.put(
    "/:id/production-leads",
    requirePermission("events.production_leads"),
    async (c) => {
      const id = eventId(c);
      const input = await parseBody(c, productionLeadsInputSchema);
      return c.json(
        await record(c, (db, actor) => setProductionLeads(db, actor, id, input)),
      );
    },
  );
  routes.post("/:id/shifts", requirePermission("events.write"), async (c) => {
    const id = eventId(c);
    const input = await parseBody(c, shiftInputSchema);
    return c.json(
      await record(c, (db, actor) => createShift(db, actor, id, input)),
      201,
    );
  });
  routes.put(
    "/:id/shifts/:shiftId",
    requirePermission("events.write"),
    async (c) => {
      const id = eventId(c);
      const shiftId = param(c, "shiftId", "Shift");
      const input = await parseBody(c, shiftInputSchema);
      return c.json(
        await record(c, (db, actor) =>
          updateShift(db, actor, id, shiftId, input),
        ),
      );
    },
  );
  routes.post(
    "/:id/shifts/:shiftId/archive",
    requirePermission("events.write"),
    async (c) => {
      const id = eventId(c);
      const shiftId = param(c, "shiftId", "Shift");
      const options = await parseBody(c, removalOptionsSchema);
      return c.json(
        await record(c, (db, actor) => archiveShift(db, actor, id, shiftId, options.notifyRemovedStaff)),
      );
    },
  );
  routes.post("/:id/slots", requirePermission("events.write"), async (c) => {
    const id = eventId(c);
    const input = await parseBody(c, slotInputSchema);
    return c.json(
      await record(c, (db, actor) => addSlots(db, actor, id, input)),
      201,
    );
  });
  routes.patch(
    "/:id/slots/:slotId",
    requirePermission("events.write"),
    async (c) => {
      const id = eventId(c);
      const slotId = param(c, "slotId", "Staffing slot");
      const input = await parseBody(c, slotUpdateSchema);
      return c.json(
        await record(c, (db, actor) =>
          updateSlot(db, actor, id, slotId, input),
        ),
      );
    },
  );
  routes.post(
    "/:id/slots/:slotId/archive",
    requirePermission("events.write"),
    async (c) => {
      const id = eventId(c);
      const slotId = param(c, "slotId", "Staffing slot");
      const options = await parseBody(c, removalOptionsSchema);
      return c.json(await record(c, (db, actor) =>
        archiveSlot(db, actor, id, slotId, options.notifyRemovedStaff)));
    },
  );
  return routes;
}
