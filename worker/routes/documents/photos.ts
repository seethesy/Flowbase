import { Hono } from "hono";
import { photoAreaSchema, photoChangeSchema } from "../../../shared/photos";
import { requireActor, requirePermission, type ResolveActor } from "../../auth";
import { ApiError, idParam, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../../hono";
import { archivePhoto, changePhoto, listPhotos } from "../../records/documents/photos";

// /api/photos (FLOW-271, FLOW-298). Each gallery checks its own area (Marketing
// photos, Kitchen, Inventory) in worker/records/documents/photos.ts, so the route guard is
// only the signed-in check every user passes.
export function photoRoutes(options: { withDb?: RunWithDb; resolveActor?: ResolveActor }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  routes.get("/", requirePermission("auth.read"), async (c) => {
    const area = photoAreaSchema.safeParse(c.req.query("area") ?? "marketing");
    if (!area.success) throw new ApiError(400, "INVALID_FILTER", "Invalid photo gallery.");
    return c.json(await record(c, (db, actor) => listPhotos(db, actor, c.env ?? {}, area.data)));
  });
  routes.patch("/:id", requirePermission("auth.read"), async (c) => {
    const change = await parseBody(c, photoChangeSchema);
    return c.json(await record(c, (db, actor) => changePhoto(db, actor, c.env ?? {}, idParam(c, "Photo"), change)));
  });
  routes.post("/:id/archive", requirePermission("auth.read"), async (c) =>
    c.json(await record(c, (db, actor) => archivePhoto(db, actor, idParam(c, "Photo")))));
  routes.post("/:id/restore", requirePermission("auth.read"), async (c) =>
    c.json(await record(c, (db, actor) => archivePhoto(db, actor, idParam(c, "Photo"), true))));
  return routes;
}
