import { Hono } from "hono";
import { z } from "zod";
import { fullView } from "../audit/log";
import { inventoryChangesSchema } from "../../shared/inventory-changes";
import {
  correctionInputSchema,
  countInputSchema,
  countLineInputSchema,
  countStatusSchema,
  itemInputSchema,
  itemKindSchema,
  classificationInputSchema,
  movementInputSchema,
  sectionInputSchema,
  sectionKindSchema,
  sectionRenameSchema,
  startCountInputSchema,
  transferInputSchema,
} from "../../shared/inventory";
import { id as uuid, withVersion } from "../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import { can } from "../policy";
import {
  notFound,
  ApiError,
  pageRequest,
  parseBody,
  recordRunner,
  sendPage,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import { pendingInventoryChanges, submitInventoryChanges } from "../records/inventory-approvals";
import {
  addMovement,
  completeCount,
  correctMovement,
  countStock,
  createItem,
  findItem,
  createSection,
  getCount,
  getItem,
  itemHistory,
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
import {
  createInventoryCategory, createInventoryType, listInventoryCategories,
  updateInventoryCategory, updateInventoryType,
} from "../records/inventory-categories";

const categoryCreateSchema = classificationInputSchema.extend({ kind: z.enum(["rental", "service", "ingredient", "bar", "supply"]) });
const classificationChangeSchema = classificationInputSchema.partial().extend({ archived: z.boolean().optional() });
const typeCreateSchema = classificationInputSchema.extend({ categoryId: uuid });
const inlineSchema = z.object({
  field: z.enum(["name", "code", "description", "group", "color", "tier", "categoryId", "typeId", "legacyCategory", "bar.brand", "bar.subcategory", "consumable.preferredVendor", "consumable.parLevel"]),
  value: z.string().max(5000),
  updatedAt: z.string().datetime(),
});

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

  routes.get("/categories", requirePermission("inventory.read"), async (c) =>
    c.json(await record(c, (db) => listInventoryCategories(db))));
  routes.post("/categories", requirePermission("inventory.sections"), async (c) => {
    const input = await parseBody(c, categoryCreateSchema);
    return c.json(await record(c, (db, actor) => createInventoryCategory(db, actor, input.kind, input.name)), 201);
  });
  routes.patch("/categories/:id", requirePermission("inventory.sections"), async (c) => {
    const id = param(c, "Category");
    const input = await parseBody(c, classificationChangeSchema);
    return c.json(await record(c, (db, actor) => updateInventoryCategory(db, actor, id, input)));
  });
  routes.post("/types", requirePermission("inventory.sections"), async (c) => {
    const input = await parseBody(c, typeCreateSchema);
    return c.json(await record(c, (db, actor) => createInventoryType(db, actor, input.categoryId, input.name)), 201);
  });
  routes.patch("/types/:id", requirePermission("inventory.sections"), async (c) => {
    const id = param(c, "Type");
    const input = await parseBody(c, classificationChangeSchema);
    return c.json(await record(c, (db, actor) => updateInventoryType(db, actor, id, input)));
  });

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
          categoryId: query(c, "categoryId"),
          typeId: query(c, "typeId"),
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
  routes.post("/items/changes", requirePermission("inventory.changes.request"), async (c) => {
    const input = await parseBody(c, inventoryChangesSchema);
    const result = await record(c, (db, actor) => submitInventoryChanges(db, actor, input.changes));
    return c.json(result, result.applied ? 200 : 202);
  });
  routes.get("/items/pending", requirePermission("inventory.read"), async (c) => {
    const ids = (c.req.query("ids") ?? "").split(",").filter(Boolean);
    if (ids.length > 100 || ids.some((id) => !uuid.safeParse(id).success))
      throw new ApiError(400, "INVALID_REQUEST", "Invalid item ids.");
    return c.json(await record(c, (db) => pendingInventoryChanges(db, ids)));
  });
  routes.get("/items/:id", requirePermission("inventory.read"), async (c) => {
    const id = param(c, "Item");
    return c.json(await record(c, (db, actor) => getItem(db, actor, id)));
  });
  routes.post("/items", requirePermission("inventory.write"), async (c) => {
    const input = await parseBody(c, itemInputSchema);
    if (input.kind !== "consumable" && !can(c.get("actor"), "rentals.apply_directly"))
      throw new ApiError(409, "APPROVAL_REQUIRED", "Submit this Master inventory change for approval.");
    return c.json(
      await record(c, (db, actor) => createItem(db, actor, input)),
      201,
    );
  });
  routes.put("/items/:id", requirePermission("inventory.write"), async (c) => {
    const id = param(c, "Item");
    const input = await parseBody(c, withVersion(itemInputSchema));
    if (input.kind !== "consumable" && !can(c.get("actor"), "rentals.apply_directly"))
      throw new ApiError(409, "APPROVAL_REQUIRED", "Submit this Master inventory change for approval.");
    return c.json(
      await record(c, (db, actor) => updateItem(db, actor, id, input)),
    );
  });
  routes.patch("/items/:id/inline", requirePermission("inventory.write"), async (c) => {
    const id = param(c, "Item");
    const { field, value, updatedAt } = await parseBody(c, inlineSchema);
    return c.json(await record(c, async (db, actor) => {
      const stored = await getItem(db, fullView, id);
      if (stored.kind !== "consumable" && !can(actor, "rentals.apply_directly"))
        throw new ApiError(409, "APPROVAL_REQUIRED", "Submit this Master inventory change for approval.");
      const input = itemInputSchema.parse(stored);
      if (field === "categoryId" || field === "typeId") {
        if (value && !uuid.safeParse(value).success) throw new ApiError(400, "INVALID_REQUEST", "Invalid classification id.");
        if (field === "categoryId") { input.categoryId = value || null; input.typeId = null; }
        else input.typeId = value || null;
      } else if (field === "legacyCategory") {
        input.category = value;
      }
      else if (field === "bar.brand" || field === "bar.subcategory") {
        if (!input.bar) throw new ApiError(400, "INVALID_FIELD", "This is not a Bar item.");
        if (field === "bar.brand") input.bar.brand = value;
        else input.bar.subcategory = value;
      } else if (field === "consumable.preferredVendor" || field === "consumable.parLevel") {
        if (!input.consumable) throw new ApiError(400, "INVALID_FIELD", "This is not a consumable item.");
        if (field === "consumable.preferredVendor") input.consumable.preferredVendor = value;
        else input.consumable.parLevel = value === "" ? null : Number(value);
      } else input[field] = value;
      return updateItem(db, actor, id, { ...input, updatedAt });
    }));
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
        await record(c, async (db, actor) => {
          const item = await findItem(db, id);
          if (item.kind === "rental" && !can(actor, "rentals.apply_directly"))
            throw new ApiError(409, "APPROVAL_REQUIRED", "Submit this Master inventory quantity for approval.");
          return countStock(db, actor, id, input);
        }),
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
  // Item history (FLOW-185): read-only; costs hidden per F-01-04.
  routes.get(
    "/items/:id/history",
    requirePermission("inventory.read"),
    async (c) => {
      const id = param(c, "Item");
      return sendPage(
        c,
        await record(c, (db, actor) => itemHistory(db, actor, id, pageRequest(c))),
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
          await record(c, async (db, actor) => {
            const item = await findItem(db, id);
            if (item.kind !== "consumable" && !can(actor, "rentals.apply_directly"))
              throw new ApiError(409, "APPROVAL_REQUIRED", "Submit this Master inventory archive for approval.");
            return setItemArchived(db, actor, id, archived);
          }),
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
