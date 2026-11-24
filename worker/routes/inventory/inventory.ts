import { Hono } from "hono";
import { z } from "zod";
import { fullView } from "../../audit/log";
import { inventoryChangesSchema } from "../../../shared/inventory-changes";
import {
  barContainerSchema,
  correctionInputSchema,
  countInputSchema,
  countLineInputSchema,
  countStatusSchema,
  inventoryListOf,
  inventoryListSchema,
  itemInputSchema,
  itemKindSchema,
  type InventoryList,
  classificationInputSchema,
  movementInputSchema,
  sectionInputSchema,
  sectionKindSchema,
  sectionOrderSchema,
  sectionRenameSchema,
  startCountInputSchema,
  transferInputSchema,
} from "../../../shared/inventory";
import { id as uuid, withVersion } from "../../../shared/schema-primitives";
import { unitSchema } from "../../../shared/units";
import { requireActor, requireAnyPermission, requirePermission, type ResolveActor } from "../../auth";
import { can } from "../../policy";
import {
  ApiError,
  archiveRoutes,
  historyRoute,
  idParam,
  pageRequest,
  parseBody,
  queryParam,
  recordRunner,
  sendPage,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../../hono";
import { pendingInventoryChanges, submitInventoryChanges } from "../../records/inventory/inventory-approvals";
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
  reorderSections,
  setItemArchived,
  setSectionArchived,
  startCount,
  transferStock,
  updateItem,
} from "../../records/inventory/inventory";
import {
  createInventoryCategory, createInventoryType, listInventoryCategories,
  updateInventoryCategory, updateInventoryType,
} from "../../records/inventory/inventory-categories";

const categoryCreateSchema = classificationInputSchema.extend({ kind: z.enum(["rental", "service", "ingredient", "bar", "supply"]) });
const classificationChangeSchema = classificationInputSchema.partial().extend({ archived: z.boolean().optional() });
const typeCreateSchema = classificationInputSchema.extend({ categoryId: uuid });
const inlineSchema = z.object({
  field: z.enum(["name", "code", "description", "group", "color", "tier", "categoryId", "typeId", "legacyCategory", "bar.brand", "bar.subcategory", "consumable.preferredVendor", "consumable.parLevel",
    "consumable.purchaseUnit", "consumable.packCount", "consumable.eachSize.quantity", "consumable.eachSize.unit", "consumable.recipeUnit", "consumable.storageSectionId", "bar.container"]),
  value: z.string().max(5000),
  updatedAt: z.string().datetime(),
});

// Who may read and change each list (FLOW-289): Master and Bar are inventory,
// Kitchen Ingredients belong to the kitchen (Recipes and Menus).
const listAction = (list: InventoryList, access: "read" | "write") =>
  list === "kitchen"
    ? access === "read" ? "recipes.read" as const : "recipes.write" as const
    : access === "read" ? "inventory.read" as const : "inventory.write" as const;
const requireList = (c: AppContext, list: InventoryList, access: "read" | "write") => {
  if (!can(c.get("actor"), listAction(list, access)))
    throw new ApiError(403, "FORBIDDEN", "You don't have access to this.");
};

