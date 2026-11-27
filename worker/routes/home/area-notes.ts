import { Hono } from "hono";
import { areaNoteInputSchema, areaNoteKeySchema } from "../../../shared/area-notes";
import { requireActor, requirePermission, type ResolveActor } from "../../auth";
import { ApiError, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../../hono";
import { getAreaNote, saveAreaNote } from "../../records/home/area-notes";

// Shared area notes (FLOW-341 A2). Every key today is a Marketing tab, so
// marketing.read both reads and saves: the Notes card is "typable to regular
// users", not an Admin-only live edit.
export function areaNoteRoutes(options: { withDb?: RunWithDb; resolveActor?: ResolveActor }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  const keyOf = (value: string | undefined) => {
    const key = areaNoteKeySchema.safeParse(value);
    if (!key.success) throw new ApiError(404, "NOT_FOUND", "No notes here.");
    return key.data;
  };
  routes.get("/:key", requirePermission("marketing.read"), async (c) => {
    const key = keyOf(c.req.param("key"));
    return c.json(await record(c, (db) => getAreaNote(db, key)));
  });
  routes.put("/:key", requirePermission("marketing.read"), async (c) => {
    const key = keyOf(c.req.param("key"));
    const input = await parseBody(c, areaNoteInputSchema);
    return c.json(await record(c, (db, actor) => saveAreaNote(db, actor, key, input)));
  });
  return routes;
}
