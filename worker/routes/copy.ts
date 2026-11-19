import { Hono } from "hono";
import { copyBatchSchema, copyKeySchema } from "../../shared/copy";
import { requirePermission } from "../auth";
import {
  notFound,
  parseBody,
  recordRunner,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import { getCopyOverrides, resetCopyOverride, saveCopyOverrides } from "../records/copy";

// Live text editing (FLOW-240), mounted at /api/copy. Everyone signed in reads the
// overrides; only copy.edit (Admin) saves or resets them. Each write answers with
// every override.
export function copyRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const edit = requirePermission("copy.edit");

  routes.get("/", requirePermission("auth.read"), async (c) =>
    c.json(await record(c, (db) => getCopyOverrides(db))),
  );
  routes.put("/", edit, async (c) => {
    const edits = await parseBody(c, copyBatchSchema);
    return c.json(await record(c, (db, actor) => saveCopyOverrides(db, actor, edits)));
  });
  routes.delete("/:key", edit, async (c) => {
    const key = copyKeySchema.safeParse(c.req.param("key"));
    if (!key.success) throw notFound("Wording");
    return c.json(await record(c, (db, actor) => resetCopyOverride(db, actor, key.data)));
  });
  return routes;
}
