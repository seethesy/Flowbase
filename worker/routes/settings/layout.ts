import { Hono } from "hono";
import { layoutDocV3Schema, layoutKeySchema, layoutProblems, type LayoutDoc } from "../../../shared/layout";
import { liveEditRenames, renameLayoutDoc } from "../../../shared/live-edit-renames";
import type { LiveEditManifest } from "../../../shared/live-edit-orphans";
import manifestJson from "../../../shared/generated/live-edit-keys.json";
import { requirePermission } from "../../auth";
import { ApiError, parseBody, recordRunner, type AppContext, type AppEnv, type RunWithDb } from "../../hono";
import { getLayout, resetLayout, saveLayout } from "../../records/settings/layout";
import { unchanged } from "../../realtime";

// Every layout block id the code has (FLOW-277), built by scripts/live-edit-keys.mjs.
const manifest = manifestJson as LiveEditManifest;

// A built-in block the code no longer has leaves its cell empty (FLOW-319): it
// isn't sent, so the page grid never waits for it. The orphan report still
// lists it from the saved row.
function withoutDroppedBuiltins(pageKey: string, doc: LayoutDoc): LayoutDoc {
  const known = manifest.layout[pageKey]?.blocks;
  if (!known) return doc;
  return { ...doc, blocks: doc.blocks.filter((block) => block.kind !== "builtin" || known.includes(block.id)) };
}

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
  // page's next Save stores them that way. A version 1 row reads as version 2.
  routes.get("/:pageKey", requirePermission("auth.read"), async (c) => {
    const key = pageKey(c);
    const saved = await record(c, (db) => getLayout(db, key));
    return c.json(saved ? { ...saved, layout: withoutDroppedBuiltins(key, renameLayoutDoc(key, saved.layout, liveEditRenames)) } : null);
  });
  routes.put("/:pageKey", requirePermission("layout.edit"), async (c) => {
    const key = pageKey(c);
    const body: unknown = await c.req.json().catch(() => undefined);
    // Saves are page grids (FLOW-321) with rows as screen-height percentages
    // (version 3, FLOW-357) only; older versions are read, converted, never saved.
    const version = body && typeof body === "object" ? (body as { version?: unknown }).version : undefined;
    if (version === 1 || version === 2)
      throw new ApiError(400, "INVALID_LAYOUT", "Layouts are saved as version 3 page grids.", {
        problems: [{ path: "version", message: "Layouts are saved as version 3 page grids." }],
      });
    const layout = await parseBody(c, layoutDocV3Schema);
    // The grid's invariants, unknown fields, sources, operators or tables, a
    // low-contrast color pair, or too many cards: 400 naming the path, nothing saved.
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
