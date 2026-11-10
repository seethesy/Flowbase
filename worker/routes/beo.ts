import { Hono } from "hono";
import { beoNotesInputSchema } from "../../shared/beo";
import { id as uuid } from "../../shared/schema-primitives";
import { requirePermission } from "../auth";
import { notFound, parseBody, recordRunner, type AppContext, type AppEnv, type RunWithDb } from "../hono";
import { approveBeo, createBeo, getBeo, requestBeoApproval, updateBeoNotes } from "../records/beo";

// The banquet event order (FLOW-143, 144, 148), mounted at /api/events. Anyone who
// can open the event reads the BEO, as projectBeo allows their role; an event they
// can't open answers 404. The records check who may generate, edit and approve.
export function beoRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const eventId = (c: AppContext) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Event");
    return parsed.data;
  };
  const read = requirePermission("events.read");

  routes.get("/:id/beo", read, async (c) => {
    const id = eventId(c);
    return c.json(await record(c, (db, actor) => getBeo(db, actor, id)));
  });
  routes.post("/:id/beo", read, async (c) => {
    const id = eventId(c);
    return c.json(await record(c, (db, actor) => createBeo(db, actor, id)), 201);
  });
  routes.patch("/:id/beo", read, async (c) => {
    const id = eventId(c);
    const input = await parseBody(c, beoNotesInputSchema);
    return c.json(await record(c, (db, actor) => updateBeoNotes(db, actor, id, input)));
  });
  routes.post("/:id/beo/request-approval", read, async (c) => {
    const id = eventId(c);
    return c.json(await record(c, (db, actor) => requestBeoApproval(db, actor, id)));
  });
  routes.post("/:id/beo/approve", read, async (c) => {
    const id = eventId(c);
    return c.json(await record(c, (db, actor) => approveBeo(db, actor, id)));
  });
  return routes;
}
