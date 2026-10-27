import { isFtPlus } from "../../shared/access";
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { Allergen } from "../../shared/inventory";
import {
  lineCost,
  clientRecipe,
  recipeCost,
  scaleRecipe,
  type DietaryTag,
  type Recipe,
  type RecipeCategory,
  type RecipeIngredient,
  type RecipeInputParsed,
  type ScaledRecipe,
} from "../../shared/recipes";
import type { Unit } from "../../shared/units";
import { fullView, listHistory, maskField, writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { attachments, inventoryItems, recipeLines, recipes } from "../db/schema";
import { fileStorage } from "../attachments/storage";
import type { Bindings } from "../bindings";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent, type JobRegistry } from "../jobs/queue";
import { setArchived } from "./archive";
import { toItems } from "./inventory-items";
import { syncChildren } from "./sync";

// Recipe book (FLOW-93). Every signed-in user can read recipes; recipes.write
// changes them. Costs (FLOW-94) and scaled quantities (FLOW-98) are worked out
// from the ingredients on every read, so a new ingredient cost shows at once on
// every dish that uses it; allergens and dietary tags (FLOW-95) are set on the
// dish. Costs, including entered line costs, are FT+ only (F-01-04).
type RecipeRow = typeof recipes.$inferSelect;
type LineRow = typeof recipeLines.$inferSelect;

async function liveLines(db: DbLike, recipeIds: string[]) {
  if (!recipeIds.length) return [];
  return db
    .select()
    .from(recipeLines)
    .where(
      and(
        inArray(recipeLines.recipeId, recipeIds),
        isNull(recipeLines.archivedAt),
      ),
    )
    .orderBy(asc(recipeLines.sortOrder));
}

// The catalog items the lines use, archived ones included, with every field: the
// calculations need the costs even when the caller may not see them.
async function ingredientsOf(
  db: DbLike,
  lines: LineRow[],
): Promise<Map<string, RecipeIngredient & { archived: boolean }>> {
  const ids = [...new Set(lines.map((line) => line.itemId))];
  if (!ids.length) return new Map();
  const rows = await db
    .select()
    .from(inventoryItems)
    .where(inArray(inventoryItems.id, ids));
  const items = await toItems(db, fullView, rows);
  return new Map(
    items.map((item) => [item.id, { ...item, archived: !!item.archivedAt }]),
  );
}

// Other live recipes with the same name in the same category (FLOW-93).
async function duplicatesOf(db: DbLike, rows: RecipeRow[]) {
  const names = [...new Set(rows.map((row) => row.name.toLowerCase()))];
  if (!names.length) return [];
  return db
    .select({ id: recipes.id, name: recipes.name, category: recipes.category })
    .from(recipes)
    .where(
      and(
        isNull(recipes.archivedAt),
        inArray(sql`lower(${recipes.name})`, names),
      ),
    );
}

