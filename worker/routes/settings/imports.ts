import { Hono } from "hono";
import {
  importBatchSchema,
  importDryRunSchema,
  importStartSchema,
} from "../../../shared/imports";
import { requireActor, requirePermission, type ResolveActor } from "../../auth";
import {
  idParam,
  parseBody,
  queryParam,
  recordRunner,
  type AppEnv,
  type RunWithDb,
} from "../../hono";
import {
  completeImport,
  getImport,
  getImportModule,
  importBatch,
  listImportModules,
  listImports,
  planImportRows,
  startImport,
  type ImportModule,
} from "../../records/settings/imports";
import { registeredImportModules } from "../../records/inventory/import-inventory";

// Data imports (FLOW-47), mounted at /api/imports. Settings › Imports is Admin
// only (FLOW-290): every route needs imports.run, which only Admin holds and the
// Roles & permissions matrix can't grant. Each importer still names its own
// permission, checked per module. The browser parses the file and sends at most
// 100 rows per request.
export function importRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
  modules?: ImportModule[];
}) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const modules = options.modules ?? registeredImportModules;
  routes.use("*", requireActor(options.resolveActor));

  routes.get("/modules", requirePermission("imports.run"), (c) =>
    c.json(listImportModules(modules, c.get("actor"))),
  );
  routes.get("/modules/:key", requirePermission("imports.run"), (c) =>
    c.json(getImportModule(modules, c.get("actor"), c.req.param("key"))),
  );
  routes.post("/dry-run", requirePermission("imports.run"), async (c) => {
    const input = await parseBody(c, importDryRunSchema);
    return c.json(
      await record(c, (db, actor) =>
        planImportRows(db, modules, actor, input.module, input.rows),
      ),
    );
  });
  routes.get("/", requirePermission("imports.run"), async (c) =>
    c.json(
      await record(c, (db, actor) =>
        listImports(db, modules, actor, queryParam(c, "module")),
      ),
    ),
  );
  routes.post("/", requirePermission("imports.run"), async (c) => {
    const input = await parseBody(c, importStartSchema);
    return c.json(
      await record(c, (db, actor) => startImport(db, modules, actor, input)),
      201,
    );
  });
  routes.get("/:id", requirePermission("imports.run"), async (c) => {
    const id = idParam(c, "Import");
    return c.json(
      await record(c, (db, actor) => getImport(db, modules, actor, id)),
    );
  });
  routes.post("/:id/rows", requirePermission("imports.run"), async (c) => {
    const id = idParam(c, "Import");
    const input = await parseBody(c, importBatchSchema);
    return c.json(
      await record(c, (db, actor) =>
        importBatch(db, modules, actor, id, input.rows),
      ),
    );
  });
  routes.post("/:id/complete", requirePermission("imports.run"), async (c) => {
    const id = idParam(c, "Import");
    return c.json(
      await record(c, (db, actor) => completeImport(db, modules, actor, id)),
    );
  });
  return routes;
}
