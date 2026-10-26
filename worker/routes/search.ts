import { Hono } from "hono";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import { recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { globalSearch } from "../records/search";

// Global search (FLOW-46), mounted at /api/search: GET /api/search?q=<text>. Needs a
// signed-in user; results cover only what that user may see.
export function searchRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  routes.get("/", requirePermission("search.read"), async (c) =>
    c.json(
      await record(c, (db, actor) =>
        globalSearch(db, actor, c.req.query("q") ?? ""),
      ),
    ),
  );
  return routes;
}
