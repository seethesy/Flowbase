import { Hono } from "hono";
import { z } from "zod";
import {
  clientCreateSchema,
  clientInputSchema,
  eventInputSchema,
  venueInputSchema,
} from "../../shared/core-records";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import {
  notFound,
  parseBody,
  runDb,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  createClient,
  getClient,
  listClients,
  setClientArchived,
  updateClient,
} from "../records/clients";
import {
  createEvent,
  getEvent,
  listEvents,
  setEventArchived,
  updateEvent,
} from "../records/events";
import {
  createVenue,
  getVenue,
  listVenues,
  setVenueArchived,
  updateVenue,
} from "../records/venues";

const uuid = z.string().uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Core records API (FLOW-53/54/55): /api/clients, /api/venues, /api/events. Every
// route needs a signed-in user; records the user can't see answer 404.
export function recordRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
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
      await runDb(options.withDb, c.env, (tx) =>
        listClients(tx, c.get("actor"), {
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
      await runDb(options.withDb, c.env, (tx) =>
        getClient(tx, c.get("actor"), id),
      ),
    );
  });
  routes.post("/clients", requirePermission("clients.write"), async (c) => {
    const input = await parseBody(c, clientCreateSchema);
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        createClient(tx, c.get("actor"), input),
      ),
      201,
    );
  });
  routes.put("/clients/:id", requirePermission("clients.write"), async (c) => {
    const id = param(c, "Client");
    const input = await parseBody(c, clientInputSchema);
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        updateClient(tx, c.get("actor"), id, input),
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
          await runDb(options.withDb, c.env, (tx) =>
            setClientArchived(tx, c.get("actor"), id, archived),
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
          await runDb(options.withDb, c.env, (tx) =>
            setVenueArchived(tx, c.get("actor"), id, archived),
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
          await runDb(options.withDb, c.env, (tx) =>
            setEventArchived(tx, c.get("actor"), id, archived),
          ),
        );
      },
    );
  }

  routes.get("/venues", async (c) =>
    c.json(
      await runDb(options.withDb, c.env, (tx) =>
        listVenues(tx, c.get("actor"), {
          archived: flag(c, "archived"),
          search: query(c, "search"),
        }),
      ),
    ),
  );
  routes.get("/venues/:id", async (c) => {
    const id = param(c, "Venue");
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        getVenue(tx, c.get("actor"), id),
      ),
    );
  });
  routes.post("/venues", requirePermission("venues.write"), async (c) => {
    const input = await parseBody(c, venueInputSchema);
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        createVenue(tx, c.get("actor"), input),
      ),
      201,
    );
  });
  routes.put("/venues/:id", requirePermission("venues.write"), async (c) => {
    const id = param(c, "Venue");
    const input = await parseBody(c, venueInputSchema);
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        updateVenue(tx, c.get("actor"), id, input),
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
      await runDb(options.withDb, c.env, (tx) =>
        listEvents(tx, c.get("actor"), filter),
      ),
    );
  });
  routes.get("/events/:id", async (c) => {
    const id = param(c, "Event");
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        getEvent(tx, c.get("actor"), id),
      ),
    );
  });
  routes.post("/events", requirePermission("events.write"), async (c) => {
    const input = await parseBody(c, eventInputSchema);
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        createEvent(tx, c.get("actor"), input),
      ),
      201,
    );
  });
  routes.put("/events/:id", requirePermission("events.write"), async (c) => {
    const id = param(c, "Event");
    const input = await parseBody(c, eventInputSchema);
    return c.json(
      await runDb(options.withDb, c.env, (tx) =>
        updateEvent(tx, c.get("actor"), id, input),
      ),
    );
  });
  return routes;
}
