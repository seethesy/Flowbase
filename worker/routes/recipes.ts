import { Hono } from "hono";
import {
  recipeCategorySchema,
  recipeInputSchema,
  scaleQuerySchema,
} from "../../shared/recipes";
import { id as uuid } from "../../shared/schema-primitives";
import { requireActor, requirePermission, type ResolveActor } from "../auth";
import {
  ApiError,
  notFound,
  parseBody,
  recordRunner,
  type AppContext,
  type AppEnv,
  type RunWithDb,
} from "../hono";
import {
  createRecipe,
  getRecipe,
  listRecipes,
  recipeHistory,
  scaleRecipeFor,
  setRecipeArchived,
  updateRecipe,
} from "../records/recipes";

// Recipe book API (FLOW-93/94/95/98), mounted at /api/recipes. Every signed-in user
// can read recipes; recipes.write creates, edits and archives them. Costs come back
// null for callers who can't see costs.
export function recipeRoutes(options: {
  withDb?: RunWithDb;
  resolveActor?: ResolveActor;
}) {
  const routes = new Hono<AppEnv>();
  const record = recordRunner(options.withDb);
  routes.use("*", requireActor(options.resolveActor));
  const param = (c: AppContext) => {
    const parsed = uuid.safeParse(c.req.param("id"));
    if (!parsed.success) throw notFound("Recipe");
    return parsed.data;
  };

  routes.get("/", requirePermission("recipes.read"), async (c) => {
    const category = recipeCategorySchema.safeParse(c.req.query("category"));
    return c.json(
      await record(c, (db, actor) =>
        listRecipes(db, actor, {
          archived: c.req.query("archived") === "true",
          category: category.success ? category.data : undefined,
          search: c.req.query("search") || undefined,
        }),
      ),
    );
  });
  routes.get("/:id", requirePermission("recipes.read"), async (c) => {
    const id = param(c);
    return c.json(await record(c, (db, actor) => getRecipe(db, actor, id)));
  });
  // Record history (FLOW-41): read-only, like the core records'.
  routes.get("/:id/history", requirePermission("recipes.read"), async (c) => {
    const id = param(c);
    return c.json(
      await record(c, (db, actor) => recipeHistory(db, actor, id)),
    );
  });
  // FLOW-98: GET /api/recipes/<id>/scale?servings=120.
  routes.get("/:id/scale", requirePermission("recipes.read"), async (c) => {
    const id = param(c);
    const servings = scaleQuerySchema.safeParse(c.req.query("servings"));
    if (!servings.success)
      throw new ApiError(
        400,
        "INVALID_REQUEST",
        servings.error.issues[0]?.message ?? "Enter servings above zero.",
      );
    return c.json(
      await record(c, (db) => scaleRecipeFor(db, id, servings.data)),
    );
  });
  routes.post("/", requirePermission("recipes.write"), async (c) => {
    const input = await parseBody(c, recipeInputSchema);
    return c.json(
      await record(c, (db, actor) => createRecipe(db, actor, input)),
      201,
    );
  });
  routes.put("/:id", requirePermission("recipes.write"), async (c) => {
    const id = param(c);
    const input = await parseBody(c, recipeInputSchema);
    return c.json(
      await record(c, (db, actor) => updateRecipe(db, actor, id, input)),
    );
  });
  for (const [action, archived] of [
    ["archive", true],
    ["restore", false],
  ] as const)
    routes.post(
      `/:id/${action}`,
      requirePermission("recipes.write"),
      async (c) => {
        const id = param(c);
        return c.json(
          await record(c, (db, actor) =>
            setRecipeArchived(db, actor, id, archived),
          ),
        );
      },
    );
  return routes;
}
