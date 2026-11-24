import { Hono } from "hono";
import { layoutDocSchema, layoutKeySchema, layoutProblems } from "../../shared/layout";
import { liveEditRenames, renameLayoutDoc } from "../../shared/live-edit-renames";
import { requirePermission } from "../auth";
import { ApiError, parseBody, recordRunner, type AppContext, type AppEnv, type RunWithDb } from "../hono";
import { getLayout, resetLayout, saveLayout } from "../records/layout";
import { unchanged } from "../realtime";

// Saved page layouts (FLOW-253). Everyone signed in (auth.read) reads a page's
// layout; only layout.edit (Admin) saves or resets it.
export function layoutRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const pageKey = (c: AppContext) => {
    const key = layoutKeySchema.safeParse(c.req.param("pageKey"));
    if (!key.success) throw new ApiError(400, "INVALID_KEY", "Invalid page key.");
    return key.data;
  };
  // Renamed block and field-card ids (FLOW-277) read under their new ids; the
  // page's next Save stores them that way.
  routes.get("/:pageKey", requirePermission("auth.read"), async (c) => {
    const key = pageKey(c);
    const saved = await record(c, (db) => getLayout(db, key));
    return c.json(saved ? { ...saved, layout: renameLayoutDoc(key, saved.layout, liveEditRenames) } : null);
  });
  routes.put("/:pageKey", requirePermission("layout.edit"), async (c) => {
    const key = pageKey(c);
    const layout = await parseBody(c, layoutDocSchema);
    // Unknown fields, sources, operators or tables, a low-contrast color pair,
    // or too many cards: 400, nothing saved.
    const problems = layoutProblems(key, layout);
    if (problems.length) throw new ApiError(400, "INVALID_LAYOUT", problems[0].message, { problems });
    return c.json(await record(c, (db, actor) => saveLayout(db, actor, key, layout)));
  });
  routes.delete("/:pageKey", requirePermission("layout.edit"), async (c) => {
    const key = pageKey(c);
    if ((await record(c, (db, actor) => resetLayout(db, actor, key))) === false) unchanged(c);
    return c.body(null, 204);
  });
  return routes;
}
