import { useDeletable } from "../app/deletable";
import { Dropdown } from "../components/ui/Dropdown";
import { Allowed, usePermissions } from "../app/permissions";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { InventoryItem } from "../../shared/inventory";
import {
  dietaryTagHints,
  lineCostSourceLabels,
  type Recipe,
  type RecipeInput,
  type ScaledRecipe,
} from "../../shared/recipes";
import { listOptions } from "../../shared/settings";
import { unitLabel, unitSchema, type Unit } from "../../shared/units";
import { canSeeField } from "../../shared/visibility";
import { allPages, inventoryApi, recipesApi } from "../services/core";
import { useResource } from "../app/useResource";
import { useOpenFor } from "../app/useOpenFor";
import {
  Button,
  ConfirmationDialog,
  DataTable,
  DetailDrawer,
  FilterBar,
  FormField,
  LoadingSkeleton,
  PageHeader,
  SearchInput,
  Section,
} from "../components/shared";
import { LoadError } from "../components/record-display";
import { useBusinessSettings } from "../services/settings";
import { Attachments } from "./attachments";
import { centsLabel, quantityLabel } from "./inventory-labels";
import { useArchivedMarks, useListLabels } from "./list-fields";
import "./inventory.css";
import { RoundCheck } from "../components/ui/round-check";
import { Plural, T, useCopy, LabelT } from "../app/copy";
import { copySlug } from "../../shared/copy";

// Recipe book (FLOW-93): one record per dish, with its cost (FLOW-94), allergens
// and dietary tags (FLOW-95) and a scaling tool (FLOW-98). The API works costs out
// from the ingredients on every read; allergens and tags are set on the dish.
// Allergens, dietary tags and the category are saved as the labels of the settings
// lists (FLOW-218); a value archived since is shown marked.
const markedList = (values: string[], mark: (label: string) => string) =>
  values.map(mark).join(", ");
const uniqueLabels = (labels: string[]) => [...new Set(labels)];
const yieldLabel = (recipe: Recipe) =>
  recipe.yield
    ? `${Number(recipe.yield.servings)} servings${recipe.yield.portionSize && ` · ${recipe.yield.portionSize}`}`
    : "No yield";
const lineQuantity = (quantity: number | null, unit: Unit | null) =>
  quantity === null || !unit ? "As needed" : quantityLabel(quantity, unit);

function RecipeFlags({ recipe }: { recipe: Recipe }) {
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
  const recipes = useResource(
    ["recipes", { archived, category }],
    () => recipesApi.list({ archived, category: category || undefined }),
    { keepPrevious: true },
  );
  const deletable = useDeletable("recipe", () => recipes.reload());
  const data = (recipes.data ?? []).filter((recipe) =>
    [recipe.name, ...recipe.lines.map((line) => line.ingredientName)].some((name) => name.toLowerCase().includes(search.toLowerCase())) &&
    (!allergen || recipe.allergens.some((tag) => tag === allergen)) &&
    (!dietaryTag || recipe.dietaryTags.some((tag) => tag === dietaryTag)),
  );
  const { actor } = usePermissions();
  const costHidden = !actor || !canSeeField(actor, "internal_cost", { view: "internal_recipe" });
  const columns: ColumnDef<Recipe, unknown>[] = [
    { accessorKey: "name", header: "Dish" },
    {
      id: "category",
      header: "Category",
      accessorFn: (recipe) => markCategory(recipe.category),
    },
    { id: "yield", header: "Yield", accessorFn: yieldLabel },
    {
      id: "allergens",
      header: "Allergens",
      accessorFn: (recipe) => markedList(recipe.allergens, markAllergen) || "—",
    },
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
    {
      id: "flags",
      header: "Flags",
      cell: ({ row }) => <RecipeFlags recipe={row.original} />,
    },
  ];
  return (
    <>
      <PageHeader
        title={<T id="recipes.recipe-list.recipe-book">Recipe book</T>}
        subtitle={<T id="recipes.recipe-list.every-dish-with-its-ingredients">Every dish with its ingredients, method, cost and allergens.</T>}
        eyebrow={<T id="recipes.recipe-list.kitchen">Kitchen</T>}
      >
        <Button asChild variant="outline"><Link to="/recipes/client"><T id="recipes.recipe-list.client-recipe-book">Client recipe book</T></Link></Button>
        <Allowed action="recipes.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            <T id="recipes.recipe-list.new-recipe">New Recipe</T>
          </Button>
        </Allowed>
      </PageHeader>
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
          <option value="">All allergens</option>
          {allergenLabels.map((tag) => <option key={tag} value={tag}>{markAllergen(tag)}</option>)}
        </Dropdown>
        <Dropdown aria-label="Dietary tag" value={dietaryTag} onChange={(e) => setDietaryTag(e.target.value)}>
          <option value="">All dietary tags</option>
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
      {recipes.error ? (
        <LoadError message={recipes.error} />
      ) : recipes.loading && !recipes.data ? (
        <LoadingSkeleton />
      ) : (
        <DataTable selection={{ rowId: (row) => row.id, ...deletable }} copyKey="recipes.recipe-list"
          data={data}
          columns={columns}
          onRow={(recipe) => navigate(`/recipes/${recipe.id}`)}
          label={<T id="recipes.recipe-list.recipes-2">recipes</T>}
        />
      )}
      {create && (
        <RecipeForm
          onClose={() => setCreate(false)}
          onSaved={(recipe) => navigate(`/recipes/${recipe.id}`)}
        />
      )}
    </>
  );
}

