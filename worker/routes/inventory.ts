import { Hono } from "hono";
import { z } from "zod";
import {
  correctionInputSchema,
  countInputSchema,
  countLineInputSchema,
  countStatusSchema,
  itemInputSchema,
  itemKindSchema,
  movementInputSchema,
  sectionInputSchema,
  sectionKindSchema,
  sectionRenameSchema,
  startCountInputSchema,
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
  addMovement,
  completeCount,
  correctMovement,
  countStock,
  createItem,
  createSection,
  getCount,
  getItem,
  listCostHistory,
  listCounts,
  listItems,
  listMovements,
  listSections,
  recordCountLine,
  renameSection,
  setItemArchived,
  setSectionArchived,
  startCount,
  transferStock,
  updateItem,
} from "../records/inventory";

const uuid = z.string().uuid();

// Inventory API (FLOW-69/70/71/81/82/83/90), mounted at /api/inventory. Every route
// needs a signed-in user; item and stock writes need inventory.write, section
// changes inventory.sections (Admin). Counts need inventory.count, and each counted
// item is checked against who may count it (canCountItem). There is no route that
// sets a quantity: every change is a movement (FLOW-71 AC1).
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
          tier: query(c, "tier"),
          subcategory: query(c, "subcategory"),
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
    requirePermission("inventory.count"),
    async (c) => {
      const id = param(c, "Item");
      const input = await parseBody(c, countInputSchema);
      return c.json(
        await db(c, (tx) => countStock(tx, c.get("actor"), id, input)),
        201,
      );
    },
  );
  routes.get("/items/:id/movements", async (c) => {
    const id = param(c, "Item");
    return c.json(await db(c, (tx) => listMovements(tx, id)));
  });
  routes.post(
    "/items/:id/movements",
    requirePermission("inventory.write"),
    async (c) => {
      const id = param(c, "Item");
      const input = await parseBody(c, movementInputSchema);
      return c.json(
        await db(c, (tx) => addMovement(tx, c.get("actor"), id, input)),
        201,
      );
    },
  );
  routes.post(
    "/movements/:id/corrections",
    requirePermission("inventory.write"),
    async (c) => {
      const id = param(c, "Movement");
      const input = await parseBody(c, correctionInputSchema);
      return c.json(
        await db(c, (tx) => correctMovement(tx, c.get("actor"), id, input)),
        201,
      );
    },
  );
  routes.get("/items/:id/cost-history", async (c) => {
    const id = param(c, "Item");
    return c.json(await db(c, (tx) => listCostHistory(tx, c.get("actor"), id)));
  });

  routes.get("/counts", requirePermission("inventory.count"), async (c) => {
    const status = countStatusSchema.safeParse(c.req.query("status"));
    return c.json(
      await db(c, (tx) =>
        listCounts(tx, { status: status.success ? status.data : undefined }),
      ),
    );
  });
  routes.post("/counts", requirePermission("inventory.count"), async (c) => {
    const input = await parseBody(c, startCountInputSchema);
    const { count, created } = await db(c, (tx) =>
      startCount(tx, c.get("actor"), input.sectionId),
    );
    return c.json(count, created ? 201 : 200);
  });
  routes.get("/counts/:id", requirePermission("inventory.count"), async (c) => {
    const id = param(c, "Count");
    return c.json(await db(c, (tx) => getCount(tx, c.get("actor"), id)));
  });
  routes.post(
    "/counts/:id/lines",
    requirePermission("inventory.count"),
    async (c) => {
      const id = param(c, "Count");
      const input = await parseBody(c, countLineInputSchema);
      return c.json(
        await db(c, (tx) => recordCountLine(tx, c.get("actor"), id, input)),
      );
    },
  );
  routes.post(
    "/counts/:id/complete",
    requirePermission("inventory.count"),
    async (c) => {
      const id = param(c, "Count");
      return c.json(await db(c, (tx) => completeCount(tx, c.get("actor"), id)));
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
