import { Hono } from "hono";
import {
  dayOfCheckpointInputSchema,
  dayOfCheckpointKeySchema,
  dayOfQuerySchema,
  dayOfStaffUpdateSchema,
  dayOfTruckUpdateSchema,
} from "../../shared/day-of";
import { id as uuid } from "../../shared/schema-primitives";
import { requirePermission } from "../auth";
import { ApiError, notFound, parseBody, recordRunner, type AppContext, type AppEnv, type RunWithDb } from "../hono";
import {
  getDayOfBoard,
  getDayOfLog,
  setDayOfCheckpoint,
  updateDayOfStaff,
  updateDayOfTruck,
} from "../records/day-of";

// Day-of board and update log (FLOW-155/156), mounted at /api/day-of. Anyone who can
// open an event reads; the records check who may update.
export function dayOfRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const read = requirePermission("events.read");
  const param = (c: AppContext, name: string, what: string) => {
    const parsed = uuid.safeParse(c.req.param(name));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };

  routes.get("/", read, async (c) => {
    const query = dayOfQuerySchema.safeParse(c.req.query());
    if (!query.success)
      throw new ApiError(400, "INVALID_REQUEST", query.error.issues[0]?.message ?? "Invalid date.");
    return c.json(await record(c, (db, actor) => getDayOfBoard(db, actor, query.data.date)));
  });
  routes.get("/events/:id/log", read, async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => getDayOfLog(db, actor, id)));
  });
  routes.patch("/staff/:slotId", read, async (c) => {
    const slotId = param(c, "slotId", "Staff assignment");
    const input = await parseBody(c, dayOfStaffUpdateSchema);
    return c.json(await record(c, (db, actor) => updateDayOfStaff(db, actor, slotId, input)));
  });
  routes.patch("/trucks/:assignmentId", read, async (c) => {
    const assignmentId = param(c, "assignmentId", "Truck assignment");
    const input = await parseBody(c, dayOfTruckUpdateSchema);
    return c.json(await record(c, (db, actor) => updateDayOfTruck(db, actor, assignmentId, input)));
  });
  routes.put("/events/:id/checkpoints/:key", read, async (c) => {
    const id = param(c, "id", "Event");
    const key = dayOfCheckpointKeySchema.safeParse(c.req.param("key"));
    if (!key.success) throw notFound("Checkpoint");
    const input = await parseBody(c, dayOfCheckpointInputSchema);
    return c.json(await record(c, (db, actor) => setDayOfCheckpoint(db, actor, id, key.data, input)));
  });
  return routes;
}
