import { Dropdown } from "../../components/ui/Dropdown";
import { usePermissions } from "../../app/permissions";
import { useState } from "react";
import { Plus } from "lucide-react";
import { type InventoryItem } from "../../../shared/inventory";
import { dietaryTagHints, type Recipe, type RecipeInput } from "../../../shared/recipes";
import { listOptions } from "../../../shared/settings";
import { unitLabel, unitSchema, type Unit } from "../../../shared/units";
import { canSeeField } from "../../../shared/visibility";
import { allPages, inventoryApi, recipesApi } from "../../services/core";
import { useResource } from "../../app/useResource";
import { queryClient } from "../../app/queryClient";
import { Button, DetailDrawer, FormField, ErrorText } from "../../components/shared";
import { useBusinessSettings } from "../../services/settings";
import { RoundCheck } from "../../components/ui/round-check";
import { T } from "../../app/copy";
import { copySlug } from "../../../shared/copy";
import "../inventory/inventory.css";

// The recipe create/edit form (FLOW-93): ingredients, steps, yield, allergens and
// dietary tags.

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
      const saved = recipe
        ? await recipesApi.update(recipe.id, input)
        : await recipesApi.create(input);
      void queryClient.invalidateQueries({ queryKey: ["recipes"] });
      onSaved(saved);
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
        <ErrorText message={error} />
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
