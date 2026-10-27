import { Hono } from "hono";
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
import { id as uuid } from "../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import {
  notFound,
  pageRequest,
  parseBody,
  recordRunner,
  sendPage,
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

// Inventory API (FLOW-69/70/71/81/82/83/90), mounted at /api/inventory. Every route
// needs a signed-in user; item writes need inventory.write, section changes
// inventory.sections (Admin). Movements need inventory.move and counts
// inventory.count, and each item is then checked against who may move or count it
// (canMoveItem, canCountItem). There is no route that
// sets a quantity: every change is a movement (FLOW-71 AC1).
export function inventoryRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  const param = (c: AppContext, what: string) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound(what);
    return parsed.data;
  };
  const query = (c: AppContext, key: string) => c.req.query(key) || undefined;
  const flag = (c: AppContext, key: string) => c.req.query(key) === "true";

  routes.get("/items", requirePermission("inventory.read"), async (c) => {
    const kind = itemKindSchema.safeParse(c.req.query("kind"));
    const sectionId = uuid.safeParse(c.req.query("sectionId"));
    if (query(c, "sectionId") && !sectionId.success)
      return sendPage(c, { rows: [], next: null });
    return sendPage(
      c,
      await record(c, (db, actor) =>
        listItems(db, actor, {
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
        }, pageRequest(c)),
      ),
    );
  });
  routes.get("/items/:id", requirePermission("inventory.read"), async (c) => {
    const id = param(c, "Item");
    return c.json(await record(c, (db, actor) => getItem(db, actor, id)));
  });
  routes.post("/items", requirePermission("inventory.write"), async (c) => {
    const input = await parseBody(c, itemInputSchema);
    return c.json(
      await record(c, (db, actor) => createItem(db, actor, input)),
      201,
    );
  });
  routes.put("/items/:id", requirePermission("inventory.write"), async (c) => {
    const id = param(c, "Item");
    const input = await parseBody(c, itemInputSchema);
    return c.json(
      await record(c, (db, actor) => updateItem(db, actor, id, input)),
    );
  });
  routes.post(
    "/items/:id/transfers",
    requirePermission("inventory.move"),
    async (c) => {
      const id = param(c, "Item");
      const input = await parseBody(c, transferInputSchema);
      return c.json(
        await record(c, (db, actor) => transferStock(db, actor, id, input)),
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
        await record(c, (db, actor) => countStock(db, actor, id, input)),
        201,
      );
    },
  );
  routes.get(
    "/items/:id/movements",
    requirePermission("inventory.read"),
    async (c) => {
      const id = param(c, "Item");
      return sendPage(
        c,
        await record(c, (db) => listMovements(db, id, pageRequest(c))),
      );
    },
  );
  routes.post(
    "/items/:id/movements",
    requirePermission("inventory.move"),
    async (c) => {
      const id = param(c, "Item");
      const input = await parseBody(c, movementInputSchema);
      return c.json(
        await record(c, (db, actor) => addMovement(db, actor, id, input)),
        201,
      );
    },
  );
  routes.post(
    "/movements/:id/corrections",
    requirePermission("inventory.move"),
    async (c) => {
      const id = param(c, "Movement");
      const input = await parseBody(c, correctionInputSchema);
      return c.json(
        await record(c, (db, actor) => correctMovement(db, actor, id, input)),
        201,
      );
    },
  );
  routes.get(
    "/items/:id/cost-history",
    requirePermission("inventory.read"),
    async (c) => {
      const id = param(c, "Item");
      return sendPage(
        c,
        await record(c, (db, actor) =>
          listCostHistory(db, actor, id, pageRequest(c)),
        ),
      );
    },
  );

  routes.get("/counts", requirePermission("inventory.count"), async (c) => {
    const status = countStatusSchema.safeParse(c.req.query("status"));
    return sendPage(
      c,
      await record(c, (db) =>
        listCounts(
          db,
          { status: status.success ? status.data : undefined },
          pageRequest(c),
        ),
      ),
    );
  });
  routes.post("/counts", requirePermission("inventory.count"), async (c) => {
    const input = await parseBody(c, startCountInputSchema);
    const { count, created } = await record(c, (db, actor) =>
      startCount(db, actor, input.sectionId),
    );
    return c.json(count, created ? 201 : 200);
  });
  routes.get("/counts/:id", requirePermission("inventory.count"), async (c) => {
    const id = param(c, "Count");
    return c.json(await record(c, (db, actor) => getCount(db, actor, id)));
  });
  routes.post(
    "/counts/:id/lines",
    requirePermission("inventory.count"),
    async (c) => {
      const id = param(c, "Count");
      const input = await parseBody(c, countLineInputSchema);
      return c.json(
        await record(c, (db, actor) => recordCountLine(db, actor, id, input)),
      );
    },
  );
  routes.post(
    "/counts/:id/complete",
    requirePermission("inventory.count"),
    async (c) => {
      const id = param(c, "Count");
      return c.json(
        await record(c, (db, actor) => completeCount(db, actor, id)),
      );
    },
  );

  routes.get("/sections", requirePermission("inventory.read"), async (c) => {
    const kind = sectionKindSchema.safeParse(c.req.query("kind"));
    return c.json(
      await record(c, (db) =>
        listSections(db, {
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
        await record(c, (db, actor) => createSection(db, actor, input)),
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
        await record(c, (db, actor) =>
          renameSection(db, actor, id, input.name),
        ),
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
          await record(c, (db, actor) =>
            setItemArchived(db, actor, id, archived),
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
          await record(c, (db, actor) =>
            setSectionArchived(db, actor, id, archived),
          ),
        );
      },
    );
  }
  return routes;
}
