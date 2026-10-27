import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { allergenLabels } from "../../shared/inventory";
import { dietaryTagLabels, recipeCategoryLabels, recipeCategorySchema, type ClientRecipe, type RecipeCategory } from "../../shared/recipes";
import { unitLabel } from "../../shared/units";
import { useResource } from "../app/useResource";
import { recipesApi } from "../services/core";
import { PrintLayout } from "../components/print/PrintLayout";
import { LoadError } from "../components/record-display";
import { Button, FilterBar, LoadingSkeleton, PageHeader } from "../components/shared";
import "./recipe-books.css";

function ClientDish({ dish }: { dish: ClientRecipe }) {
  return <article className="recipe-card">
    <h2>{dish.name}</h2>
    {dish.photo && <img src={dish.photo} alt={dish.name} />}
    <p>{dish.description}</p>
    <p><strong>Ingredients:</strong> {dish.ingredients.join(", ") || "—"}</p>
    <p><strong>Allergens:</strong> {dish.allergens.map((tag) => allergenLabels[tag]).join(", ") || "None listed"}</p>
    <p><strong>Dietary tags:</strong> {dish.dietaryTags.map((tag) => dietaryTagLabels[tag]).join(", ") || "None listed"}</p>
  </article>;
}

export function ClientRecipeBook() {
  const [category, setCategory] = useState<RecipeCategory | "">("");
  const [selected, setSelected] = useState<string[]>([]);
  const resource = useResource(["recipes", "client", category], () => recipesApi.clientList({ category: category || undefined }));
  const dishes = resource.data ?? [];
  const toggle = (id: string, checked: boolean) => setSelected((ids) => checked ? [...ids, id] : ids.filter((other) => other !== id));
  const printSelection = `/print/recipes/client?ids=${selected.join(",")}`;
  return <>
    <Link to="/recipes" className="back-link">← Recipe book</Link>
    <PageHeader title="Client recipe book" subtitle="Choose dishes to show your client or save as a branded PDF.">
      <Button asChild variant="outline"><Link to={`/print/recipes/client${category ? `?category=${category}` : ""}`}>Print {category ? "category" : "all dishes"}</Link></Button>
      {selected.length > 0 && <Button asChild><Link to={printSelection}>Print selected ({selected.length})</Link></Button>}
    </PageHeader>
    <FilterBar>
      <select aria-label="Category" value={category} onChange={(e) => { setCategory(e.target.value as RecipeCategory | ""); setSelected([]); }}>
        <option value="">All categories</option>
        {recipeCategorySchema.options.map((value) => <option key={value} value={value}>{recipeCategoryLabels[value]}</option>)}
      </select>
      <span className="result-count">{dishes.length} dishes</span>
    </FilterBar>
    {resource.error ? <LoadError message={resource.error} /> : resource.loading ? <LoadingSkeleton /> : <>
      {!dishes.length && <p>No dishes in this category.</p>}
      <div className="client-recipe-grid">{dishes.map((dish) => <div key={dish.id}>
        <label className="checkbox-filter"><input type="checkbox" aria-label={`Select ${dish.name}`} checked={selected.includes(dish.id)} onChange={(e) => toggle(dish.id, e.target.checked)} />Select {dish.name}</label>
        <ClientDish dish={dish} />
      </div>)}</div>
    </>}
  </>;
}

export function ClientRecipePrint() {
  const [params] = useSearchParams();
  const parsedCategory = recipeCategorySchema.safeParse(params.get("category"));
  const category = parsedCategory.success ? parsedCategory.data : undefined;
  const ids = params.has("ids") ? new Set((params.get("ids") ?? "").split(",")) : null;
  const resource = useResource(["recipes", "client", category ?? ""], () => recipesApi.clientList({ category }));
  if (resource.error) return <LoadError message={resource.error} />;
  if (!resource.data) return <LoadingSkeleton />;
  const dishes = resource.data.filter((dish) => !ids || ids.has(dish.id));
  return <PrintLayout title="Recipe book" subtitle={category ? recipeCategoryLabels[category] : undefined}>
    {dishes.length ? dishes.map((dish) => <ClientDish key={dish.id} dish={dish} />) : <p>No dishes selected.</p>}
  </PrintLayout>;
}

export function KitchenRecipePrint() {
  const { id = "" } = useParams();
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
    <p>Allergens: {dish.allergens.map((tag) => allergenLabels[tag]).join(", ") || "None listed"}</p>
    <p>Dietary tags: {dish.dietaryTags.map((tag) => dietaryTagLabels[tag]).join(", ") || "None listed"}</p>
  </PrintLayout>;
}
