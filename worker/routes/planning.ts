import { Hono } from "hono";
import { z } from "zod";
import { requirementsInputSchema } from "../../shared/allocation";
import {
  conflictStateSchema,
  reservationInputSchema,
  reservationUpdateSchema,
  resolveInputSchema,
} from "../../shared/reservations";
import { id as uuid, localDate } from "../../shared/schema-primitives";
import { requirePermission } from "../auth";
import {
  ApiError,
  notFound,
  parseBody,
  recordRunner,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  itemAllocations,
  listRequirements,
  setManualRequirements,
} from "../records/allocations";
import {
  eventConflicts,
  eventReservations,
  itemAvailability,
  itemConflicts,
  placeHold,
  removeHold,
  resolveConflict,
  updateHold,
} from "../records/reservations";

// Equipment holds and availability (FLOW-76), conflicts (FLOW-77) and consumable
// requirements and allocations (FLOW-85), mounted at /api. Events and items the
// user can't see answer 404.
const availabilityQuerySchema = z
  .object({ from: localDate, to: localDate })
  .refine(({ from, to }) => from <= to, "The range must end on or after it starts.")
  .refine(({ from, to }) => {
    const days = (Date.parse(to) - Date.parse(from)) / 86_400_000;
    return days <= 366;
  }, "Ask for at most a year at a time.");

export function planningRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const param = (c: AppContext, name: string, what: string) => {
    const parsed = uuid.safeParse(c.req.param(name));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };
  const stateFilter = (c: AppContext) => {
    const raw = c.req.query("state");
    if (raw === undefined) return undefined;
    const parsed = conflictStateSchema.safeParse(raw);
    if (!parsed.success)
      throw new ApiError(400, "INVALID_REQUEST", "Unknown conflict state.");
    return parsed.data;
  };

  // --- Event holds ---------------------------------------------------------
  routes.get("/events/:id/reservations", requirePermission("events.read"), async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => eventReservations(db, actor, id)));
  });
  routes.post("/events/:id/reservations", requirePermission("events.write"), async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, reservationInputSchema);
    return c.json(await record(c, (db, actor) => placeHold(db, actor, id, input)), 201);
  });
  routes.patch("/reservations/:id", requirePermission("events.write"), async (c) => {
    const id = param(c, "id", "Reservation");
    const input = await parseBody(c, reservationUpdateSchema);
    return c.json(
      await record(c, (db, actor) => updateHold(db, actor, id, input.quantity)),
    );
  });
  routes.delete("/reservations/:id", requirePermission("events.write"), async (c) => {
    const id = param(c, "id", "Reservation");
    await record(c, (db, actor) => removeHold(db, actor, id));
    return c.body(null, 204);
  });

  // --- Conflicts -----------------------------------------------------------
  routes.get("/events/:id/conflicts", requirePermission("events.read"), async (c) => {
    const id = param(c, "id", "Event");
    const state = stateFilter(c);
    return c.json(await record(c, (db, actor) => eventConflicts(db, actor, id, state)));
  });
  routes.get(
    "/inventory/items/:id/conflicts",
    requirePermission("inventory.read"),
    async (c) => {
      const id = param(c, "id", "Item");
      const state = stateFilter(c);
      return c.json(await record(c, (db, actor) => itemConflicts(db, actor, id, state)));
    },
  );
  routes.post(
    "/reservation-conflicts/:id/resolve",
    requirePermission("events.write"),
    async (c) => {
      const id = param(c, "id", "Conflict");
      const input = await parseBody(c, resolveInputSchema);
      return c.json(await record(c, (db, actor) => resolveConflict(db, actor, id, input)));
    },
  );

  // --- Availability --------------------------------------------------------
  routes.get(
    "/inventory/items/:id/availability",
    requirePermission("inventory.read"),
    async (c) => {
      const id = param(c, "id", "Item");
      const range = availabilityQuerySchema.safeParse(c.req.query());
      if (!range.success)
        throw new ApiError(
          400,
          "INVALID_REQUEST",
          range.error.issues[0]?.message ?? "Pass from and to as dates.",
        );
      return c.json(
        await record(c, (db, actor) =>
          itemAvailability(db, actor, id, range.data.from, range.data.to),
        ),
      );
    },
  );

  // --- Consumable requirements and allocations -----------------------------
  routes.get("/events/:id/requirements", requirePermission("events.read"), async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => listRequirements(db, actor, id)));
  });
  routes.put("/events/:id/requirements", requirePermission("events.write"), async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, requirementsInputSchema);
    return c.json(await record(c, (db, actor) => setManualRequirements(db, actor, id, input)));
  });
  routes.get(
    "/inventory/items/:id/allocations",
    requirePermission("inventory.read"),
    async (c) => {
      const id = param(c, "id", "Item");
      return c.json(await record(c, (db, actor) => itemAllocations(db, actor, id)));
    },
  );

  return routes;
}
