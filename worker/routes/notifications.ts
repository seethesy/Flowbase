import { Hono } from "hono";
import { notificationPreferencesInputSchema } from "../../shared/notifications";
import { id as uuid } from "../../shared/schema-primitives";
import { requirePermission } from "../auth";
import {
  notFound,
  parseBody,
  recordRunner,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  getInbox,
  getPreferences,
  markAllRead,
  markRead,
  setPreferences,
} from "../records/notifications";

// The notification center and email preferences (FLOW-43), mounted at
// /api/notifications. Every route acts on the signed-in user's own data.
export function notificationRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const guard = requirePermission("notifications.read");

  routes.get("/", guard, async (c) =>
    c.json(await record(c, (db, actor) => getInbox(db, actor))),
  );
  routes.post("/read-all", guard, async (c) =>
    c.json(await record(c, (db, actor) => markAllRead(db, actor))),
  );
  routes.get("/preferences", guard, async (c) =>
    c.json(await record(c, (db, actor) => getPreferences(db, actor))),
  );
  routes.put("/preferences", guard, async (c) => {
    const input = await parseBody(c, notificationPreferencesInputSchema);
    return c.json(
      await record(c, (db, actor) => setPreferences(db, actor, input)),
    );
  });
  routes.post("/:id/read", guard, async (c) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Notification");
    return c.json(
      await record(c, (db, actor) => markRead(db, actor, parsed.data)),
    );
  });
  return routes;
}