type LineDraft = {
  key: string;
  id?: string;
  itemId: string;
  quantity: string;
  unit: Unit | "";
  prepNote: string;
  cost: string;
};
let nextKey = 0;
const newKey = () => `line-${nextKey++}`;
const dollars = (cents: number | null) =>
  cents === null ? "" : (cents / 100).toFixed(2);
const toCents = (value: string) =>
  value.trim() === "" ? null : Math.round(Number(value) * 100);

// Checkboxes for a settings list: the active values, plus any the dish already has
// that were archived since (marked, so saving never drops them).
function TagChoices({
  label,
  options,
  hints,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; archived: boolean }[];
  hints?: Readonly<Record<string, string>>;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const hinted = options.filter((option) => hints?.[option.label]);
  return (
    <fieldset className="form-group" aria-label={label}>
      <legend>
        <T id={`recipes.tag-choices.${copySlug(label)}`}>{label}</T>
      </legend>
      {options.map((option) => (
        <label className="checkbox-filter" key={option.label}>
          <RoundCheck
            checked={value.includes(option.label)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, option.label]
                  : value.filter((other) => other !== option.label),
              )
            }
          />
          {option.archived ? <T id="recipes.tag-choices.archived" values={{ label: option.label }}>{"{label} (archived)"}</T> : option.label}
        </label>
      ))}
      {hints && hinted.length > 0 && (
        <ul className="muted">
          {hinted.map((option) => (
            <li key={option.label}>
              <small>
                {option.label}: {hints[option.label]}
              </small>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

export function RecipeForm({
  recipe,
  onClose,
  onSaved,
}: {
  recipe?: Recipe;
  onClose: () => void;
  onSaved: (recipe: Recipe) => void;
}) {
  const { actor } = usePermissions();
  // Entered line costs are FT+ only; a form that can't see them leaves them alone.
  const showCost = recipe
    ? !recipe.costHidden
    : actor !== null && canSeeField(actor, "internal_cost", { view: "internal_recipe" });
  const [name, setName] = useState(recipe?.name ?? "");
  const settings = useBusinessSettings();
  const activeCategories = listOptions(settings.lists.recipe_category).map(
    (option) => option.label,
  );
  const [category, setCategory] = useState(
    recipe?.category ??
      (activeCategories.includes("Mains") ? "Mains" : (activeCategories[0] ?? "")),
  );
  const [description, setDescription] = useState(recipe?.description ?? "");
  const [servings, setServings] = useState(
    recipe?.yield ? String(recipe.yield.servings) : "",
  );
  const [portionSize, setPortionSize] = useState(
    recipe?.yield?.portionSize ?? "",
  );
  const [lines, setLines] = useState<LineDraft[]>(
    (recipe?.lines ?? []).map((line) => ({
      key: newKey(),
      id: line.id,
      itemId: line.itemId,
      quantity: line.quantity === null ? "" : String(line.quantity),
      unit: line.unit ?? "",
      prepNote: line.prepNote,
      cost: dollars(line.enteredCostCents),
    })),
  );
  const [steps, setSteps] = useState((recipe?.steps ?? []).join("\n"));
  const [finishingNote, setFinishingNote] = useState(
    recipe?.finishingNote ?? "",
  );
  const [allergens, setAllergens] = useState<string[]>(
    recipe?.allergens ?? [],
  );
  const [dietaryTags, setDietaryTags] = useState<string[]>(
    recipe?.dietaryTags ?? [],
  );
  const [active, setActive] = useState(recipe?.active ?? true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  // Every ingredient, whatever the page size (FLOW-179): the picker must be
  // complete.
  const ingredients = useResource(
    ["inventory-items", "consumables", "all"],
    () =>
      allPages((cursor) =>
        inventoryApi.list({ kind: "consumable" }, cursor),
      ),
    { reference: true },
  );
  const catalog = ingredients.data ?? [];
  // Archived ingredients already on a line stay pickable for that line.
  const options = [
    ...catalog.map((item) => ({ id: item.id, name: item.name })),
    ...(recipe?.lines ?? [])
      .filter((line) => !catalog.some((item) => item.id === line.itemId))
      .map((line) => ({
        id: line.itemId,
        name: `${line.ingredientName} (archived)`,
      })),
  ].filter(
    (option, index, all) => all.findIndex((o) => o.id === option.id) === index,
  );
  const update = (key: string, change: Partial<LineDraft>) =>
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...change } : line)),
    );
  const pickIngredient = (line: LineDraft, item: InventoryItem | undefined) =>
    update(line.key, {
      itemId: item?.id ?? "",
      unit: line.unit || (item?.consumable?.recipeUnit ?? item?.unit ?? ""),
    });
  const save = async () => {
    if (!name.trim()) return setError("Name is required.");
    if (lines.some((line) => !line.itemId))
      return setError("Pick an ingredient for every line.");
    if (lines.some((line) => line.quantity.trim() && !line.unit))
      return setError("Pick a unit for every quantity.");
    const servingsValue = Number(servings);
    if (servings.trim() && !(servingsValue > 0))
      return setError("Enter servings above zero.");
    const input: RecipeInput = {
      name,
      category,
      description,
      lines: lines.map((line) => ({
        id: line.id,
        itemId: line.itemId,
        quantity: line.quantity.trim() ? Number(line.quantity) : null,
        unit: line.quantity.trim() && line.unit ? line.unit : null,
        prepNote: line.prepNote,
        ...(showCost && { enteredCostCents: toCents(line.cost) }),
      })),
      steps: steps
        .split("\n")
        .map((step) => step.replace(/^\s*\d+[.)]\s*/, "").trim())
        .filter(Boolean),
      finishingNote,
      yield: servings.trim()
        ? { servings: servingsValue, portionSize }
        : null,
      allergens,
      dietaryTags,
      active,
    };
    setSaving(true);
    setError("");
    try {
      onSaved(
        recipe
          ? await recipesApi.update(recipe.id, input)
          : await recipesApi.create(input),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={recipe ? <T id="recipes.recipe-form.edit-recipe">Edit recipe</T> : <T id="recipes.recipe-form.new-recipe">New recipe</T>}
      description={<T id="recipes.recipe-form.saved-to-flowbase">Saved to Flowbase.</T>}
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && (
          <p role="alert" className="error-message">
            {error}
          </p>
        )}
        <FormField label={<T id="recipes.recipe-form.name">Name *</T>}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField label={<T id="recipes.recipe-form.category">Category</T>}>
          <Dropdown
            aria-label="Category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {listOptions(settings.lists.recipe_category, category).map((option) => (
              <option key={option.label} value={option.label}>
                {option.archived ? `${option.label} (archived)` : option.label}
              </option>
            ))}
          </Dropdown>
        </FormField>
        <FormField label={<T id="recipes.recipe-form.description">Description</T>}>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
        <div className="form-grid">
          <FormField
            label={<T id="recipes.recipe-form.yield-servings">Yield (servings)</T>}
            hint={<T id="recipes.recipe-form.leave-empty-if-unknown-the">{"Leave empty if unknown; the dish can't be scaled without it"}</T>}
          >
            <input
              type="number"
              min="0"
              step="any"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
            />
          </FormField>
          <FormField label={<T id="recipes.recipe-form.portion-size">Portion size</T>} hint={<T id="recipes.recipe-form.e-g-6-oz">e.g. 6 oz</T>}>
            <input
              value={portionSize}
              onChange={(e) => setPortionSize(e.target.value)}
            />
          </FormField>
        </div>
        <h3 className="form-subheading"><T id="recipes.recipe-form.ingredients">Ingredients</T></h3>
        {lines.map((line, index) => (
          <fieldset
            className="form-group"
            key={line.key}
            aria-label={`Ingredient line ${index + 1}`}
          >
            <div className="form-grid">
              <FormField label={<T id="recipes.recipe-form.ingredient" values={{ value: index + 1 }}>{"Ingredient {value}"}</T>}>
                <Dropdown
                  value={line.itemId}
                  onChange={(e) =>
                    pickIngredient(
                      line,
                      catalog.find((item) => item.id === e.target.value),
                    )
                  }
                >
                  <option value="">Choose an ingredient</option>
                  {options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </Dropdown>
              </FormField>
              <FormField label={<T id="recipes.recipe-form.quantity">Quantity</T>} hint={<T id="recipes.recipe-form.empty-for-as-needed">Empty for “as needed”</T>}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={line.quantity}
                  onChange={(e) =>
                    update(line.key, { quantity: e.target.value })
                  }
                />
              </FormField>
              <FormField label={<T id="recipes.recipe-form.unit">Unit</T>}>
                <Dropdown
                  value={line.unit}
                  onChange={(e) =>
                    update(line.key, { unit: e.target.value as Unit | "" })
                  }
                >
                  <option value="">—</option>
                  {unitSchema.options.map((unit) => (
                    <option key={unit} value={unit}>
                      {unitLabel(unit)}
                    </option>
                  ))}
                </Dropdown>
              </FormField>
              <FormField label={<T id="recipes.recipe-form.prep-note">Prep note</T>}>
                <input
                  value={line.prepNote}
                  onChange={(e) =>
                    update(line.key, { prepNote: e.target.value })
                  }
                />
              </FormField>
              {showCost && (
                <FormField
                  label={<T id="recipes.recipe-form.entered-cost">Entered cost ($)</T>}
                  hint={<T id="recipes.recipe-form.used-until-the-ingredient-has">Used until the ingredient has a unit cost</T>}
                >
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={line.cost}
                    onChange={(e) => update(line.key, { cost: e.target.value })}
                  />
                </FormField>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                setLines((current) =>
                  current.filter((other) => other.key !== line.key),
                )
              }
            >
              <T id="recipes.recipe-form.remove-ingredient">Remove ingredient</T>
            </Button>
          </fieldset>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setLines((current) => [
              ...current,
              {
                key: newKey(),
                itemId: "",
                quantity: "",
                unit: "",
                prepNote: "",
                cost: "",
              },
            ])
          }
        >
          <Plus size={14} /><T id="recipes.recipe-form.add-ingredient">{" Add ingredient"}</T>
        </Button>
        <h3 className="form-subheading"><T id="recipes.recipe-form.method">Method</T></h3>
        <FormField label={<T id="recipes.recipe-form.steps">Steps</T>} hint={<T id="recipes.recipe-form.one-step-per-line-in">One step per line, in order</T>}>
          <textarea
            rows={5}
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
          />
        </FormField>
        <FormField label={<T id="recipes.recipe-form.finishing-note">Finishing note</T>} hint={<T id="recipes.recipe-form.e-g-garnish-with-microgreens">e.g. garnish with microgreens</T>}>
          <input
            value={finishingNote}
            onChange={(e) => setFinishingNote(e.target.value)}
          />
        </FormField>
        <h3 className="form-subheading"><T id="recipes.recipe-form.allergens-and-dietary-tags">Allergens and dietary tags</T></h3>
        <TagChoices
          label="Allergens"
          options={listOptions(settings.lists.allergen, allergens)}
          value={allergens}
          onChange={setAllergens}
        />
        <TagChoices
          label="Dietary tags"
          options={listOptions(settings.lists.dietary_tag, dietaryTags)}
          hints={dietaryTagHints}
          value={dietaryTags}
          onChange={setDietaryTags}
        />
        <label className="checkbox-filter">
          <RoundCheck
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <T id="recipes.recipe-form.active">Active</T>
        </label>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            <T id="recipes.recipe-form.cancel">Cancel</T>
          </Button>
          <Button type="submit" disabled={saving}>
            <T id="recipes.recipe-form.save-recipe">Save recipe</T>
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const mark = useArchivedMarks("recipe_category");
  return <span className="badge neutral">{mark(category)}</span>;
}

function TagsSection({ recipe }: { recipe: Recipe }) {
  const markAllergen = useArchivedMarks("allergen");
  const markDietaryTag = useArchivedMarks("dietary_tag");
  return (
    <Section title={<T id="recipes.tags-section.allergens-and-dietary-tags">Allergens and dietary tags</T>}>
      <small><T id="recipes.tags-section.allergens">Allergens</T></small>
      <p>{markedList(recipe.allergens, markAllergen) || <T id="recipes.tags-section.none">None</T>}</p>
      <small><T id="recipes.tags-section.dietary-tags">Dietary tags</T></small>
      <p>{markedList(recipe.dietaryTags, markDietaryTag) || <T id="recipes.tags-section.none">None</T>}</p>
    </Section>
  );
}

function IngredientsSection({ recipe }: { recipe: Recipe }) {
  return (
    <Section title={<T id="recipes.ingredients-section.ingredients">Ingredients</T>}>
      {recipe.lines.length ? (
        <table className="stock-table">
          <thead>
            <tr>
              <th><T id="recipes.ingredients-section.ingredient">Ingredient</T></th>
              <th><T id="recipes.ingredients-section.quantity">Quantity</T></th>
              <th><T id="recipes.ingredients-section.prep">Prep</T></th>
              {!recipe.costHidden && (
                <>
                  <th><T id="recipes.ingredients-section.cost">Cost</T></th>
                  <th><T id="recipes.ingredients-section.source">Source</T></th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {recipe.lines.map((line) => (
              <tr key={line.id}>
                <td>
                  <Link to={`/inventory/${line.itemId}`}>
                    {line.ingredientName}
                  </Link>
                  {line.ingredientArchived && <T id="recipes.ingredients-section.archived">{" (archived)"}</T>}
                </td>
                <td>{lineQuantity(line.quantity, line.unit)}</td>
                <td>{line.prepNote || "—"}</td>
                {line.cost && (
                  <>
                    <td>{centsLabel(line.cost.cents)}</td>
                    <td>
                      <span
                        className={`badge ${line.cost.source === "none" ? "warning" : line.cost.source === "entered" ? "neutral" : "success"}`}
                        title={line.cost.problem ?? undefined}
                      >
                        <LabelT id="labels.line-cost-source" value={line.cost.source}>{lineCostSourceLabels[line.cost.source]}</LabelT>
                      </span>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
          {recipe.cost && (
            <tfoot>
              <tr>
                <th colSpan={3}><T id="recipes.ingredients-section.batch-cost">Batch cost</T></th>
                <th colSpan={2}>{centsLabel(recipe.cost.batchCents)}</th>
              </tr>
              <tr>
                <th colSpan={3}><T id="recipes.ingredients-section.per-serving">Per serving</T></th>
                <th colSpan={2}>
                  {recipe.cost.perServingCents === null
                    ? <T id="recipes.ingredients-section.needs-a-yield">Needs a yield</T>
                    : centsLabel(recipe.cost.perServingCents)}
                </th>
              </tr>
            </tfoot>
          )}
        </table>
      ) : (
        <p className="muted"><T id="recipes.ingredients-section.no-ingredients-yet">No ingredients yet.</T></p>
      )}
      {recipe.cost && recipe.cost.noCostLines > 0 && (
        <p className="muted">
          <Plural id="recipes.ingredients-section.lines-have-no-cost-and" count={recipe.cost.noCostLines} one="{count} line has no cost and count as $0." other="{count} lines have no cost and count as $0." />
        </p>
      )}
      {recipe.costHidden && (
        <p className="muted"><T id="recipes.ingredients-section.costs-are-visible-to-full">Costs are visible to full-time staff only.</T></p>
      )}
    </Section>
  );
}

function ScaleSection({ recipe, requestedServings }: { recipe: Recipe; requestedServings: number | null }) {
  const [servings, setServings] = useState(
    requestedServings !== null ? String(requestedServings) : recipe.yield ? String(recipe.yield.servings) : "",
  );
  const [result, setResult] = useState<ScaledRecipe | null>(null);
  const [error, setError] = useState("");
  const scale = async () => {
    setError("");
    try {
      setResult(await recipesApi.scale(recipe.id, Number(servings)));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    if (requestedServings === null) return;
    void recipesApi.scale(recipe.id, requestedServings).then(setResult, (cause: Error) => setError(cause.message));
  }, [recipe.id, requestedServings]);
  return (
    <section id="scale"><Section title={<T id="recipes.scale-section.scale">Scale</T>}>
      <form
        className="inline-row"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void scale();
        }}
      >
        <FormField label={<T id="recipes.scale-section.servings">Servings</T>}>
          <input
            type="number"
            min="1"
            step="any"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
          />
        </FormField>
        <Button type="submit" variant="outline">
          <T id="recipes.scale-section.scale">Scale</T>
        </Button>
      </form>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {result && !result.ok && (
        <p role="status" className="error-message">
          <AlertTriangle size={14} /> {result.message}
        </p>
      )}
      {result?.ok && (
        <table className="stock-table" aria-label="Scaled ingredients">
          <thead>
            <tr>
              <th><T id="recipes.scale-section.ingredient">Ingredient</T></th>
              <th><T id="recipes.scale-section.quantity">Quantity</T></th>
              <th><T id="recipes.scale-section.purchase-units">Purchase units</T></th>
            </tr>
          </thead>
          <tbody>
            {result.lines.map((line, index) => (
              <tr key={line.lineId ?? index}>
                <td>{line.ingredientName}</td>
                <td>{lineQuantity(line.quantity, line.unit)}</td>
                <td>
                  {line.asNeeded
                    ? "—"
                    : line.purchaseQuantity !== null && line.purchaseUnit
                      ? quantityLabel(line.purchaseQuantity, line.purchaseUnit)
                      : (line.problem ?? "—")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section></section>
  );
}

export function RecipeDetail() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const requested = Number(searchParams.get("servings"));
  const requestedServings = Number.isFinite(requested) && requested > 0 && searchParams.has("servings") ? requested : null;
  const navigate = useNavigate();
  const recipe = useResource(["recipes", id], () => recipesApi.get(id));
  // Dialogs belong to the recipe they were opened on (FLOW-197).
  const [edit, setEdit] = useOpenFor(id);
  const [archive, setArchive] = useOpenFor(id);
  const back = (
    <Link to="/recipes" className="back-link">
      <T id="recipes.recipe-detail.recipe-book">← Recipe book</T>
    </Link>
  );
  if (recipe.error)
    return (
      <>
        {back}
        <LoadError message={recipe.error} />
      </>
    );
  const r = recipe.data;
  if (!r) return <LoadingSkeleton />;
  return (
    <>
      {back}
      <div className="record-heading">
        <div>
          <h1>{r.name}</h1>
          <p>
            <CategoryBadge category={r.category} />
            {r.archivedAt && <span className="badge error"><T id="recipes.recipe-detail.archived">Archived</T></span>}
            <RecipeFlags recipe={r} />
            <span>{yieldLabel(r)}</span>
          </p>
        </div>
        <div className="page-actions">
          <Button asChild variant="outline"><Link to={`/print/recipes/${r.id}`}><T id="recipes.recipe-detail.kitchen-card">Kitchen card</T></Link></Button>
          <Allowed action="recipes.write">
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={14} />
              <T id="recipes.recipe-detail.edit">Edit</T>
            </Button>
            {r.archivedAt ? (
              <Button
                variant="outline"
                onClick={async () =>
                  recipe.replace(await recipesApi.setArchived(r.id, false))
                }
              >
                <RotateCcw size={14} />
                <T id="recipes.recipe-detail.restore">Restore</T>
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setArchive(true)}>
                <Archive size={14} />
                <T id="recipes.recipe-detail.archive">Archive</T>
              </Button>
            )}
          </Allowed>
        </div>
      </div>
      {r.duplicates.length > 0 && (
        <p role="status" className="error-message">
          <AlertTriangle size={14} /><T id="recipes.recipe-detail.another-dish-in-this-category">{" Another dish in this category has the same name: "}</T>
          {r.duplicates.map((other, index) => (
            <span key={other.id}>
              {index > 0 && ", "}
              <Link to={`/recipes/${other.id}`}>{other.name}</Link>
            </span>
          ))}
        </p>
      )}
      <div className="detail-grid">
        <Section title={<T id="recipes.recipe-detail.dish">Dish</T>}>
          <small><T id="recipes.recipe-detail.description">Description</T></small>
          <p>{r.description || "—"}</p>
          <small><T id="recipes.recipe-detail.yield">Yield</T></small>
          <p>{r.yield ? <T id="recipes.recipe-detail.servings" values={{ Number: Number(r.yield.servings) }}>{"{Number} servings"}</T> : <T id="recipes.recipe-detail.not-set">Not set</T>}</p>
          <small><T id="recipes.recipe-detail.portion-size">Portion size</T></small>
          <p>{r.yield?.portionSize || "—"}</p>
        </Section>
        <TagsSection recipe={r} />
      </div>
      <IngredientsSection recipe={r} />
      <Section title={<T id="recipes.recipe-detail.method">Method</T>}>
        {r.steps.length ? (
          <ol>
            {r.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="muted"><T id="recipes.recipe-detail.no-method-yet">No method yet.</T></p>
        )}
        {r.finishingNote && (
          <p>
            <strong><T id="recipes.recipe-detail.finish">Finish:</T></strong> {r.finishingNote}
          </p>
        )}
      </Section>
      <ScaleSection key={`${r.updatedAt}:${requestedServings ?? ""}`} recipe={r} requestedServings={requestedServings} />
      <Attachments recordType="recipe" recordId={r.id} title="Photos" />
      {edit && (
        <RecipeForm
          recipe={r}
          onClose={() => setEdit(false)}
          onSaved={recipe.replace}
        />
      )}
      <ConfirmationDialog
        open={archive}
        onClose={() => setArchive(false)}
        title={<T id="recipes.recipe-detail.archive-this-recipe">Archive this recipe?</T>}
        onConfirm={async () => {
          await recipesApi.setArchived(r.id, true);
          setArchive(false);
          navigate("/recipes");
        }}
      >
        <T id="recipes.recipe-detail.will-be-hidden-from-the" values={{ name: r.name }}>{"{name} will be hidden from the recipe book."}</T>
      </ConfirmationDialog>
    </>
  );
}