async function toRecipes(
  db: DbLike,
  actor: Actor,
  rows: RecipeRow[],
): Promise<Recipe[]> {
  if (!rows.length) return [];
  const lines = await liveLines(
    db,
    rows.map((row) => row.id),
  );
  const [ingredients, sameNames] = await Promise.all([
    ingredientsOf(db, lines),
    duplicatesOf(db, rows),
  ]);
  const showCost = isFtPlus(actor);
  return rows.map((row): Recipe => {
    const own = lines.filter((line) => line.recipeId === row.id);
    const costs = own.map((line) =>
      lineCost(
        {
          quantity: line.quantity,
          unit: line.unit as Unit | null,
          enteredCostCents: line.enteredCostCents,
        },
        ingredients.get(line.itemId),
      ),
    );
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      description: row.description,
      lines: own.map((line, index) => {
        const ingredient = ingredients.get(line.itemId);
        return {
          id: line.id,
          itemId: line.itemId,
          ingredientName: ingredient?.name ?? "Unknown ingredient",
          ingredientArchived: ingredient?.archived ?? false,
          quantity: line.quantity,
          unit: line.unit as Unit | null,
          prepNote: line.prepNote,
          enteredCostCents: showCost ? line.enteredCostCents : null,
          cost: showCost ? costs[index] : null,
        };
      }),
      steps: row.steps,
      finishingNote: row.finishingNote,
      yield:
        row.yieldServings === null
          ? null
          : { servings: row.yieldServings, portionSize: row.portionSize },
      allergens: row.allergens as Allergen[],
      dietaryTags: row.dietaryTags as DietaryTag[],
      cost: showCost ? recipeCost(costs, row.yieldServings) : null,
      costHidden: !showCost,
      duplicates: sameNames
        .filter(
          (other) =>
            other.id !== row.id &&
            other.category === row.category &&
            other.name.toLowerCase() === row.name.toLowerCase(),
        )
        .map(({ id, name }) => ({ id, name })),
      active: row.active,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export type RecipeFilter = {
  archived?: boolean;
  category?: RecipeCategory;
  search?: string;
  allergen?: Allergen;
  dietaryTag?: DietaryTag;
};

export async function listRecipes(
  db: Db,
  actor: Actor,
  filter: RecipeFilter,
): Promise<Recipe[]> {
  const rows = await db
    .select()
    .from(recipes)
    .where(
      and(
        filter.archived
          ? isNotNull(recipes.archivedAt)
          : isNull(recipes.archivedAt),
        filter.category ? eq(recipes.category, filter.category) : undefined,
        filter.search ? or(
          ilike(recipes.name, `%${filter.search}%`),
          sql`exists (select 1 from ${recipeLines} inner join ${inventoryItems} on ${inventoryItems.id} = ${recipeLines.itemId} where ${recipeLines.recipeId} = ${recipes.id} and ${recipeLines.archivedAt} is null and ${inventoryItems.name} ilike ${`%${filter.search}%`})`,
        ) : undefined,
        filter.allergen ? sql`${recipes.allergens} @> ${JSON.stringify([filter.allergen])}::jsonb` : undefined,
        filter.dietaryTag ? sql`${recipes.dietaryTags} @> ${JSON.stringify([filter.dietaryTag])}::jsonb` : undefined,
      ),
    )
    .orderBy(asc(recipes.category), asc(recipes.name))
    .limit(2000);
  return toRecipes(db, actor, rows);
}

// Signed-in staff only. Project on the server as well as using a separate UI:
// a salesperson showing this screen never downloads internal recipe fields.
export async function listClientRecipes(db: Db, actor: Actor, env: Partial<Bindings>, filter: RecipeFilter) {
  const dishes = (await listRecipes(db, actor, { ...filter, archived: false }))
    .filter((dish) => dish.active);
  if (!dishes.length) return [];
  const photos = await db.select().from(attachments).where(and(
    eq(attachments.recordType, "recipe"), eq(attachments.status, "ready"),
    isNull(attachments.archivedAt), inArray(attachments.recordId, dishes.map((dish) => dish.id)),
  )).orderBy(asc(attachments.sortOrder), asc(attachments.createdAt));
  const now = new Date();
  return Promise.all(dishes.map(async (dish) => {
    const photo = photos.find((row) => row.recordId === dish.id && row.variants.some((variant) => variant.name === "display"));
    const display = photo?.variants.find((variant) => variant.name === "display");
    return clientRecipe(dish, display ? await fileStorage(env).downloadUrl(display.key, 300, now) : null);
  }));
}

export async function findRecipe(db: DbLike, id: string) {
  const [row] = await db.select().from(recipes).where(eq(recipes.id, id));
  if (!row) throw notFound("Recipe");
  return row;
}

export async function getRecipe(db: DbLike, actor: Actor, id: string) {
  const [recipe] = await toRecipes(db, actor, [await findRecipe(db, id)]);
  return recipe;
}

// FLOW-169: recalculate from current catalog data, never the event's old price.
// Costs remain derived on reads (FLOW-94); the resulting domain events record
// the background calculation without introducing a second, stale cost cache.
export function registerRecipeCostChanges(registry: JobRegistry) {
  registry.register("event:inventory_item.cost_changed", async (job, { db }) => {
    const payload = job.payload as { entityId?: string };
    if (!payload.entityId) throw new Error("Cost change needs an item id.");
    await db.transaction(async (tx) => {
      const affected = await tx.selectDistinct({ id: recipeLines.recipeId })
        .from(recipeLines).where(and(eq(recipeLines.itemId, payload.entityId!), isNull(recipeLines.archivedAt)));
      if (!affected.length) return;
      const rows = await tx.select().from(recipes).where(inArray(recipes.id, affected.map((row) => row.id)));
      for (const dish of await toRecipes(tx, fullView, rows)) {
        await emitDomainEvent(tx, {
          name: "recipe.cost_recalculated", entityId: dish.id,
          data: { itemId: payload.entityId, costChangeJobId: job.id, cost: dish.cost },
          idempotencyKey: `recipe-cost:${job.id}:${dish.id}`,
        });
      }
    });
  });
}

// The recipe as an audit snapshot (FLOW-41): what was entered, not what is worked
// out from the ingredients, so an ingredient's new cost isn't a recipe change.
async function recipeSnapshot(db: DbLike, id: string) {
  const row = await findRecipe(db, id);
  const lines = await liveLines(db, [id]);
  const ingredients = await ingredientsOf(db, lines);
  return {
    name: row.name,
    category: row.category,
    description: row.description,
    lines: lines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      ingredientName: ingredients.get(line.itemId)?.name ?? "",
      quantity: line.quantity,
      unit: line.unit,
      prepNote: line.prepNote,
      enteredCostCents: line.enteredCostCents,
    })),
    steps: row.steps,
    finishingNote: row.finishingNote,
    yield:
      row.yieldServings === null
        ? null
        : { servings: row.yieldServings, portionSize: row.portionSize },
    allergens: row.allergens,
    dietaryTags: row.dietaryTags,
    active: row.active,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

// History hides entered line costs from callers who can't see costs.
export async function recipeHistory(db: DbLike, actor: Actor, id: string) {
  await findRecipe(db, id);
  const showCost = isFtPlus(actor);
  return listHistory(db, "recipe", id, (changes) =>
    showCost
      ? changes
      : maskField("lines", (value) =>
          Array.isArray(value)
            ? value.map((line: Record<string, unknown>) => ({
                ...line,
                enteredCostCents: null,
              }))
            : value,
        )(changes),
  );
}

const invalid = (message: string) =>
  new ApiError(400, "INVALID_REQUEST", message);

// Every line uses a catalog ingredient (FLOW-81). An archived ingredient can stay
// on a line that already had it but can't be added.
async function requireIngredients(
  tx: DbLike,
  input: RecipeInputParsed,
  stored: LineRow[],
) {
  const ids = [...new Set(input.lines.map((line) => line.itemId))];
  if (!ids.length) return;
  const rows = await tx
    .select()
    .from(inventoryItems)
    .where(inArray(inventoryItems.id, ids));
  for (const line of input.lines) {
    const item = rows.find((row) => row.id === line.itemId);
    if (!item || item.kind !== "consumable")
      throw invalid("Every line needs an ingredient from the catalog.");
    const kept = stored.some(
      (row) => row.id === line.id && row.itemId === line.itemId,
    );
    if (item.archivedAt && !kept)
      throw invalid(`${item.name} is archived; pick another ingredient.`);
  }
}

async function saveLines(
  tx: DbLike,
  actor: Actor,
  recipeId: string,
  input: RecipeInputParsed,
) {
  const showCost = isFtPlus(actor);
  if (
    !showCost &&
    input.lines.some((line) => line.enteredCostCents !== undefined)
  )
    throw forbidden();
  const stored = await liveLines(tx, [recipeId]);
  await requireIngredients(tx, input, stored);
  const values = (line: RecipeInputParsed["lines"][number], sortOrder: number) => ({
    itemId: line.itemId,
    quantity: line.quantity,
    unit: line.quantity === null ? null : line.unit,
    prepNote: line.prepNote,
    sortOrder,
    updatedBy: actor.userId,
    // Omitted keeps the stored cost (a part-time user's edit never clears it).
    ...(line.enteredCostCents !== undefined && {
      enteredCostCents: line.enteredCostCents,
    }),
  });
  await syncChildren(
    stored.map((line) => line.id),
    input.lines,
    {
      insert: (line, sortOrder) =>
        tx.insert(recipeLines).values({
          recipeId,
          ...values(line, sortOrder),
          createdBy: actor.userId,
        }),
      update: (id, line, sortOrder) =>
        tx
          .update(recipeLines)
          .set(values(line, sortOrder))
          .where(eq(recipeLines.id, id)),
      archive: (ids) =>
        tx
          .update(recipeLines)
          .set({ archivedAt: new Date(), updatedBy: actor.userId })
          .where(inArray(recipeLines.id, ids)),
    },
  );
}

const recipeValues = (input: RecipeInputParsed, actor: Actor) => ({
  name: input.name,
  category: input.category,
  description: input.description,
  steps: input.steps,
  finishingNote: input.finishingNote,
  yieldServings: input.yield?.servings ?? null,
  portionSize: input.yield?.portionSize ?? "",
  allergens: input.allergens,
  dietaryTags: input.dietaryTags,
  active: input.active,
  updatedBy: actor.userId,
});

export async function createRecipe(
  db: Db,
  actor: Actor,
  input: RecipeInputParsed,
): Promise<Recipe> {
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(recipes)
      .values({ ...recipeValues(input, actor), createdBy: actor.userId })
      .returning({ id: recipes.id });
    await saveLines(tx, actor, row.id, input);
    await writeAudit(tx, actor, {
      entityType: "recipe",
      entityId: row.id,
      action: "create",
      before: null,
      after: await recipeSnapshot(tx, row.id),
    });
    await emitDomainEvent(tx, { name: "recipe.created", entityId: row.id });
    return row.id;
  });
  return getRecipe(db, actor, id);
}

