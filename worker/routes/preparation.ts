import { Hono } from "hono";
import { kitchenLineInputSchema, kitchenLineUpdateSchema, kitchenTimesInputSchema } from "../../shared/kitchen-menu";
import { regenerateInputSchema } from "../../shared/planning";
import {
  pullLineInputSchema,
  pullLineStatusInputSchema,
  pullLineUpdateSchema,
  pullScheduleInputSchema,
} from "../../shared/pull-list";
import { id as uuid } from "../../shared/schema-primitives";
import { requirePermission } from "../auth";
import { notFound, parseBody, recordRunner, type AppContext, type AppEnv, type RunWithDb } from "../hono";
import {
  addKitchenLine,
  getKitchenMenu,
  previewKitchenRegeneration,
  regenerateKitchenMenu,
  removeKitchenLine,
  setLeavesKitchen,
  updateKitchenLine,
} from "../records/kitchen-menu";
import { getPlanningProgress, startPlanning } from "../records/planning";
import {
  addPullLine,
  getPullList,
  previewPullRegeneration,
  regeneratePullList,
  removePullLine,
  setPullLineStatus,
  setPullSchedule,
  updatePullLine,
} from "../records/pull-list";

// Start planning, the pull list and the kitchen menu (FLOW-133/134/137), mounted at
// /api/events. Anyone who can open the event reads; the records check who may edit.
export function preparationRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const param = (c: AppContext, name: string, what: string) => {
    const parsed = uuid.safeParse(c.req.param(name));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };
  const read = requirePermission("events.read");

  routes.get("/:id/planning", read, async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => getPlanningProgress(db, actor, id)));
  });
  routes.post("/:id/planning/start", read, async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => startPlanning(db, actor, id)));
  });

  // Pull list
  routes.get("/:id/pull-list", read, async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => getPullList(db, actor, id)));
  });
  routes.post("/:id/pull-list/lines", read, async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, pullLineInputSchema);
    return c.json(await record(c, (db, actor) => addPullLine(db, actor, id, input)), 201);
  });
  routes.patch("/:id/pull-list/lines/:lineId", read, async (c) => {
    const id = param(c, "id", "Event");
    const lineId = param(c, "lineId", "Pull list line");
    const input = await parseBody(c, pullLineUpdateSchema);
    return c.json(await record(c, (db, actor) => updatePullLine(db, actor, id, lineId, input)));
  });
  routes.post("/:id/pull-list/lines/:lineId/status", read, async (c) => {
    const id = param(c, "id", "Event");
    const lineId = param(c, "lineId", "Pull list line");
    const input = await parseBody(c, pullLineStatusInputSchema);
    return c.json(
      await record(c, (db, actor) => setPullLineStatus(db, actor, id, lineId, input.status)),
    );
  });
  routes.post("/:id/pull-list/lines/:lineId/archive", read, async (c) => {
    const id = param(c, "id", "Event");
    const lineId = param(c, "lineId", "Pull list line");
    return c.json(await record(c, (db, actor) => removePullLine(db, actor, id, lineId)));
  });
  routes.put("/:id/pull-list/schedule", read, async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, pullScheduleInputSchema);
    return c.json(await record(c, (db, actor) => setPullSchedule(db, actor, id, input)));
  });
  routes.post("/:id/pull-list/regenerate/preview", read, async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, regenerateInputSchema);
    return c.json(
      await record(c, (db, actor) => previewPullRegeneration(db, actor, id, input.discardEdits)),
    );
  });
  routes.post("/:id/pull-list/regenerate", read, async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, regenerateInputSchema);
    return c.json(
      await record(c, (db, actor) => regeneratePullList(db, actor, id, input.discardEdits)),
    );
  });

  // Kitchen menu
  routes.get("/:id/kitchen-menu", read, async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => getKitchenMenu(db, actor, id)));
  });
  routes.post("/:id/kitchen-menu/lines", read, async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, kitchenLineInputSchema);
    return c.json(await record(c, (db, actor) => addKitchenLine(db, actor, id, input)), 201);
  });
  routes.patch("/:id/kitchen-menu/lines/:lineId", read, async (c) => {
    const id = param(c, "id", "Event");
    const lineId = param(c, "lineId", "Menu line");
    const input = await parseBody(c, kitchenLineUpdateSchema);
    return c.json(await record(c, (db, actor) => updateKitchenLine(db, actor, id, lineId, input)));
  });
  routes.post("/:id/kitchen-menu/lines/:lineId/archive", read, async (c) => {
    const id = param(c, "id", "Event");
    const lineId = param(c, "lineId", "Menu line");
    return c.json(await record(c, (db, actor) => removeKitchenLine(db, actor, id, lineId)));
  });
  routes.put("/:id/kitchen-menu/times", read, async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, kitchenTimesInputSchema);
    return c.json(
      await record(c, (db, actor) => setLeavesKitchen(db, actor, id, input.leavesKitchenTime)),
    );
  });
  routes.post("/:id/kitchen-menu/regenerate/preview", read, async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, regenerateInputSchema);
    return c.json(
      await record(c, (db, actor) => previewKitchenRegeneration(db, actor, id, input.discardEdits)),
    );
  });
  routes.post("/:id/kitchen-menu/regenerate", read, async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, regenerateInputSchema);
    return c.json(
      await record(c, (db, actor) => regenerateKitchenMenu(db, actor, id, input.discardEdits)),
    );
  });
  return routes;
}
