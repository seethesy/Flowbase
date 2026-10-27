import { Allowed, usePermissions } from "../app/permissions";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertTriangle, Archive, Pencil, Plus, RotateCcw } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  allergenLabels,
  allergenSchema,
  type Allergen,
  type InventoryItem,
} from "../../shared/inventory";
import {
  dietaryTagHints,
  dietaryTagLabels,
  dietaryTagSchema,
  lineCostSourceLabels,
  recipeCategoryLabels,
  recipeCategorySchema,
  type DietaryTag,
  type Recipe,
  type RecipeCategory,
  type RecipeInput,
  type ScaledRecipe,
} from "../../shared/recipes";
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
import { Attachments } from "./attachments";
import { centsLabel, quantityLabel } from "./inventory-labels";
import "./inventory.css";

// Recipe book (FLOW-93): one record per dish, with its cost (FLOW-94), allergens
// and dietary tags (FLOW-95) and a scaling tool (FLOW-98). The API works costs out
// from the ingredients on every read; allergens and tags are set on the dish.
const allergenList = (allergens: Allergen[]) =>
  allergens.map((allergen) => allergenLabels[allergen]).join(", ");
const dietaryList = (tags: DietaryTag[]) =>
  tags.map((tag) => dietaryTagLabels[tag]).join(", ");
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
        <span className="badge warning">Duplicate name</span>
      )}
      {!recipe.yield && <span className="badge neutral">No yield</span>}
      {!recipe.active && <span className="badge error">Inactive</span>}
    </>
  );
}

