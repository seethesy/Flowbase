import { Hono } from "hono";
import { z } from "zod";
import { deletableEntities, deletePermission, MAX_BULK_DELETE } from "../../shared/deletions";
import { id } from "../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import { parseBody, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { deleteRecords, listDeleted, restoreRecords } from "../records/deletions";

// Bulk delete and restore for every table (FLOW-260), mounted at /api/deletions:
// POST /:entityType and /:entityType/restore with { ids } (at most 100), each
// guarded by that record type's write permission (anyone who can edit it can
// delete it). GET / lists deleted records for the Admin's Settings › Archived.
const idsSchema = z.object({ ids: z.array(id).min(1).max(MAX_BULK_DELETE) });
export function deletionRoutes(options: { withDb?: RunWithDb; resolveActor?: ResolveActor }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  routes.get("/", requirePermission("settings.manage"), async (c) =>
    c.json(await record(c, (db, actor) => listDeleted(db, actor))),
  );
  for (const entityType of deletableEntities) {
    routes.post(`/${entityType}`, requirePermission(deletePermission[entityType]), async (c) => {
      const { ids } = await parseBody(c, idsSchema);
      return c.json(await record(c, (db, actor) => deleteRecords(db, actor, { entityType, ids })));
    });
    routes.post(`/${entityType}/restore`, requirePermission(deletePermission[entityType]), async (c) => {
      const { ids } = await parseBody(c, idsSchema);
      return c.json(await record(c, (db, actor) => restoreRecords(db, actor, { entityType, ids })));
    });
  }
  return routes;
}
