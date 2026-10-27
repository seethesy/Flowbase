import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type { HistoryEntry } from "../../shared/audit";
import type { InventoryItem, ItemInput } from "../../shared/inventory";
import type {
  Recipe,
  RecipeInput,
  ScaledRecipe,
} from "../../shared/recipes";
import {
  tuscanChicken,
  tuscanIngredients,
  type TuscanIds,
} from "../fixtures/tuscan-chicken";

// Recipe book through the real API and Postgres (FLOW-93/94/95/98).
const url = process.env.DATABASE_URL;
if (!url)
  throw new Error(
    "DATABASE_URL must point to the disposable CI Postgres service.",
  );
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
const env = { ASSETS: { fetch } };

const signedInAs = (
  role: Role,
  employmentType: EmploymentType = "full_time",
) => {
  const actor: Actor = {
    userId: "c1000000-0000-4000-8000-000000000001",
    role,
    employmentType,
  };
  const app = createApp({ withDb, resolveActor: async () => actor });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      path,
      {
        method,
        ...(body !== undefined && {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
      },
      env,
    );
  return {
    call,
    send: async <T>(
      method: string,
      path: string,
      body?: unknown,
      status = 200,
    ) => {
      const response = await call(method, path, body);
      const json = await response.json();
      expect(response.status, JSON.stringify(json)).toBe(status);
      return json as T;
    },
  };
};
const admin = signedInAs("admin");
const kitchenLead = signedInAs("kitchen_lead", "part_time");
const cook = signedInAs("kitchen_staff", "part_time");
const partTimeStaff = signedInAs("staff", "part_time");

const createItem = (input: ItemInput) =>
  admin.send<InventoryItem>("POST", "/api/inventory/items", input, 201);
const createRecipe = (input: RecipeInput, as = admin) =>
  as.send<Recipe>("POST", "/api/recipes", input, 201);
const getRecipe = (id: string, as = admin) =>
  as.send<Recipe>("GET", `/api/recipes/${id}`);

let ids: TuscanIds;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  await db.execute(
    sql`truncate table recipe_lines, recipes, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items, ingest_receipts, jobs`,
  );
  await db.execute(sql`delete from audit_log where entity_type = 'recipe'`);
  const created: Record<string, string> = {};
  for (const [key, input] of Object.entries(tuscanIngredients))
    created[key] = (await createItem(input)).id;
  ids = created as TuscanIds;
});
afterAll(async () => {
  await client.end();
});

describe("recipe record (FLOW-93)", () => {
  it("saves Tuscan Chicken with six lines, two without a quantity (AC1)", async () => {
    const recipe = await createRecipe(tuscanChicken(ids));
    expect(recipe.lines.map((line) => [line.ingredientName, line.quantity, line.unit])).toEqual([
      ["Chicken Breast", 10, "each"],
      ["Heavy Cream", 1, "cup"],
      ["Tomatoes", 5, "oz"],
      ["Spinach", 3, "cup"],
      ["Italian Seasoning", null, null],
      ["Salt and Pepper", null, null],
    ]);
    expect(recipe).toMatchObject({
      name: "Tuscan Chicken",
      category: "mains",
      steps: tuscanChicken(ids).steps,
      finishingNote: "garnish with basil",
      yield: { servings: 100, portionSize: "" },
      duplicates: [],
      active: true,
    });
    expect(await getRecipe(recipe.id)).toEqual(recipe);
  });

  it("saves a recipe with no yield (AC2)", async () => {
    const recipe = await createRecipe(tuscanChicken(ids, { yield: null }));
    expect(recipe.yield).toBeNull();
    expect(recipe.cost?.perServingCents).toBeNull();
  });

  it("audits create, edit, archive and restore (AC3)", async () => {
    const recipe = await createRecipe(tuscanChicken(ids));
    const edited = tuscanChicken(ids, {
      yield: { servings: 50, portionSize: "6 oz" },
      lines: recipe.lines.slice(0, 5).map((line) => ({
        id: line.id,
        itemId: line.itemId,
        quantity: line.quantity,
        unit: line.unit,
        prepNote: line.itemId === ids.chicken ? "pounded thin" : line.prepNote,
      })),
    });
    const updated = await admin.send<Recipe>("PUT", `/api/recipes/${recipe.id}`, edited);
    expect(updated.lines).toHaveLength(5);
    // Omitted entered costs are kept.
    expect(updated.lines[0]).toMatchObject({ id: recipe.lines[0].id, enteredCostCents: 5000, prepNote: "pounded thin" });
    // An edit that changes nothing writes no audit row.
    await admin.send("PUT", `/api/recipes/${recipe.id}`, edited);
    await admin.send("POST", `/api/recipes/${recipe.id}/archive`, {});
    await admin.send("POST", `/api/recipes/${recipe.id}/restore`, {});
    const history = await admin.send<HistoryEntry[]>("GET", `/api/recipes/${recipe.id}/history`);
    expect(history.map((entry) => entry.action)).toEqual(["restore", "archive", "update", "create"]);
    expect(Object.keys(history[2].changes).sort()).toEqual(["lines", "yield"]);
    expect(history[2].changes.yield).toEqual({
      before: { servings: 100, portionSize: "" },
      after: { servings: 50, portionSize: "6 oz" },
    });
  });

  it("flags a duplicate name in the same category, not in another", async () => {
    const first = await createRecipe(tuscanChicken(ids));
    const second = await createRecipe(tuscanChicken(ids, { name: "tuscan chicken" }));
    await createRecipe(tuscanChicken(ids, { category: "appetizers" }));
    expect(second.duplicates).toEqual([{ id: first.id, name: "Tuscan Chicken" }]);
    const list = await admin.send<Recipe[]>("GET", "/api/recipes?category=mains");
    expect(list.map((recipe) => recipe.duplicates.length)).toEqual([1, 1]);
  });

  it("needs catalog ingredients and recipes.write", async () => {
    const chairs = await createItem({ kind: "rental", subtype: "furniture", name: "Chair" });
    const response = await admin.call("POST", "/api/recipes", tuscanChicken(ids, { lines: [{ itemId: chairs.id }] }));
    expect(response.status).toBe(400);
    expect((await cook.call("POST", "/api/recipes", tuscanChicken(ids))).status).toBe(403);
    expect((await partTimeStaff.call("GET", "/api/recipes")).status).toBe(200);
    // The kitchen lead writes recipes.
    await createRecipe(tuscanChicken(ids), kitchenLead);
  });
});