export function RecipeList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<RecipeCategory | "">("");
  const [archived, setArchived] = useState(false);
  const [allergen, setAllergen] = useState("");
  const [dietaryTag, setDietaryTag] = useState("");
  const [create, setCreate] = useState(false);
  const recipes = useResource(
    ["recipes", { archived, category }],
    () => recipesApi.list({ archived, category: category || undefined }),
    { keepPrevious: true },
  );
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
      accessorFn: (recipe) => recipeCategoryLabels[recipe.category],
    },
    { id: "yield", header: "Yield", accessorFn: yieldLabel },
    {
      id: "allergens",
      header: "Allergens",
      accessorFn: (recipe) => allergenList(recipe.allergens) || "—",
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
        title="Recipe book"
        subtitle="Every dish with its ingredients, method, cost and allergens."
        eyebrow="Kitchen"
      >
        <Button asChild variant="outline"><Link to="/recipes/client">Client recipe book</Link></Button>
        <Allowed action="recipes.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            New Recipe
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search recipes…"
        />
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value as RecipeCategory | "")}
        >
          <option value="">All categories</option>
          {recipeCategorySchema.options.map((option) => (
            <option key={option} value={option}>
              {recipeCategoryLabels[option]}
            </option>
          ))}
        </select>
        <select aria-label="Allergen" value={allergen} onChange={(e) => setAllergen(e.target.value)}>
          <option value="">All allergens</option>
          {allergenSchema.options.map((tag) => <option key={tag} value={tag}>{allergenLabels[tag]}</option>)}
        </select>
        <select aria-label="Dietary tag" value={dietaryTag} onChange={(e) => setDietaryTag(e.target.value)}>
          <option value="">All dietary tags</option>
          {dietaryTagSchema.options.map((tag) => <option key={tag} value={tag}>{dietaryTagLabels[tag]}</option>)}
        </select>
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
        <span className="result-count">{data.length} recipes</span>
      </FilterBar>
      {recipes.error ? (
        <LoadError message={recipes.error} />
      ) : recipes.loading && !recipes.data ? (
        <LoadingSkeleton />
      ) : (
        <DataTable
          data={data}
          columns={columns}
          onRow={(recipe) => navigate(`/recipes/${recipe.id}`)}
          label="recipes"
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

function TagChoices<T extends string>({
  label,
  options,
  labels,
  hints,
  value,
  onChange,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  hints?: Record<T, string>;
  value: T[];
  onChange: (value: T[]) => void;
}) {
  return (
    <fieldset className="form-group" aria-label={label}>
      <legend>{label}</legend>
      {options.map((option) => (
        <label className="checkbox-filter" key={option}>
          <input
            type="checkbox"
            checked={value.includes(option)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, option]
                  : value.filter((other) => other !== option),
              )
            }
          />
          {labels[option]}
        </label>
      ))}
      {hints && (
        <ul className="muted">
          {options.map((option) => (
            <li key={option}>
              <small>
                {labels[option]}: {hints[option]}
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
  const [category, setCategory] = useState<RecipeCategory>(
    recipe?.category ?? "mains",
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
  const [allergens, setAllergens] = useState<Allergen[]>(
    recipe?.allergens ?? [],
  );
  const [dietaryTags, setDietaryTags] = useState<DietaryTag[]>(
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
      title={recipe ? "Edit recipe" : "New recipe"}
      description="Saved to Flowbase."
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
        <FormField label="Name *">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </FormField>
        <FormField label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value as RecipeCategory)}
          >
            {recipeCategorySchema.options.map((option) => (
              <option key={option} value={option}>
                {recipeCategoryLabels[option]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Description">
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormField>
        <div className="form-grid">
          <FormField
            label="Yield (servings)"
            hint="Leave empty if unknown; the dish can't be scaled without it"
          >
            <input
              type="number"
              min="0"
              step="any"
              value={servings}
              onChange={(e) => setServings(e.target.value)}
            />
          </FormField>
          <FormField label="Portion size" hint="e.g. 6 oz">
            <input
              value={portionSize}
              onChange={(e) => setPortionSize(e.target.value)}
            />
          </FormField>
        </div>
        <h3 className="form-subheading">Ingredients</h3>
        {lines.map((line, index) => (
          <fieldset
            className="form-group"
            key={line.key}
            aria-label={`Ingredient line ${index + 1}`}
          >
            <div className="form-grid">
              <FormField label={`Ingredient ${index + 1}`}>
                <select
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
                </select>
              </FormField>
              <FormField label="Quantity" hint="Empty for “as needed”">
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
              <FormField label="Unit">
                <select
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
                </select>
              </FormField>
              <FormField label="Prep note">
                <input
                  value={line.prepNote}
                  onChange={(e) =>
                    update(line.key, { prepNote: e.target.value })
                  }
                />
              </FormField>
              {showCost && (
                <FormField
                  label="Entered cost ($)"
                  hint="Used until the ingredient has a unit cost"
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
              Remove ingredient
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
          <Plus size={14} /> Add ingredient
        </Button>
        <h3 className="form-subheading">Method</h3>
        <FormField label="Steps" hint="One step per line, in order">
          <textarea
            rows={5}
            value={steps}
            onChange={(e) => setSteps(e.target.value)}
          />
        </FormField>
        <FormField label="Finishing note" hint="e.g. garnish with microgreens">
          <input
            value={finishingNote}
            onChange={(e) => setFinishingNote(e.target.value)}
          />
        </FormField>
        <h3 className="form-subheading">Allergens and dietary tags</h3>
        <TagChoices
          label="Allergens"
          options={allergenSchema.options}
          labels={allergenLabels}
          value={allergens}
          onChange={setAllergens}
        />
        <TagChoices
          label="Dietary tags"
          options={dietaryTagSchema.options}
          labels={dietaryTagLabels}
          hints={dietaryTagHints}
          value={dietaryTags}
          onChange={setDietaryTags}
        />
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active
        </label>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Save recipe
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

function TagsSection({ recipe }: { recipe: Recipe }) {
  return (
    <Section title="Allergens and dietary tags">
      <small>Allergens</small>
      <p>{allergenList(recipe.allergens) || "None"}</p>
      <small>Dietary tags</small>
      <p>{dietaryList(recipe.dietaryTags) || "None"}</p>
    </Section>
  );
}

function IngredientsSection({ recipe }: { recipe: Recipe }) {
  return (
    <Section title="Ingredients">
      {recipe.lines.length ? (
        <table className="stock-table">
          <thead>
            <tr>
              <th>Ingredient</th>
              <th>Quantity</th>
              <th>Prep</th>
              {!recipe.costHidden && (
                <>
                  <th>Cost</th>
                  <th>Source</th>
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
                  {line.ingredientArchived && " (archived)"}
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
                        {lineCostSourceLabels[line.cost.source]}
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
                <th colSpan={3}>Batch cost</th>
                <th colSpan={2}>{centsLabel(recipe.cost.batchCents)}</th>
              </tr>
              <tr>
                <th colSpan={3}>Per serving</th>
                <th colSpan={2}>
                  {recipe.cost.perServingCents === null
                    ? "Needs a yield"
                    : centsLabel(recipe.cost.perServingCents)}
                </th>
              </tr>
            </tfoot>
          )}
        </table>
      ) : (
        <p className="muted">No ingredients yet.</p>
      )}
      {recipe.cost && recipe.cost.noCostLines > 0 && (
        <p className="muted">
          {recipe.cost.noCostLines} line
          {recipe.cost.noCostLines === 1 ? " has" : "s have"} no cost and
          count as $0.
        </p>
      )}
      {recipe.costHidden && (
        <p className="muted">Costs are visible to full-time staff only.</p>
      )}
    </Section>
  );
}

function ScaleSection({ recipe }: { recipe: Recipe }) {
  const [servings, setServings] = useState(
    recipe.yield ? String(recipe.yield.servings) : "",
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
  return (
    <Section title="Scale">
      <form
        className="inline-row"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void scale();
        }}
      >
        <FormField label="Servings">
          <input
            type="number"
            min="1"
            step="any"
            value={servings}
            onChange={(e) => setServings(e.target.value)}
          />
        </FormField>
        <Button type="submit" variant="outline">
          Scale
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
              <th>Ingredient</th>
              <th>Quantity</th>
              <th>Purchase units</th>
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
    </Section>
  );
}

export function RecipeDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const recipe = useResource(["recipes", id], () => recipesApi.get(id));
  // Dialogs belong to the recipe they were opened on (FLOW-197).
  const [edit, setEdit] = useOpenFor(id);
  const [archive, setArchive] = useOpenFor(id);
  const back = (
    <Link to="/recipes" className="back-link">
      ← Recipe book
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
            <span className="badge neutral">
              {recipeCategoryLabels[r.category]}
            </span>
            {r.archivedAt && <span className="badge error">Archived</span>}
            <RecipeFlags recipe={r} />
            <span>{yieldLabel(r)}</span>
          </p>
        </div>
        <div className="page-actions">
          <Button asChild variant="outline"><Link to={`/print/recipes/${r.id}`}>Kitchen card</Link></Button>
          <Allowed action="recipes.write">
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={14} />
              Edit
            </Button>
            {r.archivedAt ? (
              <Button
                variant="outline"
                onClick={async () =>
                  recipe.replace(await recipesApi.setArchived(r.id, false))
                }
              >
                <RotateCcw size={14} />
                Restore
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setArchive(true)}>
                <Archive size={14} />
                Archive
              </Button>
            )}
          </Allowed>
        </div>
      </div>
      {r.duplicates.length > 0 && (
        <p role="status" className="error-message">
          <AlertTriangle size={14} /> Another dish in this category has the
          same name:{" "}
          {r.duplicates.map((other, index) => (
            <span key={other.id}>
              {index > 0 && ", "}
              <Link to={`/recipes/${other.id}`}>{other.name}</Link>
            </span>
          ))}
        </p>
      )}
      <div className="detail-grid">
        <Section title="Dish">
          <small>Description</small>
          <p>{r.description || "—"}</p>
          <small>Yield</small>
          <p>{r.yield ? `${Number(r.yield.servings)} servings` : "Not set"}</p>
          <small>Portion size</small>
          <p>{r.yield?.portionSize || "—"}</p>
        </Section>
        <TagsSection recipe={r} />
      </div>
      <IngredientsSection recipe={r} />
      <Section title="Method">
        {r.steps.length ? (
          <ol>
            {r.steps.map((step, index) => (
              <li key={index}>{step}</li>
            ))}
          </ol>
        ) : (
          <p className="muted">No method yet.</p>
        )}
        {r.finishingNote && (
          <p>
            <strong>Finish:</strong> {r.finishingNote}
          </p>
        )}
      </Section>
      <ScaleSection key={r.updatedAt} recipe={r} />
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
        title="Archive this recipe?"
        onConfirm={async () => {
          await recipesApi.setArchived(r.id, true);
          setArchive(false);
          navigate("/recipes");
        }}
      >
        {r.name} will be hidden from the recipe book.
      </ConfirmationDialog>
    </>
  );
}

