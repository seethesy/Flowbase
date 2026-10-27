import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { createJobRegistry } from "../../worker/jobs/cron";
import { runDueJobs } from "../../worker/jobs/queue";
import { recordCostChange } from "../../worker/records/inventory-costs";
import { listClientRecipes } from "../../worker/records/recipes";
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
  ClientRecipe,
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
const fullTimeStaff = signedInAs("staff", "full_time");

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
    sql`truncate table attachments, recipe_lines, recipes, stock_count_lines, stock_counts, stock_movements, inventory_stock, inventory_cost_history, inventory_bar_details, inventory_consumable_details, inventory_rental_details, inventory_service_details, inventory_items, ingest_receipts, jobs`,
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
    expect((await partTimeStaff.call("POST", "/api/recipes", tuscanChicken(ids))).status).toBe(403);
    expect((await partTimeStaff.call("GET", "/api/recipes")).status).toBe(200);
    // The kitchen and full-time staff write recipes.
    const noEnteredCosts = tuscanChicken(ids);
    noEnteredCosts.lines = noEnteredCosts.lines?.map(({ enteredCostCents: _cost, ...line }) => { void _cost; return line; });
    await createRecipe(noEnteredCosts, kitchenLead);
    await createRecipe(noEnteredCosts, cook);
    await createRecipe(tuscanChicken(ids), fullTimeStaff);
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
    // FLOW-96: recipe costs are FT+ only, including kitchen roles.
    expect((await getRecipe(recipe.id, kitchenLead)).cost).toBeNull();
    expect((await getRecipe(recipe.id, cook)).cost).toBeNull();
    expect((await getRecipe(recipe.id, cook)).steps).toEqual(recipe.steps);
    expect((await getRecipe(recipe.id, fullTimeStaff)).cost?.batchCents).toBe(5415);
    const [created] = await partTimeStaff.send<HistoryEntry[]>("GET", `/api/recipes/${recipe.id}/history`);
    const lines = created.changes.lines.after as { enteredCostCents: number | null }[];
    expect(lines.every((line) => line.enteredCostCents === null)).toBe(true);
  });
});

describe("recipe books (FLOW-96/97)", () => {
  it("searches names and live ingredients and combines category and tag filters", async () => {
    const chicken = await createRecipe(tuscanChicken(ids, { dietaryTags: ["gluten_free"] }));
    const cream = await createRecipe(tuscanChicken(ids, { name: "Cream sauce", category: "sides", lines: [{ itemId: ids.cream }] }));
    const list = (query: string) => admin.send<Recipe[]>("GET", `/api/recipes?${query}`);
    expect((await list("search=chicken")).map((dish) => dish.id)).toEqual([chicken.id]);
    expect((await list("search=cream")).map((dish) => dish.id).sort()).toEqual([chicken.id, cream.id].sort());
    expect((await list("search=cream&category=mains&allergen=milk&dietaryTag=gluten_free")).map((dish) => dish.id)).toEqual([chicken.id]);
    expect(await list("dietaryTag=vegan")).toEqual([]);
    await admin.send("PUT", `/api/recipes/${cream.id}`, tuscanChicken(ids, { name: "Cream sauce", lines: [] }));
    expect((await list("search=heavy")).map((dish) => dish.id)).toEqual([chicken.id]);
  });

  it("serves only client fields and excludes archived and inactive dishes", async () => {
    const dish = await createRecipe(tuscanChicken(ids, { description: "A creamy dish" }));
    await createRecipe(tuscanChicken(ids, { name: "Inactive", active: false }));
    const archived = await createRecipe(tuscanChicken(ids, { name: "Archived" }));
    await admin.send("POST", `/api/recipes/${archived.id}/archive`, {});
    const clientDishes = await signedInAs("salesperson", "part_time").send<ClientRecipe[]>("GET", "/api/recipes/client?category=mains");
    expect(clientDishes).toHaveLength(1);
    expect(clientDishes[0]).toEqual({ id: dish.id, name: dish.name, category: dish.category, description: dish.description, ingredients: dish.lines.map((line) => line.ingredientName), allergens: ["milk"], dietaryTags: [], photo: null });
    expect(await admin.send("GET", "/api/recipes/client?category=desserts")).toEqual([]);
    const app = createApp({ withDb, resolveActor: async () => null });
    expect((await app.request("/api/recipes/client", {}, env)).status).toBe(401);
  });

  it("prevents part-time kitchen edits from reading or changing stored costs", async () => {
    const dish = await createRecipe(tuscanChicken(ids));
    expect((await cook.call("PUT", `/api/recipes/${dish.id}`, tuscanChicken(ids))).status).toBe(403);
    const input = tuscanChicken(ids, { lines: dish.lines.map((line) => ({ id: line.id, itemId: line.itemId, quantity: line.quantity, unit: line.unit })), steps: ["New method"] });
    const updated = await cook.send<Recipe>("PUT", `/api/recipes/${dish.id}`, input);
    expect(updated.cost).toBeNull();
    expect(updated.lines.every((line) => line.cost === null && line.enteredCostCents === null)).toBe(true);
    expect((await getRecipe(dish.id)).cost).toEqual(dish.cost);
    const history = await cook.send<HistoryEntry[]>("GET", `/api/recipes/${dish.id}/history`);
    expect(JSON.stringify(history)).not.toContain('"enteredCostCents":5000');
  });
});

