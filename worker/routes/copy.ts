import { Hono } from "hono";
import {
  comparePlaceholders,
  copyBatchSchema,
  copyKeySchema,
} from "../../shared/copy";
import { requirePermission } from "../auth";
import { ApiError, parseBody, recordRunner, type AppEnv, type RunWithDb } from "../hono";
import { listCopy, resetCopy, saveCopy } from "../records/copy";

// Admin live text editing (FLOW-240). Everyone signed in (auth.read) reads the overrides;
// only copy.edit (Admin) saves or resets them.
export function copyRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.get("/", requirePermission("auth.read"), async (c) =>
    c.json(await record(c, (db) => listCopy(db))));
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
    return c.json(await record(c, (db, actor) => saveCopy(db, actor, edits)));
  });
  routes.delete("/:key", requirePermission("copy.edit"), async (c) => {
    const key = copyKeySchema.safeParse(c.req.param("key"));
    if (!key.success) throw new ApiError(400, "INVALID_KEY", "Invalid wording key.");
    await record(c, (db) => resetCopy(db, key.data));
    return c.body(null, 204);
  });
  return routes;
}
