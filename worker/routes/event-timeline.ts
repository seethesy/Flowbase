import { Hono } from "hono";
import { timelineEntryInputSchema } from "../../shared/event-timeline";
import { id as uuid } from "../../shared/schema-primitives";
import { requirePermission } from "../auth";
import {
  notFound,
  parseBody,
  recordRunner,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  archiveTimelineEntry,
  createTimelineEntry,
  getTimeline,
  updateTimelineEntry,
} from "../records/event-timeline";

// Event timeline and production schedule (FLOW-126), mounted at /api/events. Every
// call answers with the whole timeline. Events the user can't see answer 404.
export function eventTimelineRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const param = (c: AppContext, name: string, what: string) => {
    const parsed = uuid.safeParse(c.req.param(name));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };

  routes.get("/:id/timeline", requirePermission("events.read"), async (c) => {
    const id = param(c, "id", "Event");
    return c.json(await record(c, (db, actor) => getTimeline(db, actor, id)));
  });
  routes.post("/:id/timeline", requirePermission("events.write"), async (c) => {
    const id = param(c, "id", "Event");
    const input = await parseBody(c, timelineEntryInputSchema);
    return c.json(
      await record(c, (db, actor) => createTimelineEntry(db, actor, id, input)),
      201,
    );
  });
  routes.put(
    "/:id/timeline/:entryId",
    requirePermission("events.write"),
    async (c) => {
      const id = param(c, "id", "Event");
      const entryId = param(c, "entryId", "Timeline entry");
      const input = await parseBody(c, timelineEntryInputSchema);
      return c.json(
        await record(c, (db, actor) =>
          updateTimelineEntry(db, actor, id, entryId, input),
        ),
      );
    },
  );
  routes.post(
    "/:id/timeline/:entryId/archive",
    requirePermission("events.write"),
    async (c) => {
      const id = param(c, "id", "Event");
      const entryId = param(c, "entryId", "Timeline entry");
      return c.json(
        await record(c, (db, actor) =>
          archiveTimelineEntry(db, actor, id, entryId),
        ),
      );
    },
  );
  return routes;
}
