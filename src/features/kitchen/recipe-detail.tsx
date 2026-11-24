import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { Allowed } from "../../app/permissions";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { AlertTriangle, Archive, Pencil, RotateCcw } from "lucide-react";
import { lineCostSourceLabels, type Recipe, type ScaledRecipe } from "../../../shared/recipes";
import { recipesApi } from "../../services/core";
import { useResource } from "../../app/useResource";
import { queryClient } from "../../app/queryClient";
import { useOpenFor } from "../../app/useOpenFor";
import { Button, ConfirmationDialog, FormField, LoadingSkeleton, Section } from "../../components/shared";
import { LoadError } from "../../components/record-display";
import { Attachments } from "../common/attachments";
import { centsLabel, quantityLabel } from "../inventory/inventory-labels";
import { useArchivedMarks } from "../common/list-fields";
import { Plural, T, LabelT } from "../../app/copy";
import { RecipeFlags, lineQuantity, markedList, yieldLabel } from "./recipe-list";
import { RecipeForm } from "./recipe-form";
import "../inventory/inventory.css";

// A recipe's page in the recipe book (FLOW-93): one record per dish, with its cost
// (FLOW-94), allergens and dietary tags (FLOW-95) and a scaling tool (FLOW-98). The
// API works costs out from the ingredients on every read; allergens and tags are
// set on the dish. The list is in recipe-list.tsx and the form in recipe-form.tsx.

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
                onClick={async () => {
                  recipe.replace(await recipesApi.setArchived(r.id, false));
                  void queryClient.invalidateQueries({ queryKey: ["recipes"] });
                }}
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
      <PageGrid pageKey="recipes.detail">
      <Block id="dish" name="Dish" w={6} h={10}>
        <Section title={<T id="recipes.recipe-detail.dish">Dish</T>}>
          <small><T id="recipes.recipe-detail.description">Description</T></small>
          <p>{r.description || "—"}</p>
          <small><T id="recipes.recipe-detail.yield">Yield</T></small>
          <p>{r.yield ? <T id="recipes.recipe-detail.servings" values={{ Number: Number(r.yield.servings) }}>{"{Number} servings"}</T> : <T id="recipes.recipe-detail.not-set">Not set</T>}</p>
          <small><T id="recipes.recipe-detail.portion-size">Portion size</T></small>
          <p>{r.yield?.portionSize || "—"}</p>
        </Section>
      </Block>
      <Block id="tags" name="Allergens and dietary tags" w={6} h={10}><TagsSection recipe={r} /></Block>
      <Block id="ingredients" name="Ingredients" h={16}><IngredientsSection recipe={r} /></Block>
      <Block id="method" name="Method" h={12}>
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
      </Block>
      <Block id="scale" name="Scale" h={12}>
      <ScaleSection key={`${r.updatedAt}:${requestedServings ?? ""}`} recipe={r} requestedServings={requestedServings} />
      </Block>
      <Block id="photos" name="Photos" h={8}><Attachments recordType="recipe" recordId={r.id} title="Photos" /></Block>
      </PageGrid>
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
          void queryClient.invalidateQueries({ queryKey: ["recipes"] });
          setArchive(false);
          navigate("/recipes");
        }}
      >
        <T id="recipes.recipe-detail.will-be-hidden-from-the" values={{ name: r.name }}>{"{name} will be hidden from the recipe book."}</T>
      </ConfirmationDialog>
    </>
  );
}
