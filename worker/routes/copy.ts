import { Hono } from "hono";
import {
  comparePlaceholders,
  copyBatchSchema,
  copyKeySchema,
} from "../../shared/copy";
import { liveEditRenames, renameCopyOverrides } from "../../shared/live-edit-renames";
import {
  findOrphans,
  moveOrphan,
  orphanActionSchema,
  withoutOrphan,
  type LiveEditManifest,
} from "../../shared/live-edit-orphans";
import manifestJson from "../../shared/generated/live-edit-keys.json";
import { requirePermission } from "../auth";
import { ApiError, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { deleteCopyRow, listCopy, moveCopy, resetCopy, saveCopy } from "../records/copy";
import { getLayout, listLayouts, saveLayout } from "../records/layout";

// Every wording key and layout id the code has (FLOW-277), built by
// scripts/live-edit-keys.mjs.
const manifest = manifestJson as LiveEditManifest;

// Admin live text editing (FLOW-240). Everyone signed in (auth.read) reads the overrides;
// only copy.edit (Admin) saves or resets them. Saved keys are read through
// shared/live-edit-renames.ts, so a key renamed in code keeps its override
// (FLOW-277).
export function copyRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.get("/", requirePermission("auth.read"), async (c) =>
    c.json(renameCopyOverrides(await record(c, (db) => listCopy(db)), liveEditRenames)));
  // Saved edits that no longer match a screen (FLOW-277), for the Admin's notice.
  routes.get("/orphans", requirePermission("copy.edit"), async (c) =>
    c.json(
      await record(c, async (db) => findOrphans(await listCopy(db), await listLayouts(db), manifest, liveEditRenames)),
    ));
  // Delete an orphan, or move it to a key or block id a screen has.
  routes.post("/orphans", requirePermission("copy.edit"), async (c) => {
    const action = await parseBody(c, orphanActionSchema);
    if (action.type === "copy") {
      if (action.action === "delete") {
        await record(c, (db) => deleteCopyRow(db, action.key));
        return c.body(null, 204);
      }
      const placeholders = manifest.copy[action.to];
      if (!placeholders) throw new ApiError(400, "UNKNOWN_KEY", `No screen shows "${action.to}".`);
      const moved = await record(c, async (db, actor) => {
        const text = (await listCopy(db))[action.key];
        if (text === undefined) return false;
        const { missing, unknown } = comparePlaceholders(placeholders, text);
        if (missing.length || unknown.length)
          throw new ApiError(400, "INVALID_PLACEHOLDERS", "Keep every {placeholder} from the default text.", {
            invalid: [{ key: action.to, missing, unknown }],
          });
        return moveCopy(db, actor, action.key, action.to);
      });
      if (!moved) throw new ApiError(404, "NOT_FOUND", "No saved wording under that key.");
      return c.body(null, 204);
    }
    const page = manifest.layout[action.pageKey];
    if (action.action === "move" && !page?.blocks.includes(action.to) && !page?.fieldCards.includes(action.to))
      throw new ApiError(400, "UNKNOWN_KEY", `Page ${action.pageKey} has no "${action.to}".`);
    const saved = await record(c, async (db, actor) => {
      const current = await getLayout(db, action.pageKey);
      if (!current) return false;
      const doc =
        action.action === "delete"
          ? withoutOrphan(current.layout, action.id)
          : moveOrphan(current.layout, action.id, action.to);
      await saveLayout(db, actor, action.pageKey, doc);
      return true;
    });
    if (!saved) throw new ApiError(404, "NOT_FOUND", "No saved layout for that page.");
    return c.body(null, 204);
  });
  routes.put("/", requirePermission("copy.edit"), async (c) => {
    const edits = await parseBody(c, copyBatchSchema);
    // The request names each default's placeholders; the text must keep exactly those.
    const invalid = edits.flatMap((edit) => {
      const { missing, unknown } = comparePlaceholders(edit.placeholders, edit.text);
      return missing.length || unknown.length ? [{ key: edit.key, missing, unknown }] : [];
    });
    if (invalid.length)
      throw new ApiError(400, "INVALID_PLACEHOLDERS", "Keep every {placeholder} from the default text.", {
        invalid,
      });
    return c.json(renameCopyOverrides(await record(c, (db, actor) => saveCopy(db, actor, edits)), liveEditRenames));
  });
  routes.delete("/:key", requirePermission("copy.edit"), async (c) => {
    const key = copyKeySchema.safeParse(c.req.param("key"));
    if (!key.success) throw new ApiError(400, "INVALID_KEY", "Invalid wording key.");
    await record(c, (db) => resetCopy(db, key.data));
    return c.body(null, 204);
  });
  return routes;
}