export async function updateRecipe(
  db: Db,
  actor: Actor,
  id: string,
  input: RecipeInputParsed,
): Promise<Recipe> {
  await findRecipe(db, id);
  await db.transaction(async (tx) => {
    const before = await recipeSnapshot(tx, id);
    await tx
      .update(recipes)
      .set(recipeValues(input, actor))
      .where(eq(recipes.id, id));
    await saveLines(tx, actor, id, input);
    await writeAudit(tx, actor, {
      entityType: "recipe",
      entityId: id,
      action: "update",
      before,
      after: await recipeSnapshot(tx, id),
    });
    await emitDomainEvent(tx, { name: "recipe.updated", entityId: id });
  });
  return getRecipe(db, actor, id);
}

export async function setRecipeArchived(
  db: Db,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<Recipe> {
  await findRecipe(db, id);
  await setArchived(db, actor, id, archived, {
    update: (tx, values) =>
      tx.update(recipes).set(values).where(eq(recipes.id, id)),
    audit: { entityType: "recipe", snapshot: recipeSnapshot },
    event: "recipe",
  });
  return getRecipe(db, actor, id);
}

// The dish for `servings` (FLOW-98). Without a yield it answers "no yield" rather
// than quantities.
export async function scaleRecipeFor(
  db: DbLike,
  id: string,
  servings: number,
): Promise<ScaledRecipe> {
  const row = await findRecipe(db, id);
  const lines = await liveLines(db, [id]);
  const ingredients = await ingredientsOf(db, lines);
  return scaleRecipe(
    {
      yield: row.yieldServings === null ? null : { servings: row.yieldServings },
      lines: lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        quantity: line.quantity,
        unit: line.unit as Unit | null,
        prepNote: line.prepNote,
      })),
    },
    [...ingredients.values()],
    servings,
  );
}
