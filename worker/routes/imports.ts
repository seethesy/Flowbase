import { Hono } from "hono";
import {
  importBatchSchema,
  importDryRunSchema,
  importStartSchema,
} from "../../shared/imports";
import { id as uuid } from "../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import {
  notFound,
  parseBody,
  recordRunner,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  completeImport,
  getImport,
  getImportModule,
  importBatch,
  importModules,
  listImportModules,
  listImports,
  planImportRows,
  startImport,
  type ImportModule,
} from "../records/imports";

// Data imports (FLOW-47), mounted at /api/imports. Every route needs a signed-in
// user; each importer then requires its own permission (an inventory importer
// inventory.write, the lead importer leads.update), checked per module, and an
// importer the user can't run is not listed. The browser parses the file and sends
// at most 100 rows per request.
export function importRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
  modules?: ImportModule[];
}) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const modules = options.modules ?? importModules;
  routes.use("*", requireActor(options.resolveActor));
  const param = (c: AppContext) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Import");
    return parsed.data;
  };

  routes.get("/modules", requirePermission("auth.read"), (c) =>
    c.json(listImportModules(modules, c.get("actor"))),
  );
  routes.get("/modules/:key", requirePermission("auth.read"), (c) =>
    c.json(getImportModule(modules, c.get("actor"), c.req.param("key"))),
  );
  routes.post("/dry-run", requirePermission("auth.read"), async (c) => {
    const input = await parseBody(c, importDryRunSchema);
    return c.json(
      await record(c, (db, actor) =>
        planImportRows(db, modules, actor, input.module, input.rows),
      ),
    );
  });
  routes.get("/", requirePermission("auth.read"), async (c) =>
    c.json(
      await record(c, (db, actor) =>
        listImports(db, modules, actor, c.req.query("module") || undefined),
      ),
    ),
  );
  routes.post("/", requirePermission("auth.read"), async (c) => {
    const input = await parseBody(c, importStartSchema);
    return c.json(
      await record(c, (db, actor) => startImport(db, modules, actor, input)),
      201,
    );
  });
  routes.get("/:id", requirePermission("auth.read"), async (c) => {
    const id = param(c);
    return c.json(
      await record(c, (db, actor) => getImport(db, modules, actor, id)),
    );
  });
  routes.post("/:id/rows", requirePermission("auth.read"), async (c) => {
    const id = param(c);
    const input = await parseBody(c, importBatchSchema);
    return c.json(
      await record(c, (db, actor) =>
        importBatch(db, modules, actor, id, input.rows),
      ),
    );
  });
  routes.post("/:id/complete", requirePermission("auth.read"), async (c) => {
    const id = param(c);
    return c.json(
      await record(c, (db, actor) => completeImport(db, modules, actor, id)),
    );
  });
  return routes;
}
