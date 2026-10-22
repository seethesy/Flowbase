import { Hono } from "hono";
import { z } from "zod";
import {
  countInputSchema,
  itemInputSchema,
  itemKindSchema,
  sectionInputSchema,
  sectionKindSchema,
  sectionRenameSchema,
  transferInputSchema,
} from "../../shared/inventory";
import type { Db } from "../db/client";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import {
  notFound,
  parseBody,
  runDb,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  countStock,
  createItem,
  createSection,
  getItem,
  listItems,
  listSections,
  renameSection,
  setItemArchived,
  setSectionArchived,
  transferStock,
  updateItem,
} from "../records/inventory";

const uuid = z.string().uuid();

// Inventory API (FLOW-69/70/81), mounted at /api/inventory. Every route needs a
// signed-in user; item and stock writes need inventory.write, section changes
// inventory.sections (Admin).
export function inventoryRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  routes.use("*", requireActor(options.resolveActor));
  const param = (c: AppContext, what: string) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };
  const query = (c: AppContext, key: string) => c.req.query(key) || undefined;
  const flag = (c: AppContext, key: string) => c.req.query(key) === "true";
  const db = <T>(c: AppContext, run: (tx: Db) => Promise<T>) =>
    runDb(options.withDb, c.env, run);

  routes.get("/items", async (c) => {
    const kind = itemKindSchema.safeParse(c.req.query("kind"));
    const sectionId = uuid.safeParse(c.req.query("sectionId"));
    if (query(c, "sectionId") && !sectionId.success) return c.json([]);
    return c.json(
      await db(c, (tx) =>
        listItems(tx, c.get("actor"), {
          archived: flag(c, "archived"),
          kind: kind.success ? kind.data : undefined,
          subtype: query(c, "subtype"),
          category: query(c, "category"),
          sectionId: sectionId.success ? sectionId.data : undefined,
          vendor: query(c, "vendor"),
          belowPar: flag(c, "belowPar"),
          search: query(c, "search"),
        }),
      ),
    );
  });
  routes.get("/items/:id", async (c) => {
    const id = param(c, "Item");
    return c.json(await db(c, (tx) => getItem(tx, c.get("actor"), id)));
  });
  routes.post("/items", requirePermission("inventory.write"), async (c) => {
    const input = await parseBody(c, itemInputSchema);
    return c.json(
      await db(c, (tx) => createItem(tx, c.get("actor"), input)),
      201,
    );
  });
  routes.put("/items/:id", requirePermission("inventory.write"), async (c) => {
    const id = param(c, "Item");
    const input = await parseBody(c, itemInputSchema);
    return c.json(
      await db(c, (tx) => updateItem(tx, c.get("actor"), id, input)),
    );
  });
  routes.post(
    "/items/:id/transfers",
    requirePermission("inventory.write"),
    async (c) => {
      const id = param(c, "Item");
      const input = await parseBody(c, transferInputSchema);
      return c.json(
        await db(c, (tx) => transferStock(tx, c.get("actor"), id, input)),
        201,
      );
    },
  );
  routes.post(
    "/items/:id/counts",
    requirePermission("inventory.write"),
    async (c) => {
      const id = param(c, "Item");
      const input = await parseBody(c, countInputSchema);
      return c.json(
        await db(c, (tx) => countStock(tx, c.get("actor"), id, input)),
        201,
      );
    },
  );

  routes.get("/sections", async (c) => {
    const kind = sectionKindSchema.safeParse(c.req.query("kind"));
    return c.json(
      await db(c, (tx) =>
        listSections(tx, {
          archived: flag(c, "archived"),
          kind: kind.success ? kind.data : undefined,
        }),
      ),
    );
  });
  routes.post(
    "/sections",
    requirePermission("inventory.sections"),
    async (c) => {
      const input = await parseBody(c, sectionInputSchema);
      return c.json(
        await db(c, (tx) => createSection(tx, c.get("actor"), input)),
        201,
      );
    },
  );
  routes.put(
    "/sections/:id",
    requirePermission("inventory.sections"),
    async (c) => {
      const id = param(c, "Section");
      const input = await parseBody(c, sectionRenameSchema);
      return c.json(
        await db(c, (tx) => renameSection(tx, c.get("actor"), id, input.name)),
      );
    },
  );

  for (const [action, archived] of [
    ["archive", true],
    ["restore", false],
  ] as const) {
    routes.post(
      `/items/:id/${action}`,
      requirePermission("inventory.write"),
      async (c) => {
        const id = param(c, "Item");
        return c.json(
          await db(c, (tx) =>
            setItemArchived(tx, c.get("actor"), id, archived),
          ),
        );
      },
    );
    routes.post(
      `/sections/:id/${action}`,
      requirePermission("inventory.sections"),
      async (c) => {
        const id = param(c, "Section");
        return c.json(
          await db(c, (tx) =>
            setSectionArchived(tx, c.get("actor"), id, archived),
          ),
        );
      },
    );
  }
  return routes;
}
