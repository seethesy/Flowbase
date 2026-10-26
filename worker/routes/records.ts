import { Hono } from "hono";
import {
  clientCreateSchema,
  clientInputSchema,
  eventInputSchema,
  eventTransitionSchema,
  venueInputSchema,
} from "../../shared/core-records";
import { id as uuid, localDate } from "../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import {
  notFound,
  parseBody,
  recordRunner,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  clientHistory,
  createClient,
  getClient,
  listClients,
  setClientArchived,
  updateClient,
} from "../records/clients";
import {
  createEvent,
  eventHistory,
  eventStatusChanges,
  getEvent,
  getEventHub,
  listEvents,
  overrideEventStatus,
  setEventArchived,
  updateEvent,
} from "../records/events";
import {
  createVenue,
  getVenue,
  listVenues,
  setVenueArchived,
  updateVenue,
  venueHistory,
} from "../records/venues";

// Core records API (FLOW-53/54/55, history FLOW-41): /api/clients, /api/venues, /api/events. Every
// route needs a signed-in user; records the user can't see answer 404.
export function recordRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  // Mounted at /api, so the sign-in check is scoped to these resources only.
  const signedIn = requireActor(options.resolveActor);
  for (const resource of ["clients", "venues", "events"])
    routes.use(`/${resource}`, signedIn).use(`/${resource}/*`, signedIn);
  const param = (c: AppContext, what: string) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };
  const query = (c: AppContext, key: string) => c.req.query(key) || undefined;
  const flag = (c: AppContext, key: string) => c.req.query(key) === "true";

  routes.get("/clients", async (c) =>
    c.json(
      await record(c, (db, actor) =>
        listClients(db, actor, {
          archived: flag(c, "archived"),
          flagged: flag(c, "flagged"),
          search: query(c, "search"),
        }),
      ),
    ),
  );
  routes.get("/clients/:id", async (c) => {
    const id = param(c, "Client");
    return c.json(
      await record(c, (db, actor) =>
        getClient(db, actor, id),
      ),
    );
  });
  // Record history (FLOW-41): read-only for anyone who can see the record. There
  // are deliberately no routes that change or remove audit rows.
  for (const [resource, what, history] of [
    ["clients", "Client", clientHistory],
    ["venues", "Venue", venueHistory],
    ["events", "Event", eventHistory],
  ] as const)
    routes.get(`/${resource}/:id/history`, async (c) => {
      const id = param(c, what);
      return c.json(
        await record(c, (db, actor) =>
          history(db, actor, id),
        ),
      );
    });
  routes.post("/clients", requirePermission("clients.write"), async (c) => {
    const input = await parseBody(c, clientCreateSchema);
    return c.json(
      await record(c, (db, actor) =>
        createClient(db, actor, input),
      ),
      201,
    );
  });
  routes.put("/clients/:id", requirePermission("clients.write"), async (c) => {
    const id = param(c, "Client");
    const input = await parseBody(c, clientInputSchema);
    return c.json(
      await record(c, (db, actor) =>
        updateClient(db, actor, id, input),
      ),
    );
  });
  for (const [action, archived] of [
    ["archive", true],
    ["restore", false],
  ] as const) {
    routes.post(
      `/clients/:id/${action}`,
      requirePermission("clients.write"),
      async (c) => {
        const id = param(c, "Client");
        return c.json(
          await record(c, (db, actor) =>
            setClientArchived(db, actor, id, archived),
          ),
        );
      },
    );
    routes.post(
      `/venues/:id/${action}`,
      requirePermission("venues.write"),
      async (c) => {
        const id = param(c, "Venue");
        return c.json(
          await record(c, (db, actor) =>
            setVenueArchived(db, actor, id, archived),
          ),
        );
      },
    );
    routes.post(
      `/events/:id/${action}`,
      requirePermission("events.write"),
      async (c) => {
        const id = param(c, "Event");
        return c.json(
          await record(c, (db, actor) =>
            setEventArchived(db, actor, id, archived),
          ),
        );
      },
    );
  }

  routes.get("/venues", async (c) =>
    c.json(
      await record(c, (db, actor) =>
        listVenues(db, actor, {
          archived: flag(c, "archived"),
          search: query(c, "search"),
        }),
      ),
    ),
  );
  routes.get("/venues/:id", async (c) => {
    const id = param(c, "Venue");
    return c.json(
      await record(c, (db, actor) =>
        getVenue(db, actor, id),
      ),
    );
  });
  routes.post("/venues", requirePermission("venues.write"), async (c) => {
    const input = await parseBody(c, venueInputSchema);
    return c.json(
      await record(c, (db, actor) =>
        createVenue(db, actor, input),
      ),
      201,
    );
  });
  routes.put("/venues/:id", requirePermission("venues.write"), async (c) => {
    const id = param(c, "Venue");
    const input = await parseBody(c, venueInputSchema);
    return c.json(
      await record(c, (db, actor) =>
        updateVenue(db, actor, id, input),
      ),
    );
  });

  routes.get("/events", async (c) => {
    const filter = {
      archived: flag(c, "archived"),
      clientId: query(c, "clientId"),
      venueId: query(c, "venueId"),
      from: query(c, "from"),
      to: query(c, "to"),
    };
    for (const key of ["clientId", "venueId"] as const)
      if (filter[key] && !uuid.safeParse(filter[key]).success)
        return c.json([]);
    for (const key of ["from", "to"] as const)
      if (filter[key] && !localDate.safeParse(filter[key]).success)
        filter[key] = undefined;
    return c.json(
      await record(c, (db, actor) =>
        listEvents(db, actor, filter),
      ),
    );
  });
  routes.get("/events/:id", async (c) => {
    const id = param(c, "Event");
    return c.json(
      await record(c, (db, actor) =>
        getEvent(db, actor, id),
      ),
    );
  });
  // The event hub (FLOW-57): the event, its client and the sections the user may see.
  routes.get("/events/:id/hub", async (c) => {
    const id = param(c, "Event");
    return c.json(
      await record(c, (db, actor) =>
        getEventHub(db, actor, id),
      ),
    );
  });
  routes.post("/events", requirePermission("events.write"), async (c) => {
    const input = await parseBody(c, eventInputSchema);
    return c.json(
      await record(c, (db, actor) =>
        createEvent(db, actor, input),
      ),
      201,
    );
  });
  routes.put("/events/:id", requirePermission("events.write"), async (c) => {
    const id = param(c, "Event");
    const input = await parseBody(c, eventInputSchema);
    return c.json(
      await record(c, (db, actor) =>
        updateEvent(db, actor, id, input),
      ),
    );
  });
  // Manual status changes (FLOW-56): Admin or the event's salesperson, checked per
  // event in shared/event-lifecycle.ts. Automatic moves have no route.
  routes.post("/events/:id/status", async (c) => {
    const id = param(c, "Event");
    const input = await parseBody(c, eventTransitionSchema);
    return c.json(
      await record(c, (db, actor) =>
        overrideEventStatus(db, actor, id, input),
      ),
    );
  });
  routes.get("/events/:id/status-history", async (c) => {
    const id = param(c, "Event");
    return c.json(
      await record(c, (db, actor) =>
        eventStatusChanges(db, actor, id),
      ),
    );
  });
  return routes;
}
