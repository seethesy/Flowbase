import { useDeletable } from "../../app/live-edit/deletable";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { Dropdown } from "../../components/ui/Dropdown";
import { Allowed, usePermissions } from "../../app/permissions";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { type ColumnDef } from "@tanstack/react-table";
import { type Recipe, type RecipeInput } from "../../../shared/recipes";
import { type Unit } from "../../../shared/units";
import { canSeeField } from "../../../shared/visibility";
import { utcToBusinessTime } from "../../../shared/time";
import { recipesApi } from "../../services/core";
import { useResource } from "../../app/useResource";
import { Button, DataTable, FilterBar, LoadingSkeleton, SearchInput, ErrorText } from "../../components/shared";
import { centsLabel, quantityLabel } from "../inventory/inventory-labels";
import { useArchivedMarks, useListLabels } from "../common/list-fields";
import { KitchenCard, KitchenHeading } from "./kitchen-screen";
import { weekday } from "../events/calendar-entries";
import { RoundCheck } from "../../components/ui/round-check";
import { T, useCopy } from "../../app/copy";
import { RecipeForm } from "./recipe-form";
import "../inventory/inventory.css";

// The recipe book list (FLOW-93), with its category, allergen and dietary filters.

// Allergens, dietary tags and the category are saved as the labels of the settings
// lists (FLOW-218); a value archived since is shown marked.
export const markedList = (values: string[], mark: (label: string) => string) =>
  values.map(mark).join(", ");

const uniqueLabels = (labels: string[]) => [...new Set(labels)];

export const yieldLabel = (recipe: Recipe) =>
  recipe.yield
    ? `${Number(recipe.yield.servings)} servings${recipe.yield.portionSize && ` · ${recipe.yield.portionSize}`}`
    : "No yield";

export const lineQuantity = (quantity: number | null, unit: Unit | null) =>
  quantity === null || !unit ? "As needed" : quantityLabel(quantity, unit);

export function RecipeFlags({ recipe }: { recipe: Recipe }) {
  return (
    <>
      {recipe.duplicates.length > 0 && (
        <span className="badge warning"><T id="recipes.recipe-flags.duplicate-name">Duplicate name</T></span>
      )}
      {!recipe.yield && <span className="badge neutral"><T id="recipes.recipe-flags.no-yield">No yield</T></span>}
      {!recipe.active && <span className="badge error"><T id="recipes.recipe-flags.inactive">Inactive</T></span>}
    </>
  );
}