// Inventory API (FLOW-69/70/71/81/82/83/90), mounted at /api/inventory. Every route
// needs a signed-in user; item writes need the list's write permission (above),
// location changes inventory.sections (Admin). Movements need inventory.move and counts
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
  const flag = (c: AppContext, key: string) => c.req.query(key) === "true";

  routes.get("/categories", requirePermission("inventory.read"), async (c) =>
    c.json(await record(c, (db) => listInventoryCategories(db))));
  routes.post("/categories", requirePermission("inventory.sections"), async (c) => {
    const input = await parseBody(c, categoryCreateSchema);
    return c.json(await record(c, (db, actor) => createInventoryCategory(db, actor, input.kind, input.name)), 201);
  });
  routes.patch("/categories/:id", requirePermission("inventory.sections"), async (c) => {
    const id = idParam(c, "Category");
    const input = await parseBody(c, classificationChangeSchema);
    return c.json(await record(c, (db, actor) => updateInventoryCategory(db, actor, id, input)));
  });
  routes.post("/types", requirePermission("inventory.sections"), async (c) => {
    const input = await parseBody(c, typeCreateSchema);
    return c.json(await record(c, (db, actor) => createInventoryType(db, actor, input.categoryId, input.name)), 201);
  });
  routes.patch("/types/:id", requirePermission("inventory.sections"), async (c) => {
    const id = idParam(c, "Type");
    const input = await parseBody(c, classificationChangeSchema);
    return c.json(await record(c, (db, actor) => updateInventoryType(db, actor, id, input)));
  });

  // One list's items (FLOW-289: ?list=master, bar or kitchen), or every list's.
  routes.get("/items", requireAnyPermission("inventory.read", "recipes.read"), async (c) => {
    const list = inventoryListSchema.safeParse(c.req.query("list"));
    requireList(c, list.success ? list.data : "master", "read");
    const kind = itemKindSchema.safeParse(c.req.query("kind"));
    const sectionId = uuid.safeParse(c.req.query("sectionId"));
    if (queryParam(c, "sectionId") && !sectionId.success)
      return sendPage(c, { rows: [], next: null });
    return sendPage(
      c,
      await record(c, (db, actor) =>
        listItems(db, actor, {
          list: list.success ? list.data : undefined,
          archived: flag(c, "archived"),
          kind: kind.success ? kind.data : undefined,
          subtype: queryParam(c, "subtype"),
          excludeSubtypes: queryParam(c, "excludeSubtypes")?.split(",").filter(Boolean),
          category: queryParam(c, "category"),
          categoryId: queryParam(c, "categoryId"),
          typeId: queryParam(c, "typeId"),
          sectionId: sectionId.success ? sectionId.data : undefined,
          vendor: queryParam(c, "vendor"),
          belowPar: flag(c, "belowPar"),
          search: queryParam(c, "search"),
          tier: queryParam(c, "tier"),
          subcategory: queryParam(c, "subcategory"),
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
  routes.get("/items/:id", requireAnyPermission("inventory.read", "recipes.read"), async (c) => {
    const id = idParam(c, "Item");
    return c.json(await record(c, async (db, actor) => {
      const item = await getItem(db, actor, id);
      requireList(c, item.list, "read");
      return item;
    }));
  });
  routes.post("/items", requireAnyPermission("inventory.write", "recipes.write"), async (c) => {
    const input = await parseBody(c, itemInputSchema);
    requireList(c, inventoryListOf(input), "write");
    if (input.kind !== "consumable" && !can(c.get("actor"), "rentals.apply_directly"))
      throw new ApiError(409, "APPROVAL_REQUIRED", "Submit this Master inventory change for approval.");
    return c.json(
      await record(c, (db, actor) => createItem(db, actor, input)),
      201,
    );
  });
  routes.put("/items/:id", requireAnyPermission("inventory.write", "recipes.write"), async (c) => {
    const id = idParam(c, "Item");
    // The item's own list decides who may change it, before the body is read.
    requireList(c, inventoryListOf(await record(c, (db) => findItem(db, id))), "write");
    const input = await parseBody(c, withVersion(itemInputSchema));
    requireList(c, inventoryListOf(input), "write");
    if (input.kind !== "consumable" && !can(c.get("actor"), "rentals.apply_directly"))
      throw new ApiError(409, "APPROVAL_REQUIRED", "Submit this Master inventory change for approval.");
    return c.json(
      await record(c, (db, actor) => updateItem(db, actor, id, input)),
    );
  });
  routes.patch("/items/:id/inline", requireAnyPermission("inventory.write", "recipes.write"), async (c) => {
    const id = idParam(c, "Item");
    const { field, value, updatedAt } = await parseBody(c, inlineSchema);
    return c.json(await record(c, async (db, actor) => {
      const stored = await getItem(db, fullView, id);
      requireList(c, stored.list, "write");
      if (stored.kind !== "consumable" && !can(actor, "rentals.apply_directly"))
        throw new ApiError(409, "APPROVAL_REQUIRED", "Submit this Master inventory change for approval.");
      const input = itemInputSchema.parse({
        ...stored,
        rental: stored.rental ?? undefined,
        service: stored.service ?? undefined,
        consumable: stored.consumable ?? undefined,
        bar: stored.bar ?? undefined,
      });
      if (field === "categoryId" || field === "typeId") {
        if (value && !uuid.safeParse(value).success) throw new ApiError(400, "INVALID_REQUEST", "Invalid classification id.");
        if (field === "categoryId") { input.categoryId = value || null; input.typeId = null; }
        else input.typeId = value || null;
      } else if (field === "legacyCategory") {
        input.category = value;
      }
      else if (field === "bar.brand" || field === "bar.subcategory" || field === "bar.container") {
        if (!input.bar) throw new ApiError(400, "INVALID_FIELD", "This is not a Bar item.");
        if (field === "bar.brand") input.bar.brand = value;
        else if (field === "bar.subcategory") input.bar.subcategory = value;
        else {
          // FLOW-275: Bottle, Can, Keg or none.
          const container = barContainerSchema.safeParse(value);
          if (value && !container.success) throw new ApiError(400, "INVALID_REQUEST", "Pick bottle, can or keg.");
          input.bar.container = value ? container.data! : null;
        }
      } else if (field.startsWith("consumable.")) {
        if (!input.consumable) throw new ApiError(400, "INVALID_FIELD", "This is not a consumable item.");
        if (field === "consumable.preferredVendor") input.consumable.preferredVendor = value;
        else if (field === "consumable.parLevel") input.consumable.parLevel = value === "" ? null : Number(value);
        // FLOW-275: how it is bought. A bad value is a 400, not a 500.
        else if (field === "consumable.purchaseUnit") {
          const unit = unitSchema.safeParse(value);
          if (!unit.success) throw new ApiError(400, "INVALID_REQUEST", "Pick how it is bought.");
          input.consumable.purchaseUnit = unit.data;
        } else if (field === "consumable.packCount") {
          const count = z.coerce.number().int().positive().safeParse(value);
          if (value && !count.success) throw new ApiError(400, "INVALID_REQUEST", "Pack count must be a whole number above 0.");
          input.consumable.packCount = value ? count.data! : null;
        } else if (field === "consumable.eachSize.quantity") {
          const quantity = z.coerce.number().positive().safeParse(value);
          if (value && !quantity.success) throw new ApiError(400, "INVALID_REQUEST", "Each size must be above 0.");
          const unit = input.consumable.eachSize?.unit ?? input.consumable.recipeUnit ?? "each";
          input.consumable.eachSize = value ? { quantity: quantity.data!, unit } : null;
        } else if (field === "consumable.eachSize.unit") {
          const unit = unitSchema.safeParse(value);
          if (!unit.success) throw new ApiError(400, "INVALID_REQUEST", "Pick a unit.");
          input.consumable.eachSize = { quantity: input.consumable.eachSize?.quantity ?? 1, unit: unit.data };
        } else if (field === "consumable.recipeUnit") {
          const unit = unitSchema.safeParse(value);
          if (value && !unit.success) throw new ApiError(400, "INVALID_REQUEST", "Pick a recipe unit.");
          input.consumable.recipeUnit = value ? unit.data! : null;
        } else {
          if (value && !uuid.safeParse(value).success) throw new ApiError(400, "INVALID_REQUEST", "Invalid location id.");
          input.consumable.storageSectionId = value || null;
        }
      } else input[field as "name" | "code" | "description" | "group" | "color" | "tier"] = value;
      // FLOW-275: the changed item is checked like a full save (a Bar tier must be
      // rail, mid, high or premium; a name can't be blank).
      const checked = itemInputSchema.safeParse(input);
      if (!checked.success)
        throw new ApiError(400, "INVALID_REQUEST", checked.error.issues[0]?.message ?? "Invalid value.");
      return updateItem(db, actor, id, { ...checked.data, updatedAt });
    }));
  });
  routes.post(
    "/items/:id/transfers",
    requirePermission("inventory.move"),
    async (c) => {
      const id = idParam(c, "Item");
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
      const id = idParam(c, "Item");
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
      const id = idParam(c, "Item");
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
      const id = idParam(c, "Item");
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
      const id = idParam(c, "Movement");
      const input = await parseBody(c, correctionInputSchema);
      return c.json(
        await record(c, (db, actor) => correctMovement(db, actor, id, input)),
        201,
      );
    },
  );
  // Item history (FLOW-185): read-only; costs hidden per F-01-04.
  historyRoute(routes, record, { path: "/items/:id", what: "Item", guard: requirePermission("inventory.read"), read: itemHistory });
  routes.get(
    "/items/:id/cost-history",
    requirePermission("inventory.read"),
    async (c) => {
      const id = idParam(c, "Item");
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
    const id = idParam(c, "Count");
    return c.json(await record(c, (db, actor) => getCount(db, actor, id)));
  });
  routes.post(
    "/counts/:id/lines",
    requirePermission("inventory.count"),
    async (c) => {
      const id = idParam(c, "Count");
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
      const id = idParam(c, "Count");
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
  // Admin's order of one list (FLOW-289 AC4).
  routes.post(
    "/sections/order",
    requirePermission("inventory.sections"),
    async (c) => {
      const input = await parseBody(c, sectionOrderSchema);
      return c.json(
        await record(c, (db, actor) =>
          reorderSections(db, actor, input.kind, input.ids),
        ),
      );
    },
  );
  routes.put(
    "/sections/:id",
    requirePermission("inventory.sections"),
    async (c) => {
      const id = idParam(c, "Section");
      const input = await parseBody(c, sectionRenameSchema);
      return c.json(
        await record(c, (db, actor) =>
          renameSection(db, actor, id, input.name),
        ),
      );
    },
  );

  archiveRoutes(routes, record, {
    path: "/items/:id",
    what: "Item",
    guard: requireAnyPermission("inventory.write", "recipes.write"),
    check: async (c, db, actor, id) => {
      const item = await findItem(db, id);
      requireList(c, inventoryListOf(item), "write");
      if (item.kind !== "consumable" && !can(actor, "rentals.apply_directly"))
        throw new ApiError(409, "APPROVAL_REQUIRED", "Submit this Master inventory archive for approval.");
    },
    set: setItemArchived,
  });
  archiveRoutes(routes, record, { path: "/sections/:id", what: "Section", guard: requirePermission("inventory.sections"), set: setSectionArchived });
  return routes;
}
