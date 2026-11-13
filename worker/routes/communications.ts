import { Hono } from "hono";
import { communicationInputSchema } from "../../shared/communications";
import { id as uuid } from "../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import {
  ApiError,
  pageRequest,
  parseBody,
  recordRunner,
  sendPage,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  listCommunications,
  logCommunication,
} from "../records/communications";

// Communication log API (FLOW-120), mounted at /api/communications. Roles that sell
// log and read; each call resolves the lead, client or event through its own
// visibility rules, so records the user cannot open answer 404.
export function communicationRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  const target = (c: AppContext) => {
    const given = (["leadId", "clientId", "eventId"] as const).flatMap((key) => {
      const value = c.req.query(key);
      if (value === undefined) return [];
      const parsed = uuid.safeParse(value);
      if (!parsed.success)
        throw new ApiError(400, "INVALID_REQUEST", "Invalid record id.");
      return [[key, parsed.data] as const];
    });
    if (given.length !== 1)
      throw new ApiError(400, "INVALID_REQUEST", "Choose one lead, client or event.");
    return Object.fromEntries(given) as {
      leadId?: string;
      clientId?: string;
      eventId?: string;
    };
  };
  routes.get("/", requirePermission("clients.read"), async (c) => {
    const filter = target(c);
    return sendPage(
      c,
      await record(c, (db, actor) =>
        listCommunications(db, actor, filter, pageRequest(c)),
      ),
    );
  });
  routes.post("/", requirePermission("clients.write"), async (c) => {
    const input = await parseBody(c, communicationInputSchema);
    return c.json(
      await record(c, (db, actor) => logCommunication(db, actor, input)),
      201,
    );
  });
  return routes;
}