export function RecipeList() {
  const searchRecipesPlaceholder = useCopy("recipes.recipe-list.search-recipes.placeholder", "Search recipes…");
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [archived, setArchived] = useState(false);
  const categoryLabels = uniqueLabels(useListLabels("recipe_category"));
  const allergenLabels = uniqueLabels(useListLabels("allergen"));
  const dietaryTagLabels = uniqueLabels(useListLabels("dietary_tag"));
  const markCategory = useArchivedMarks("recipe_category");
  const markAllergen = useArchivedMarks("allergen");
  const markDietaryTag = useArchivedMarks("dietary_tag");
  const [allergen, setAllergen] = useState("");
  const [dietaryTag, setDietaryTag] = useState("");
  const [create, setCreate] = useState(false);
  // Open shows the kitchen card (FLOW-267).
  const [card, setCard] = useState<Recipe | null>(null);
  const recipes = useResource(
    ["recipes", { archived, category }],
    () => recipesApi.list({ archived, category: category || undefined }),
    { keepPrevious: true },
  );
  const deletable = useDeletable("recipe", () => recipes.reload());
  const data = (recipes.data ?? []).filter((recipe) =>
    [recipe.name, ...recipe.lines.map((line) => line.ingredientName)].some((name) => name.toLowerCase().includes(search.toLowerCase())) &&
    // "Free of …" (FLOW-267): recipes without the chosen allergen.
    (!allergen || !recipe.allergens.includes(allergen)) &&
    (!dietaryTag || recipe.dietaryTags.some((tag) => tag === dietaryTag)),
  );
  const { actor, can } = usePermissions();
  const costHidden = !actor || !canSeeField(actor, "internal_cost", { view: "internal_recipe" });
  const edit = async (recipe: Recipe, change: Partial<Pick<RecipeInput, "name" | "category" | "yield" | "allergens" | "dietaryTags">>) => {
    const current = await recipesApi.get(recipe.id);
    await recipesApi.update(recipe.id, {
      name: current.name, category: current.category, description: current.description,
      lines: current.lines.map((line) => ({ id: line.id, itemId: line.itemId,
        quantity: line.quantity, unit: line.unit, prepNote: line.prepNote,
        ...(!current.costHidden && { enteredCostCents: line.enteredCostCents }) })),
      steps: current.steps, finishingNote: current.finishingNote, yield: current.yield,
      allergens: current.allergens, dietaryTags: current.dietaryTags, active: current.active,
      ...change,
    });
    recipes.reload();
  };
  const columns: ColumnDef<Recipe, unknown>[] = [
    { accessorKey: "name", header: "Dish", meta: { edit: "text", canEdit: () => can("recipes.write"), onEdit: (row, value) => edit(row, { name: value }) } },
    {
      id: "category",
      header: "Category",
      accessorFn: (recipe) => markCategory(recipe.category),
      meta: { edit: "select", canEdit: () => can("recipes.write"),
        editValue: (row) => row.category,
        editOptions: categoryLabels.map((value) => ({ value, label: markCategory(value) })),
        onEdit: (row, value) => edit(row, { category: value }) },
    },
    { id: "yield", header: "Yield", accessorFn: yieldLabel,
      meta: { edit: "number", editValue: (row) => row.yield?.servings.toString() ?? "",
        canEdit: () => can("recipes.write"),
        onEdit: (row, value) => edit(row, { yield: value ? { servings: Number(value), portionSize: row.yield?.portionSize ?? "" } : null }) } },
    // FLOW-267: allergens and dietary tags show as chips; they're edited on the
    // recipe, with its ingredients.
    {
      id: "allergens",
      header: "Allergens",
      accessorFn: (recipe) => markedList(recipe.allergens, markAllergen) || "—",
      cell: ({ row }) => <span className="recipe-chips">{row.original.allergens.map((tag) => <span key={tag} className="badge warning">{markAllergen(tag)}</span>)}</span>,
    },
    { id: "dietary", header: "Dietary", accessorFn: (recipe) => markedList(recipe.dietaryTags, markDietaryTag) || "—",
      cell: ({ row }) => <span className="recipe-chips">{row.original.dietaryTags.map((tag) => <span key={tag} className="badge success">{markDietaryTag(tag)}</span>)}</span> },
    ...(costHidden
      ? []
      : [
          {
            id: "perServing",
            header: "Cost per serving",
            accessorFn: (recipe: Recipe) =>
              centsLabel(recipe.cost?.perServingCents ?? null),
          },
        ]),
    { id: "updated", header: "Updated", accessorFn: (recipe) => recipe.updatedAt,
      cell: ({ row }) => weekday(utcToBusinessTime(new Date(row.original.updatedAt)).date) },
    {
      id: "flags",
      header: "Flags",
      cell: ({ row }) => <RecipeFlags recipe={row.original} />,
    },
  ];
  // The preview's order (FLOW-267): Dish, Category, Yield, Cost per serving,
  // Allergens, Dietary, Updated, then flags.
  const order = ["name", "category", "yield", "perServing", "allergens", "dietary", "updated", "flags"];
  const keyOf = (column: ColumnDef<Recipe, unknown>) => {
    const named = column as { id?: string; accessorKey?: string };
    return named.id ?? named.accessorKey ?? "";
  };
  columns.sort((a, b) => order.indexOf(keyOf(a)) - order.indexOf(keyOf(b)));
  return (
    <>
      <KitchenHeading tab="recipes">
        <Button asChild variant="outline"><Link to="/recipes/client"><T id="recipes.recipe-list.client-recipe-book">Client recipe book</T></Link></Button>
        <Allowed action="recipes.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            <T id="recipes.recipe-list.new-recipe">New Recipe</T>
          </Button>
        </Allowed>
      </KitchenHeading>
      <PageGrid pageKey="recipes.list">
      <Block id="filters" name="Filters" h={4}>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={searchRecipesPlaceholder} copyId="recipes.recipe-list.search-recipes.placeholder"
        />
        <Dropdown
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categoryLabels.map((option) => (
            <option key={option} value={option}>
              {markCategory(option)}
            </option>
          ))}
        </Dropdown>
        <Dropdown aria-label="Allergen" value={allergen} onChange={(e) => setAllergen(e.target.value)}>
          <option value="">Any allergens</option>
          {allergenLabels.map((tag) => <option key={tag} value={tag}>{`Free of ${markAllergen(tag)}`}</option>)}
        </Dropdown>
        <Dropdown aria-label="Dietary tag" value={dietaryTag} onChange={(e) => setDietaryTag(e.target.value)}>
          <option value="">Any dietary tag</option>
          {dietaryTagLabels.map((tag) => <option key={tag} value={tag}>{markDietaryTag(tag)}</option>)}
        </Dropdown>
        <label className="checkbox-filter">
          <RoundCheck
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <T id="recipes.recipe-list.show-archived">Show archived</T>
        </label>
        <span className="result-count"><T id="recipes.recipe-list.recipes" values={{ dataCount: data.length }}>{"{dataCount} recipes"}</T></span>
      </FilterBar>
      </Block>
      <Block id="list" name="List" h={24}>
      {recipes.error ? (
        <ErrorText message={recipes.error} />
      ) : recipes.loading && !recipes.data ? (
        <LoadingSkeleton />
      ) : (
        <DataTable selection={{ rowId: (row) => row.id, ...deletable }} copyKey="recipes.recipe-list" exportName="recipes" openColumn
          data={data}
          columns={columns}
          onRow={(recipe) => setCard(recipe)}
          label={<T id="recipes.recipe-list.recipes-2">recipes</T>}
        />
      )}
      <p className="table-hint">
        <T id="recipes.recipe-list.click-a-cell-to-edit">{"Click a cell to edit it; ingredients, allergens and cost are edited on the recipe (cost is calculated). Drag, Shift+click or Ctrl/Cmd+click to select; Delete or Ctrl+Z."}</T>
      </p>
      </Block>
      </PageGrid>
      {card && <KitchenCard recipe={card} onClose={() => setCard(null)} />}
      {create && (
        <RecipeForm
          onClose={() => setCreate(false)}
          onSaved={(recipe) => navigate(`/recipes/${recipe.id}`)}
        />
      )}
    </>
  );
}