describe("recipe costing (FLOW-94)", () => {
  it("costs Tuscan Chicken at $54.15 and $0.54 a serving (AC1, AC2, AC4)", async () => {
    const recipe = await createRecipe(tuscanChicken(ids));
    expect(recipe.cost).toEqual({ batchCents: 5415, perServingCents: 54, noCostLines: 2 });
    expect(recipe.lines.map((line) => line.cost?.source)).toEqual([
      "entered", "entered", "entered", "entered", "none", "none",
    ]);
  });

  it("switches to the calculated cost when the ingredient gets a cost (AC3)", async () => {
    const recipe = await createRecipe(tuscanChicken(ids));
    const chicken = tuscanIngredients.chicken;
    await admin.send("PUT", `/api/inventory/items/${ids.chicken}`, {
      ...chicken,
      consumable: { ...chicken.consumable, unitCostCents: 400 },
    });
    const costed = await getRecipe(recipe.id);
    expect(costed.lines[0].cost).toEqual({ source: "calculated", cents: 2000, problem: null });
    expect(costed.cost?.batchCents).toBe(2000 + 180 + 110 + 125);
  });

  it("hides costs from part-time staff, in the recipe and its history", async () => {
    const recipe = await createRecipe(tuscanChicken(ids));
    const seen = await getRecipe(recipe.id, partTimeStaff);
    expect(seen.cost).toBeNull();
    expect(seen.costHidden).toBe(true);
    expect(seen.lines.every((line) => line.cost === null && line.enteredCostCents === null)).toBe(true);
    // Kitchen roles see costs (F-01-04).
    expect((await getRecipe(recipe.id, kitchenLead)).cost?.batchCents).toBe(5415);
    const [created] = await partTimeStaff.send<HistoryEntry[]>("GET", `/api/recipes/${recipe.id}/history`);
    const lines = created.changes.lines.after as { enteredCostCents: number | null }[];
    expect(lines.every((line) => line.enteredCostCents === null)).toBe(true);
  });
});

describe("allergens and dietary tags (FLOW-95)", () => {
  it("derives Milk and contains meat, and follows a new peanut ingredient (AC1, AC2)", async () => {
    const recipe = await createRecipe(tuscanChicken(ids));
    expect(recipe.tags).toMatchObject({ allergens: ["milk"], dietaryTags: ["contains_meat"], unverifiedIngredients: [] });
    const peanuts = await createItem({
      kind: "consumable",
      subtype: "ingredient",
      name: "Peanuts",
      consumable: { purchaseUnit: "lb", allergens: ["peanuts"] },
    });
    const garlic = await createItem({
      kind: "consumable",
      subtype: "ingredient",
      name: "Garlic",
      consumable: { purchaseUnit: "lb" },
    });
    const input = tuscanChicken(ids);
    const updated = await admin.send<Recipe>("PUT", `/api/recipes/${recipe.id}`, {
      ...input,
      lines: [...(input.lines ?? []), { itemId: peanuts.id }, { itemId: garlic.id }],
    });
    expect(updated.tags.allergens).toEqual(["milk", "peanuts"]);
    expect(updated.tags.unverifiedIngredients).toEqual(["Garlic"]);
  });

  it("stores and shows a manual override (AC3)", async () => {
    const recipe = await createRecipe(tuscanChicken(ids, { allergenOverride: ["milk", "tree_nuts"] }));
    expect(recipe.tags).toMatchObject({
      allergens: ["milk", "tree_nuts"],
      derivedAllergens: ["milk"],
      allergenOverride: ["milk", "tree_nuts"],
      dietaryOverride: null,
    });
    const [created] = await admin.send<HistoryEntry[]>("GET", `/api/recipes/${recipe.id}/history`);
    expect(created.changes.allergenOverride).toEqual({ before: null, after: ["milk", "tree_nuts"] });
  });
});

describe("recipe scaling (FLOW-98)", () => {
  it("scales Tuscan Chicken to 120 servings (AC1)", async () => {
    const recipe = await createRecipe(tuscanChicken(ids));
    const scaled = await admin.send<ScaledRecipe>("GET", `/api/recipes/${recipe.id}/scale?servings=120`);
    if (!scaled.ok) throw new Error(scaled.message);
    expect(scaled.lines[0]).toMatchObject({ ingredientName: "Chicken Breast", quantity: 12, unit: "each" });
    expect(scaled.lines[1]).toMatchObject({ ingredientName: "Heavy Cream", quantity: 1.2, unit: "cup" });
    expect(scaled.lines[4]).toMatchObject({ asNeeded: true });
  });

  it("answers no yield for a dish without one (AC2)", async () => {
    const recipe = await createRecipe(tuscanChicken(ids, { yield: null }));
    expect(await admin.send("GET", `/api/recipes/${recipe.id}/scale?servings=120`)).toMatchObject({
      ok: false,
      reason: "no_yield",
    });
    expect((await admin.call("GET", `/api/recipes/${recipe.id}/scale?servings=0`)).status).toBe(400);
  });
});
