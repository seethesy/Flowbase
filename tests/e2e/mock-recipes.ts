import { randomUUID } from "node:crypto";
import type { Page, Route } from "@playwright/test";
import {
  consumableDetailsInputSchema,
  type InventoryItem,
  type ItemInput,
} from "../../shared/inventory";
import {
  lineCost,
  recipeCost,
  recipeInputSchema,
  recipeTags,
  scaleRecipe,
  type Recipe,
  type RecipeInputParsed,
} from "../../shared/recipes";
import { tuscanIngredients } from "../fixtures/tuscan-chicken";
import { consumable } from "./mock-api";

// The Tuscan Chicken ingredients as catalog items, for mockInventoryApi.
export const tuscanCatalogItems = (): InventoryItem[] =>
  Object.values(tuscanIngredients).map((input: ItemInput) =>
    consumable(input.name, {
      unit: input.unit,
      category: input.category,
      details: {
        ...consumableDetailsInputSchema.parse(input.consumable),
        unitCostCents: null,
      },
    }),
  );

// An in-memory stand-in for the recipe book API (FLOW-93/94/95/98), behaving like
// the real routes for an admin. Costs, tags and scaling use the same shared
// calculations as the Worker.
export async function mockRecipesApi(page: Page, catalog: InventoryItem[]) {
  const now = () => new Date().toISOString();
  type Stored = {
    id: string;
    input: RecipeInputParsed;
    lineIds: string[];
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  const recipes = new Map<string, Stored>();
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const toRecipe = (stored: Stored): Recipe => {
    const lines = stored.input.lines;
    const costs = lines.map((line) =>
      lineCost(
        {
          quantity: line.quantity,
          unit: line.unit,
          enteredCostCents: line.enteredCostCents ?? null,
        },
        byId.get(line.itemId),
      ),
    );
    return {
      id: stored.id,
      name: stored.input.name,
      category: stored.input.category,
      description: stored.input.description,
      lines: lines.map((line, index) => ({
        id: stored.lineIds[index],
        itemId: line.itemId,
        ingredientName: byId.get(line.itemId)?.name ?? "Unknown ingredient",
        ingredientArchived: false,
        quantity: line.quantity,
        unit: line.quantity === null ? null : line.unit,
        prepNote: line.prepNote,
        enteredCostCents: line.enteredCostCents ?? null,
        cost: costs[index],
      })),
      steps: stored.input.steps,
      finishingNote: stored.input.finishingNote,
      yield: stored.input.yield,
      tags: recipeTags(
        lines.flatMap((line) => byId.get(line.itemId) ?? []),
        stored.input,
      ),
      cost: recipeCost(costs, stored.input.yield?.servings ?? null),
      costHidden: false,
      duplicates: [...recipes.values()]
        .filter(
          (other) =>
            other.id !== stored.id &&
            !other.archivedAt &&
            other.input.category === stored.input.category &&
            other.input.name.toLowerCase() === stored.input.name.toLowerCase(),
        )
        .map((other) => ({ id: other.id, name: other.input.name })),
      active: stored.input.active,
      archivedAt: stored.archivedAt,
      createdAt: stored.createdAt,
      updatedAt: stored.updatedAt,
    };
  };
  const fail = (route: Route, status: number, message: string) =>
    route.fulfill({
      status,
      json: {
        error: { code: "INVALID_REQUEST", message, requestId: randomUUID() },
      },
    });
  const parse = (body: unknown) => recipeInputSchema.safeParse(body);
  await page.route(/\/api\/recipes(\/|\?|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const [, , , id, action] = url.pathname.split("/");
    const method = request.method();
    if (!id && method === "GET") {
      const archived = url.searchParams.get("archived") === "true";
      const category = url.searchParams.get("category");
      return route.fulfill({
        json: [...recipes.values()]
          .filter(
            (stored) =>
              Boolean(stored.archivedAt) === archived &&
              (!category || stored.input.category === category),
          )
          .map(toRecipe),
      });
    }
    if (!id && method === "POST") {
      const parsed = parse(request.postDataJSON());
      if (!parsed.success)
        return fail(route, 400, parsed.error.issues[0].message);
      const stored: Stored = {
        id: randomUUID(),
        input: parsed.data,
        lineIds: parsed.data.lines.map(() => randomUUID()),
        archivedAt: null,
        createdAt: now(),
        updatedAt: now(),
      };
      recipes.set(stored.id, stored);
      return route.fulfill({ status: 201, json: toRecipe(stored) });
    }
    const stored = id ? recipes.get(id) : undefined;
    if (!stored) return fail(route, 404, "Recipe not found.");
    if (method === "GET" && !action)
      return route.fulfill({ json: toRecipe(stored) });
    if (method === "GET" && action === "scale") {
      const servings = Number(url.searchParams.get("servings"));
      if (!(servings > 0)) return fail(route, 400, "Enter servings above zero.");
      return route.fulfill({
        json: scaleRecipe(
          {
            yield: stored.input.yield,
            lines: stored.input.lines.map((line, index) => ({
              ...line,
              id: stored.lineIds[index],
            })),
          },
          catalog,
          servings,
        ),
      });
    }
    if (method === "PUT" && !action) {
      const parsed = parse(request.postDataJSON());
      if (!parsed.success)
        return fail(route, 400, parsed.error.issues[0].message);
      stored.input = parsed.data;
      stored.lineIds = parsed.data.lines.map((line) => line.id ?? randomUUID());
    }
    if (action === "archive" || action === "restore")
      stored.archivedAt = action === "archive" ? now() : null;
    stored.updatedAt = now();
    return route.fulfill({ json: toRecipe(stored) });
  });
}
