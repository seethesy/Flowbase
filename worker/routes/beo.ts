import { Hono } from "hono";
import {
  beoAreaInputSchema,
  beoAreaUpdateSchema,
  beoNotesInputSchema,
  beoSceneInputSchema,
  checkItemInputSchema,
  cleanupInputSchema,
  layoutCopyInputSchema,
  runOfShowInputSchema,
} from "../../shared/beo";
import { id as uuid } from "../../shared/schema-primitives";
import { requirePermission } from "../auth";
import { notFound, parseBody, recordRunner, type AppContext, type AppEnv, type RunWithDb } from "../hono";
import { approveBeo, createBeo, getBeo, offlineBeos, requestBeoApproval, updateBeoNotes } from "../records/beo";
import {
  archiveArea,
  checkCleanupItem,
  copyLayout,
  createArea,
  getAreaScene,
  saveAreaScene,
  saveCleanup,
  saveRunOfShow,
  updateArea,
} from "../records/beo-edit";

// The banquet event order (FLOW-143, 144, 148), mounted at /api/events. Anyone who
// can open the event reads the BEO, as projectBeo allows their role; an event they
// can't open answers 404. The records check who may generate, edit and approve.
// The run of show, areas, layouts and cleanup checklist (FLOW-145, 146, 147) are
// edited through the routes below.
export function beoRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const param = (c: AppContext, name: string, what: string) => {
    const parsed = uuid.safeParse(c.req.param(name));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };
  const eventId = (c: AppContext) => param(c, "id", "Event");
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

  // Run of show (FLOW-145).
  routes.put("/:id/beo/run-of-show", read, async (c) => {
    const id = eventId(c);
    const input = await parseBody(c, runOfShowInputSchema);
    return c.json(await record(c, (db, actor) => saveRunOfShow(db, actor, id, input)));
  });

  // Setup and layout areas (FLOW-146, 147).
  routes.post("/:id/beo/areas", read, async (c) => {
    const id = eventId(c);
    const input = await parseBody(c, beoAreaInputSchema);
    return c.json(await record(c, (db, actor) => createArea(db, actor, id, input)), 201);
  });
  routes.patch("/:id/beo/areas/:areaId", read, async (c) => {
    const id = eventId(c);
    const areaId = param(c, "areaId", "Area");
    const input = await parseBody(c, beoAreaUpdateSchema);
    return c.json(await record(c, (db, actor) => updateArea(db, actor, id, areaId, input)));
  });
  routes.delete("/:id/beo/areas/:areaId", read, async (c) => {
    const id = eventId(c);
    const areaId = param(c, "areaId", "Area");
    return c.json(await record(c, (db, actor) => archiveArea(db, actor, id, areaId)));
  });
  routes.get("/:id/beo/areas/:areaId/scene", read, async (c) => {
    const id = eventId(c);
    const areaId = param(c, "areaId", "Area");
    return c.json(await record(c, (db, actor) => getAreaScene(db, actor, id, areaId)));
  });
  routes.put("/:id/beo/areas/:areaId/scene", read, async (c) => {
    const id = eventId(c);
    const areaId = param(c, "areaId", "Area");
    const input = await parseBody(c, beoSceneInputSchema);
    return c.json(await record(c, (db, actor) => saveAreaScene(db, actor, id, areaId, input)));
  });
  routes.post("/:id/beo/layout/copy", read, async (c) => {
    const id = eventId(c);
    const input = await parseBody(c, layoutCopyInputSchema);
    return c.json(await record(c, (db, actor) => copyLayout(db, actor, c.env, id, input)));
  });

  // Cleanup checklist (FLOW-146).
  routes.put("/:id/beo/cleanup", read, async (c) => {
    const id = eventId(c);
    const input = await parseBody(c, cleanupInputSchema);
    return c.json(await record(c, (db, actor) => saveCleanup(db, actor, id, input)));
  });
  routes.patch("/:id/beo/cleanup/:itemId", read, async (c) => {
    const id = eventId(c);
    const itemId = param(c, "itemId", "Checklist item");
    const input = await parseBody(c, checkItemInputSchema);
    return c.json(await record(c, (db, actor) => checkCleanupItem(db, actor, id, itemId, input.checked)));
  });
  return routes;
}

// The approved BEOs of the signed-in person's upcoming events, for offline use
// (FLOW-150), mounted at /api/offline-beos.
export function offlineBeoRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.get("/", requirePermission("events.read"), async (c) =>
    c.json(await record(c, (db, actor) => offlineBeos(db, actor))),
  );
  return routes;
}
