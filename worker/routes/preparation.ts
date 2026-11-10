import { Hono } from "hono";
import { kitchenLineInputSchema, kitchenLineUpdateSchema, kitchenTimesInputSchema } from "../../shared/kitchen-menu";
import { regenerateInputSchema, refreshableOutputSchema, refreshOutputInputSchema } from "../../shared/planning";
import {
  pullLineInputSchema,
  pullLineStatusInputSchema,
  pullLineUpdateSchema,
  pullScheduleInputSchema,
} from "../../shared/pull-list";
import { id as uuid } from "../../shared/schema-primitives";
import { rentalRequestUpdateSchema } from "../../shared/rental-requests";
import { truckAssignmentInputSchema, truckInputSchema, truckLineInputSchema, truckStatusSchema } from "../../shared/trucks";
import { closeoutInputSchema } from "../../shared/closeout";
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
import { closeOutEvent, getCloseout } from "../records/closeout";
import { getPlanningProgress, startPlanning } from "../records/planning";
import { previewPlanningRefresh, regeneratePlanningOutput } from "../records/planning-refresh";
import { listRentalRequests, updateRentalRequest } from "../records/rental-requests";
import { assignTruck, createTruck, getTruckLog, movePullLineToTruck, removeTruckAssignment, setTruckStatus } from "../records/trucks";
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

  // Post-event closeout and returns (FLOW-157).
  routes.get("/:id/closeout", read, async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => getCloseout(db, actor, id)));
  });
  routes.post("/:id/closeout", read, async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, closeoutInputSchema);
    return c.json(await record(c, (db, actor) => closeOutEvent(db, actor, id, input)), 201);
  });
  routes.get("/:id/trucks", read, async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => getTruckLog(db, actor, id)));
  });
  routes.post("/:id/trucks", read, async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, truckInputSchema);
    return c.json(await record(c, async (db, actor) => {
      await createTruck(db, actor, id, input.name);
      return getTruckLog(db, actor, id);
    }), 201);
  });
  routes.patch("/:id/trucks/:truckId/status", read, async (c) => {
    const id = param(c, "id", "Event"), truckId = param(c, "truckId", "Truck");
    const input = await parseBody(c, truckStatusSchema);
    return c.json(await record(c, async (db, actor) => {
      await setTruckStatus(db, actor, id, truckId, input);
      return getTruckLog(db, actor, id);
    }));
  });
  routes.post("/:id/trucks/assignments", read, async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, truckAssignmentInputSchema);
    return c.json(await record(c, (db, actor) => assignTruck(db, actor, id, input)), 201);
  });
  routes.post("/:id/trucks/assignments/:assignmentId/archive", read, async (c) => {
    const id = param(c, "id", "Event"), assignmentId = param(c, "assignmentId", "Truck assignment");
    return c.json(await record(c, (db, actor) => removeTruckAssignment(db, actor, id, assignmentId)));
  });
  routes.put("/:id/trucks/lines/:lineId", read, async (c) => {
    const id = param(c, "id", "Event"), lineId = param(c, "lineId", "Pull-list line");
    const input = await parseBody(c, truckLineInputSchema);
    return c.json(await record(c, (db, actor) => movePullLineToTruck(db, actor, id, lineId, input.truckId)));
  });

  routes.get("/:id/rental-requests", read, async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => listRentalRequests(db, actor, id)));
  });
  routes.put("/:id/rental-requests/:vendorId", read, async (c) => {
    const id = param(c, "id", "Event");
    const vendorId = param(c, "vendorId", "Vendor");
    const input = await parseBody(c, rentalRequestUpdateSchema);
    return c.json(await record(c, (db, actor) => updateRentalRequest(db, actor, id, vendorId, input)));
  });

  routes.get("/:id/planning", read, async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => getPlanningProgress(db, actor, id)));
  });
  routes.post("/:id/planning/start", read, async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => startPlanning(db, actor, id)));
  });
  routes.post("/:id/planning/outputs/:kind/preview", read, async (c) => {
    const id = param(c, "id", "Event");
    const kind = refreshableOutputSchema.parse(c.req.param("kind"));
    return c.json(await record(c, (db, actor) => previewPlanningRefresh(db, actor, id, kind)));
  });
  routes.post("/:id/planning/outputs/:kind/regenerate", read, async (c) => {
    const id = param(c, "id", "Event");
    const kind = refreshableOutputSchema.parse(c.req.param("kind"));
    const input = await parseBody(c, refreshOutputInputSchema);
    return c.json(await record(c, (db, actor) => regeneratePlanningOutput(db, actor, id, kind, input.expectedStaleAt)));
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
