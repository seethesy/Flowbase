import { Hono } from "hono";
import { requireActor, type ResolveActor } from "../auth";
import { runDb, type AppEnv, type RunWithDb } from "../hono";
import { globalSearch } from "../records/search";

// Global search (FLOW-46), mounted at /api/search: GET /api/search?q=<text>. Needs a
// signed-in user; results cover only what that user may see.
export function searchRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  routes.use("*", requireActor(options.resolveActor));
  routes.get("/", async (c) =>
    c.json(
      await runDb(options.withDb, c.env, (tx) =>
        globalSearch(tx, c.get("actor"), c.req.query("q") ?? ""),
      ),
    ),
  );
  return routes;
}
