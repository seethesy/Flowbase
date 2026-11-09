import type { MiddlewareHandler } from "hono";
import type { AppEnv, RunWithDb } from "./hono";
import { syncBeo } from "./records/beo";

// FLOW-144: after any successful write under /api/events/<id> (the event itself,
// its kitchen menu, roster, timeline or pull list), compares the event's BEO with
// its last snapshot, so every edit made after approval is logged and told to the
// staff. The BEO's own routes check themselves. A failed check is logged and
// never fails the edit that was already saved: the next check compares against
// the same snapshot, so nothing is lost. Events without a BEO cost one query.
const eventPath = /^\/api\/events\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/(.*))?$/i;

export const beoSync =
  (withDb: RunWithDb | undefined): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    await next();
    if (!withDb || ["GET", "HEAD", "OPTIONS"].includes(c.req.method) || c.res.status >= 400) return;
    const match = eventPath.exec(c.req.path);
    if (!match || /^beo(\/|$)/.test(match[2] ?? "")) return;
    const actor = c.get("actor");
    if (!actor) return;
    try {
      await withDb(c.env, (db) => db.transaction((tx) => syncBeo(tx, actor, match[1])));
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "beo_sync_failed",
          eventId: match[1],
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  };