describe("background recipe costs (FLOW-169)", () => {
  it.each(["bar", "supply"])("recalculates recipes using %s consumables", async (subtype) => {
    const item = await createItem({ ...tuscanIngredients.chicken, subtype, category: subtype === "bar" ? "Wine" : "Dry Goods", name: `Recipe ${subtype}` });
    const dish = await createRecipe(tuscanChicken(ids, { lines: [{ itemId: item.id, quantity: 2, unit: "lb" }] }));
    await admin.send("PUT", `/api/inventory/items/${item.id}`, { ...tuscanIngredients.chicken, subtype, category: item.category, name: item.name, consumable: { ...tuscanIngredients.chicken.consumable, unitCostCents: 300 } });
    await runDueJobs(db, createJobRegistry(), { batchSize: 100 });
    expect((await getRecipe(dish.id)).cost?.batchCents).toBe(600);
    const results = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:recipe.cost_recalculated"));
    expect(results).toHaveLength(1);
    expect(results[0].payload).toMatchObject({ entityId: dish.id, cost: { batchCents: 600 } });
  });
  it.each(["manual", "receiving"] as const)("recalculates every Heavy Cream recipe after %s and safely replays", async (source) => {
    const first = await createRecipe(tuscanChicken(ids));
    const second = await createRecipe(tuscanChicken(ids, { name: "Cream sauce", lines: [{ itemId: ids.cream, quantity: 2, unit: "cup" }] }));
    const unrelated = await createRecipe(tuscanChicken(ids, { name: "Plain chicken", lines: [{ itemId: ids.chicken, quantity: 1, unit: "each" }] }));
    await db.transaction(async (tx) => {
      await tx.update(schema.inventoryConsumableDetails).set({ unitCostCents: 2400 }).where(eq(schema.inventoryConsumableDetails.itemId, ids.cream));
      await recordCostChange(tx, { userId: "c1000000-0000-4000-8000-000000000001", role: "admin", employmentType: "full_time" }, { itemId: ids.cream, previousCents: null, unitCostCents: 2400, source });
    });
    const [event] = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:inventory_item.cost_changed"));
    expect(event.payload).toMatchObject({ entityId: ids.cream, source });
    const registry = createJobRegistry();
    await runDueJobs(db, registry, { batchSize: 100 });
    const results = await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:recipe.cost_recalculated"));
    expect(results.map((job) => (job.payload as { entityId: string }).entityId).sort()).toEqual([first.id, second.id].sort());
    expect(results.find((job) => (job.payload as { entityId: string }).entityId === second.id)?.payload).toMatchObject({ cost: { batchCents: 200, perServingCents: 2 } });
    expect((await getRecipe(first.id)).cost?.batchCents).toBe(5335);
    expect((await getRecipe(second.id)).cost?.batchCents).toBe(200);
    expect((await getRecipe(unrelated.id)).cost?.batchCents).toBe(0);
    await registry.get(event.type)!(event, { db });
    expect(await db.select().from(schema.jobs).where(eq(schema.jobs.type, "event:recipe.cost_recalculated"))).toHaveLength(2);
  });
});

it("projects only the first ready recipe photo with a signed URL", async () => {
  const dish = await createRecipe(tuscanChicken(ids));
  await db.insert(schema.attachments).values([
    { recordType: "recipe", recordId: dish.id, status: "pending", fileName: "pending.jpg", sortOrder: 0, variants: [{ name: "display", key: "pending.jpg", contentType: "image/jpeg", size: 100 }] },
    { recordType: "recipe", recordId: dish.id, status: "ready", fileName: "internal-filename.jpg", caption: "Internal caption", sortOrder: 1, variants: [{ name: "display", key: "recipe/photo.jpg", contentType: "image/jpeg", size: 100 }] },
  ]);
  const projected = await listClientRecipes(db, { userId: "c1000000-0000-4000-8000-000000000001", role: "salesperson", employmentType: "part_time" }, { R2_ACCOUNT_ID: "test", R2_BUCKET: "files", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test" }, {});
  expect(projected[0].photo).toContain("/files/recipe/photo.jpg?");
  expect(projected[0].photo).toContain("X-Amz-Expires=300");
  expect(JSON.stringify(projected)).not.toMatch(/internal-filename|Internal caption|pending.jpg/);
  await db.delete(schema.attachments).where(eq(schema.attachments.recordId, dish.id));
});

describe("allergens and dietary tags (FLOW-95)", () => {
  it("stores them on the dish and audits a change", async () => {
    const recipe = await createRecipe(tuscanChicken(ids));
    expect(recipe).toMatchObject({ allergens: ["milk"], dietaryTags: [] });
    const updated = await admin.send<Recipe>("PUT", `/api/recipes/${recipe.id}`, {
      ...tuscanChicken(ids),
      allergens: ["milk", "peanuts"],
      dietaryTags: ["gluten_free"],
    });
    expect(updated).toMatchObject({ allergens: ["milk", "peanuts"], dietaryTags: ["gluten_free"] });
    const [change] = await admin.send<HistoryEntry[]>("GET", `/api/recipes/${recipe.id}/history`);
    expect(change.changes.allergens).toEqual({ before: ["milk"], after: ["milk", "peanuts"] });
    expect(change.changes.dietaryTags).toEqual({ before: [], after: ["gluten_free"] });
  });

  it("rejects the old contains meat tag", async () => {
    const response = await admin.call("POST", "/api/recipes", { ...tuscanChicken(ids), dietaryTags: ["contains_meat"] });
    expect(response.status).toBe(400);
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
