import { Dropdown } from "../components/ui/Dropdown";
import { Block, PageGrid } from "../app/page-grid";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { ClientRecipe } from "../../shared/recipes";
import { unitLabel } from "../../shared/units";
import { useResource } from "../app/useResource";
import { recipesApi } from "../services/core";
import { PrintLayout } from "../components/print/PrintLayout";
import { LoadError } from "../components/record-display";
import { Button, FilterBar, LoadingSkeleton, PageHeader } from "../components/shared";
import { useArchivedMarks, useListLabels } from "./list-fields";
import "./recipe-books.css";
import { RoundCheck } from "../components/ui/round-check";
import { T } from "../app/copy";

function ClientDish({ dish }: { dish: ClientRecipe }) {
  const markAllergen = useArchivedMarks("allergen");
  const markDietaryTag = useArchivedMarks("dietary_tag");
  return <article className="recipe-card">
    <h2>{dish.name}</h2>
    {dish.photo && <img src={dish.photo} alt={dish.name} />}
    <p>{dish.description}</p>
    <p><strong><T id="recipe-books.client-dish.ingredients">Ingredients:</T></strong> {dish.ingredients.join(", ") || "—"}</p>
    <p><strong><T id="recipe-books.client-dish.allergens">Allergens:</T></strong> {dish.allergens.map(markAllergen).join(", ") || <T id="recipe-books.client-dish.none-listed">None listed</T>}</p>
    <p><strong><T id="recipe-books.client-dish.dietary-tags">Dietary tags:</T></strong> {dish.dietaryTags.map(markDietaryTag).join(", ") || <T id="recipe-books.client-dish.none-listed">None listed</T>}</p>
  </article>;
}

export function ClientRecipeBook() {
  const [category, setCategory] = useState("");
  // The settings list, archived values included: a category archived since still
  // has dishes in it.
  const categories = [...new Set(useListLabels("recipe_category"))];
  const markCategory = useArchivedMarks("recipe_category");
  const [selected, setSelected] = useState<string[]>([]);
  const resource = useResource(["recipes", "client", category], () => recipesApi.clientList({ category: category || undefined }));
  const dishes = resource.data ?? [];
  const toggle = (id: string, checked: boolean) => setSelected((ids) => checked ? [...ids, id] : ids.filter((other) => other !== id));
  const printSelection = `/print/recipes/client?ids=${selected.join(",")}`;
  return <>
    <Link to="/recipes" className="back-link"><T id="recipe-books.client-recipe-book.recipe-book">← Recipe book</T></Link>
    <PageHeader pageKey="recipes.client-book" title={<T id="recipe-books.client-recipe-book.client-recipe-book">Client recipe book</T>} subtitle={<T id="recipe-books.client-recipe-book.choose-dishes-to-show-your">Choose dishes to show your client or save as a branded PDF.</T>}>
      <Button asChild variant="outline"><Link to={`/print/recipes/client${category ? `?category=${encodeURIComponent(category)}` : ""}`}>{category ? <T id="recipe-books.client-recipe-book.print-category">Print category</T> : <T id="recipe-books.client-recipe-book.print-all-dishes">Print all dishes</T>}</Link></Button>
      {selected.length > 0 && <Button asChild><Link to={printSelection}><T id="recipe-books.client-recipe-book.print-selected" values={{ selectedCount: selected.length }}>{"Print selected ({selectedCount})"}</T></Link></Button>}
    </PageHeader>
    <PageGrid pageKey="recipes.client-book">
    <Block id="filters" name="Filters" h={4}>
    <FilterBar>
      <Dropdown aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value); setSelected([]); }}>
        <option value="">All categories</option>
        {categories.map((value) => <option key={value} value={value}>{markCategory(value)}</option>)}
      </Dropdown>
      <span className="result-count"><T id="recipe-books.client-recipe-book.dishes" values={{ dishesCount: dishes.length }}>{"{dishesCount} dishes"}</T></span>
    </FilterBar>
    </Block>
    <Block id="dishes" name="Dishes" h={30}>
    {resource.error ? <LoadError message={resource.error} /> : resource.loading ? <LoadingSkeleton /> : <>
      {!dishes.length && <p><T id="recipe-books.client-recipe-book.no-dishes-in-this-category">No dishes in this category.</T></p>}
      <div className="client-recipe-grid">{dishes.map((dish) => <div key={dish.id}>
        <label className="checkbox-filter"><RoundCheck aria-label={`Select ${dish.name}`} checked={selected.includes(dish.id)} onChange={(e) => toggle(dish.id, e.target.checked)} /><T id="recipe-books.client-recipe-book.select" values={{ name: dish.name }}>{"Select {name}"}</T></label>
        <ClientDish dish={dish} />
      </div>)}</div>
    </>}
    </Block>
    </PageGrid>
  </>;
}

/* eslint-disable live-copy/no-literal-text -- Recipe print views are documents, not screens (FLOW-243). */
export function ClientRecipePrint() {
  const [params] = useSearchParams();
  const category = params.get("category") || undefined;
  const markCategory = useArchivedMarks("recipe_category");
  const ids = params.has("ids") ? new Set((params.get("ids") ?? "").split(",")) : null;
  const resource = useResource(["recipes", "client", category ?? ""], () => recipesApi.clientList({ category }));
  if (resource.error) return <LoadError message={resource.error} />;
  if (!resource.data) return <LoadingSkeleton />;
  const dishes = resource.data.filter((dish) => !ids || ids.has(dish.id));
  return <PrintLayout title="Recipe book" subtitle={category ? markCategory(category) : undefined}>
    {dishes.length ? dishes.map((dish) => <ClientDish key={dish.id} dish={dish} />) : <p>No dishes selected.</p>}
  </PrintLayout>;
}

export function KitchenRecipePrint() {
  const { id = "" } = useParams();
  const markAllergen = useArchivedMarks("allergen");
  const markDietaryTag = useArchivedMarks("dietary_tag");
  const resource = useResource(["recipes", id], () => recipesApi.get(id));
  if (resource.error) return <LoadError message={resource.error} />;
  if (!resource.data) return <LoadingSkeleton />;
  const dish = resource.data;
  // Render only the kitchen card's fields, even when an Admin prints it.
  return <PrintLayout title={dish.name} subtitle="Kitchen card">
    <p>{dish.description}</p>
    {dish.yield && <p>Yield: {dish.yield.servings} servings {dish.yield.portionSize}</p>}
    <h2>Ingredients</h2>
    <ul>{dish.lines.map((line) => <li key={line.id}>{line.ingredientName} — {line.quantity === null || !line.unit ? "As needed" : `${line.quantity} ${unitLabel(line.unit)}`} {line.prepNote}</li>)}</ul>
    <h2>Method</h2>
    <ol>{dish.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
    {dish.finishingNote && <p>Finish: {dish.finishingNote}</p>}
    <p>Allergens: {dish.allergens.map(markAllergen).join(", ") || "None listed"}</p>
    <p>Dietary tags: {dish.dietaryTags.map(markDietaryTag).join(", ") || "None listed"}</p>
  </PrintLayout>;
}
/* eslint-enable live-copy/no-literal-text */
