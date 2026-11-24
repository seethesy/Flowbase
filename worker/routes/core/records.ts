import { Hono } from "hono";
import {
  clientCreateSchema,
  clientInputSchema,
  eventInputSchema,
  eventStatusSchema,
  eventTransitionSchema,
  venueInputSchema,
} from "../../../shared/core-records";
import { id as uuid, localDate, withVersion } from "../../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../../auth";
import {
  archiveRoutes,
  historyRoute,
  idParam,
  pageRequest,
  parseBody,
  queryParam,
  recordRunner,
  sendPage,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../../hono";
import {
  clientHistory,
  createClient,
  getClient,
  listClients,
  setClientArchived,
  updateClient,
} from "../../records/sales/clients";
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
} from "../../records/events/events";
import {
  createVenue,
  getVenue,
  listVenues,
  setVenueArchived,
  updateVenue,
  venueHistory,
} from "../../records/sales/venues";

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
  const flag = (c: AppContext, key: string) => c.req.query(key) === "true";

  routes.get("/clients", requirePermission("clients.read"), async (c) =>
    sendPage(
      c,
      await record(c, (db, actor) =>
        listClients(
          db,
          actor,
          {
            archived: flag(c, "archived"),
            flagged: flag(c, "flagged"),
            search: queryParam(c, "search"),
          },
          pageRequest(c),
        ),
      ),
    ),
  );
  routes.get("/clients/:id", requirePermission("clients.read"), async (c) => {
    const id = idParam(c, "Client");
    return c.json(await record(c, (db, actor) => getClient(db, actor, id)));
  });
  // Record history (FLOW-41): read-only for anyone who can see the record. There
  // are deliberately no routes that change or remove audit rows.
  for (const [resource, what, read] of [
    ["clients", "Client", clientHistory],
    ["venues", "Venue", venueHistory],
    ["events", "Event", eventHistory],
  ] as const)
    historyRoute(routes, record, { path: `/${resource}/:id`, what, guard: requirePermission(`${resource}.read`), read });
  routes.post("/clients", requirePermission("clients.write"), async (c) => {
    const input = await parseBody(c, clientCreateSchema);
    return c.json(
      await record(c, (db, actor) => createClient(db, actor, input)),
      201,
    );
  });
  routes.put("/clients/:id", requirePermission("clients.write"), async (c) => {
    const id = idParam(c, "Client");
    const input = await parseBody(c, withVersion(clientInputSchema));
    return c.json(
      await record(c, (db, actor) => updateClient(db, actor, id, input)),
    );
  });
  archiveRoutes(routes, record, { path: "/clients/:id", what: "Client", guard: requirePermission("clients.write"), set: setClientArchived });
  archiveRoutes(routes, record, { path: "/venues/:id", what: "Venue", guard: requirePermission("venues.write"), set: setVenueArchived });
  archiveRoutes(routes, record, { path: "/events/:id", what: "Event", guard: requirePermission("events.write"), set: setEventArchived });

  routes.get("/venues", requirePermission("venues.read"), async (c) =>
    sendPage(
      c,
      await record(c, (db, actor) =>
        listVenues(
          db,
          actor,
          { archived: flag(c, "archived"), search: queryParam(c, "search") },
          pageRequest(c),
        ),
      ),
    ),
  );
  routes.get("/venues/:id", requirePermission("venues.read"), async (c) => {
    const id = idParam(c, "Venue");
    return c.json(await record(c, (db, actor) => getVenue(db, actor, id)));
  });
  routes.post("/venues", requirePermission("venues.write"), async (c) => {
    const input = await parseBody(c, venueInputSchema);
    return c.json(
      await record(c, (db, actor) => createVenue(db, actor, input)),
      201,
    );
  });
  routes.put("/venues/:id", requirePermission("venues.write"), async (c) => {
    const id = idParam(c, "Venue");
    const input = await parseBody(c, withVersion(venueInputSchema));
    return c.json(
      await record(c, (db, actor) => updateVenue(db, actor, id, input)),
    );
  });

  routes.get("/events", requirePermission("events.read"), async (c) => {
    const filter = {
      archived: flag(c, "archived"),
      clientId: queryParam(c, "clientId"),
      venueId: queryParam(c, "venueId"),
      from: queryParam(c, "from"),
      to: queryParam(c, "to"),
      search: queryParam(c, "search"),
      // ?status=a,b: events in any of these statuses; unknown values are ignored.
      statuses: (c.req.query("status") ?? "")
        .split(",")
        .flatMap((value) => eventStatusSchema.safeParse(value).data ?? []),
    };
    for (const key of ["clientId", "venueId"] as const)
      if (filter[key] && !uuid.safeParse(filter[key]).success)
        return sendPage(c, { rows: [], next: null });
    for (const key of ["from", "to"] as const)
      if (filter[key] && !localDate.safeParse(filter[key]).success)
        filter[key] = undefined;
    return sendPage(
      c,
      await record(c, (db, actor) =>
        listEvents(db, actor, filter, pageRequest(c)),
      ),
    );
  });
  routes.get("/events/:id", requirePermission("events.read"), async (c) => {
    const id = idParam(c, "Event");
    return c.json(await record(c, (db, actor) => getEvent(db, actor, id)));
  });
  // The event hub (FLOW-57): the event, its client and the sections the user may see.
  routes.get("/events/:id/hub", requirePermission("events.read"), async (c) => {
    const id = idParam(c, "Event");
    return c.json(await record(c, (db, actor) => getEventHub(db, actor, id)));
  });
  routes.post("/events", requirePermission("events.write"), async (c) => {
    const input = await parseBody(c, eventInputSchema);
    return c.json(
      await record(c, (db, actor) => createEvent(db, actor, input)),
      201,
    );
  });
  routes.put("/events/:id", requirePermission("events.write"), async (c) => {
    const id = idParam(c, "Event");
    const input = await parseBody(c, withVersion(eventInputSchema));
    return c.json(
      await record(c, (db, actor) => updateEvent(db, actor, id, input)),
    );
  });
  // Manual status changes (FLOW-56): Admin or the event's salesperson, checked per
  // event in shared/event-lifecycle.ts. Automatic moves have no route.
  routes.post(
    "/events/:id/status",
    requirePermission("events.status"),
    async (c) => {
      const id = idParam(c, "Event");
      const input = await parseBody(c, eventTransitionSchema);
      return c.json(
        await record(c, (db, actor) =>
          overrideEventStatus(db, actor, id, input),
        ),
      );
    },
  );
  routes.get(
    "/events/:id/status-history",
    requirePermission("events.read"),
    async (c) => {
      const id = idParam(c, "Event");
      return sendPage(
        c,
        await record(c, (db, actor) =>
          eventStatusChanges(db, actor, id, pageRequest(c)),
        ),
      );
    },
  );
  return routes;
}
