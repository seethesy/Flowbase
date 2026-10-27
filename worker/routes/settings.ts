import { Hono } from "hono";
import { z } from "zod";
import { id as uuid } from "../../shared/schema-primitives";
import {
  businessDefaultsSchema,
  companyProfileSchema,
  listKeySchema,
  listValueInputSchema,
  listValueUpdateSchema,
} from "../../shared/settings";
import { requirePermission } from "../auth";
import {
  notFound,
  parseBody,
  recordRunner,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  addListValue,
  getSettings,
  orderListValues,
  renameListValue,
  setListValueArchived,
  settingsHistory,
  updateSetting,
} from "../records/settings";

const orderSchema = z.object({ ids: z.array(uuid).max(1000) });

// Business settings and configurable lists (FLOW-45), mounted at /api/settings.
export function settingsRoutes(options: { withDb?: RunWithDb }) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  const listKey = (c: AppContext) => {
    const parsed = listKeySchema.safeParse(c.req.param("key"));
    if (!parsed.success) throw notFound("List");
    return parsed.data;
  };
  const valueId = (c: AppContext) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("List value");
    return parsed.data;
  };

  routes.get("/", requirePermission("settings.read"), async (c) =>
    c.json(await record(c, (db) => getSettings(db))),
  );
  routes.get("/history", requirePermission("settings.manage"), async (c) =>
    c.json(await record(c, (db) => settingsHistory(db))),
  );
  routes.put("/company", requirePermission("settings.manage"), async (c) => {
    const input = await parseBody(c, companyProfileSchema);
    return c.json(
      await record(c, (db, actor) =>
        updateSetting(db, actor, "company", input),
      ),
    );
  });
  routes.put("/defaults", requirePermission("settings.manage"), async (c) => {
    const input = await parseBody(c, businessDefaultsSchema);
    return c.json(
      await record(c, (db, actor) =>
        updateSetting(db, actor, "defaults", input),
      ),
    );
  });
  routes.post(
    "/lists/:key",
    requirePermission("settings.manage"),
    async (c) => {
      const key = listKey(c);
      const { label } = await parseBody(c, listValueInputSchema);
      return c.json(
        await record(c, (db, actor) => addListValue(db, actor, key, label)),
        201,
      );
    },
  );
  routes.put(
    "/lists/:key/order",
    requirePermission("settings.manage"),
    async (c) => {
      const key = listKey(c);
      const { ids } = await parseBody(c, orderSchema);
      return c.json(
        await record(c, (db, actor) => orderListValues(db, actor, key, ids)),
      );
    },
  );
  routes.patch(
    "/values/:id",
    requirePermission("settings.manage"),
    async (c) => {
      const id = valueId(c);
      const { label } = await parseBody(c, listValueUpdateSchema);
      return c.json(
        await record(c, (db, actor) => renameListValue(db, actor, id, label)),
      );
    },
  );
  for (const [action, archived] of [
    ["archive", true],
    ["restore", false],
  ] as const)
    routes.post(
      `/values/:id/${action}`,
      requirePermission("settings.manage"),
      async (c) => {
        const id = valueId(c);
        return c.json(
          await record(c, (db, actor) =>
            setListValueArchived(db, actor, id, archived),
          ),
        );
      },
    );
  return routes;
}
