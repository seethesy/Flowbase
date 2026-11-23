import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { scaleQuantity, type Recipe } from "../../shared/recipes";
import { unitLabel } from "../../shared/units";
import { utcToBusinessTime } from "../../shared/time";
import { Block, PageGrid } from "../app/page-grid";
import { LabelT, T } from "../app/copy";
import { usePermissions } from "../app/permissions";
import { useResource } from "../app/useResource";
import { LoadError } from "../components/record-display";
import { Button, DetailDrawer, FilterBar, LoadingSkeleton, PageHeader } from "../components/shared";
import { Dropdown } from "../components/ui/Dropdown";
import { eventsApi, recipesApi } from "../services/core";
import { documentsApi } from "../services/documents";
import { weekday } from "./calendar-entries";
import { DocumentUpload } from "./documents";
import { centsLabel } from "./inventory-labels";
import "./kitchen-screen.css";

// The Kitchen screen's heading (FLOW-267), the same on its tabs (Overview from
// FLOW-293, Recipes, Ingredients, Menus), each with its own line under it and
// actions.
const subtitles = {
  overview: <T id="kitchen-screen.overview.menu-items-for-the-next">What the kitchen makes for the next 14 days: every menu item, when it is ready, for how many, and who is in charge.</T>,
  recipes: <T id="kitchen-screen.recipes.every-dish-with-its">Every dish with its ingredients, method, cost and allergens.</T>,
  ingredients: <T id="kitchen-screen.ingredients.kitchen-ingredients-what-is">Kitchen ingredients: what is on hand, par levels, costs and who supplies them.</T>,
  menus: <T id="kitchen-screen.menus.every-menu-pdf-in">{"Every menu PDF in one place: event menus, seasonal menus and the client recipe book. They're the same files as Documents › Menus."}</T>,
};
// Each tab's page layout, so its heading lines can be edited there (FLOW-282).
const pageKeys: Record<keyof typeof subtitles, string> = {
  overview: "kitchen.overview",
  recipes: "recipes.list",
  ingredients: "inventory.consumables",
  menus: "kitchen.menus",
};
export function KitchenHeading({ tab, children }: { tab: keyof typeof subtitles; children?: ReactNode }) {
  return (
    <PageHeader pageKey={pageKeys[tab]} title={<T id="kitchen-screen.kitchen-heading.kitchen">Kitchen</T>} subtitle={subtitles[tab]}>
      {children}
    </PageHeader>
  );
}

const amount = (quantity: number | null) =>
  quantity === null ? "" : Number.isInteger(quantity) ? String(quantity) : String(Number(quantity.toFixed(3)));

// The kitchen card (FLOW-267): a recipe at N servings. Amounts recalculate from
// the yield as N changes (scaleQuantity); the method, allergen and dietary tags
// and cost per serving (FT+ only, F-01-04) as on the recipe. Print kitchen card
// and Edit recipe lead to the print page and the recipe.
export function KitchenCard({ recipe, onClose }: { recipe: Recipe; onClose: () => void }) {
  const navigate = useNavigate();
  const yieldServings = recipe.yield?.servings ?? null;
  const [servings, setServings] = useState(String(yieldServings ?? ""));
  const target = Number(servings);
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={
        <>
          <small className="kitchen-card-kicker">
            <T id="kitchen-screen.kitchen-card.kicker" values={{ category: recipe.category }}>{"Kitchen card · {category}"}</T>
          </small>
          {recipe.name}
        </>
      }
      description={
        <span className="kitchen-card-tags">
          {recipe.allergens.map((tag) => (
            <span key={tag} className="badge warning">
              <T id="kitchen-screen.kitchen-card.contains" values={{ tag }}>{"Contains {tag}"}</T>
            </span>
          ))}
          {recipe.dietaryTags.map((tag) => <span key={tag} className="badge success">{tag}</span>)}
        </span>
      }
    >
      {yieldServings ? (
        <label className="kitchen-card-scale">
          <T id="kitchen-screen.kitchen-card.scale-to">Scale to</T>
          <input aria-label="Servings" type="number" min={1} value={servings} onChange={(event) => setServings(event.target.value)} />
          <T id="kitchen-screen.kitchen-card.servings-yield" values={{ servings: yieldServings }}>{"servings (recipe yields {servings})"}</T>
        </label>
      ) : (
        <p className="muted"><T id="kitchen-screen.kitchen-card.no-yield">This recipe has no yield, so it can't be scaled.</T></p>
      )}
      <section className="kitchen-card-box" aria-label="Ingredients">
        <h3><T id="kitchen-screen.kitchen-card.ingredients">Ingredients</T></h3>
        <ul>
          {recipe.lines.map((line) => (
            <li key={line.id}>
              <span>{line.ingredientName}{line.prepNote && <small> · {line.prepNote}</small>}</span>
              <strong>
                {amount(scaleQuantity(line.quantity, yieldServings, target))}
                {line.unit && ` ${unitLabel(line.unit)}`}
              </strong>
            </li>
          ))}
        </ul>
      </section>
      {recipe.steps.length > 0 && (
        <section className="kitchen-card-box" aria-label="Method">
          <h3><T id="kitchen-screen.kitchen-card.method">Method</T></h3>
          <ol>{recipe.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        </section>
      )}
      {!recipe.costHidden && (
        <p className="kitchen-card-cost">
          <T id="kitchen-screen.kitchen-card.cost-per-serving">Cost per serving</T>
          <strong>{centsLabel(recipe.cost?.perServingCents ?? null)}</strong>
        </p>
      )}
      <div className="panel-actions">
        <Button asChild><Link to={`/print/recipes/${recipe.id}`}><T id="kitchen-screen.kitchen-card.print-kitchen-card">Print kitchen card</T></Link></Button>
        <Button variant="outline" onClick={() => navigate(`/recipes/${recipe.id}`)}><T id="kitchen-screen.kitchen-card.edit-recipe">Edit recipe</T></Button>
      </div>
    </DetailDrawer>
  );
}

// The Menus tab (FLOW-267): every Document of type Menu (FLOW-263). A menu linked
// to an event is an event menu; a stored client recipe book (FLOW-301, group
// "recipe_book") is a recipe book; any other is a seasonal menu. Open PDF opens
// the file; In Documents opens its preview there.
type MenuKind = "event" | "seasonal" | "recipe_book";
const kindLabels: Record<MenuKind, string> = { event: "Event menu", seasonal: "Seasonal", recipe_book: "Recipe book" };
const filterLabels: Record<"" | MenuKind, string> = { "": "All menus", event: "Event", seasonal: "Seasonal", recipe_book: "Recipe books" };

export function MenusPage() {
  const { can } = usePermissions();
  const menus = useResource(["documents", "menus"], () => documentsApi.list({ docType: "menu" }));
  const [kind, setKind] = useState<"" | MenuKind>("");
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const cards = (menus.data ?? []).map((document) => ({
    document,
    kind: (document.group === "recipe_book" ? "recipe_book"
      : document.recordType === "event" ? "event" : "seasonal") as MenuKind,
  }));
  const shown = cards.filter((card) => !kind || card.kind === kind);
  // FLOW-301: the client recipe book (all dishes) is generated and stored as a PDF.
  const generateBook = async () => {
    setGenerating(true);
    setError("");
    try { await recipesApi.saveClientBook({}); menus.reload(); }
    catch (cause) { setError((cause as Error).message); }
    finally { setGenerating(false); }
  };
  return (
    <>
      <KitchenHeading tab="menus">
        {can("attachments.write") && (
          <Button variant="outline" disabled={generating} onClick={() => void generateBook()}>
            <T id="kitchen-screen.menus.generate-recipe-book">Generate recipe book</T>
          </Button>
        )}
        {can("attachments.write") && (
          <Button onClick={() => setUploading(true)}><T id="kitchen-screen.menus.upload-menu">+ Upload menu</T></Button>
        )}
      </KitchenHeading>
      <PageGrid pageKey="kitchen.menus">
        <Block id="filters" name="Filters" h={3}>
          <FilterBar>
            <Dropdown
              variant="filter"
              aria-label="Menus"
              value={kind}
              options={(["", "event", "seasonal", "recipe_book"] as const).map((value) => ({
                value,
                label: <LabelT id="labels.menu-filter" value={value || "all"}>{filterLabels[value]}</LabelT>,
                text: filterLabels[value],
              }))}
              onValueChange={(next) => setKind(next as "" | MenuKind)}
            />
          </FilterBar>
        </Block>
        <Block id="menus" name="Menus" h={24}>
          {menus.error && <LoadError message={menus.error} />}
          {error && <p role="alert" className="error-message">{error}</p>}
          {!menus.data && !menus.error && <LoadingSkeleton />}
          <ul className="menu-cards" aria-label="Menus">
            {shown.map(({ document, kind: cardKind }) => {
              const latest = [...document.versions].sort((a, b) => b.number - a.number)[0];
              return (
                <MenuCard
                  key={document.id}
                  title={document.name}
                  kicker={cardKind === "event" ? <EventKicker eventId={document.recordId} /> : <LabelT id="labels.menu-kind" value={cardKind}>{kindLabels[cardKind]}</LabelT>}
                  detail={latest ? (
                    <T id="kitchen-screen.menus.version-detail" values={{
                      version: latest.number,
                      date: weekday(utcToBusinessTime(new Date(latest.createdAt)).date).split(", ")[1] ?? "",
                      by: latest.uploaderName ? ` · ${latest.uploaderName}` : "",
                    }}>{"v{version} · {date}{by}"}</T>
                  ) : null}
                  pdf={latest?.url ?? null}
                  documentId={document.id}
                  tone={cardKind}
                />
              );
            })}
          </ul>
          {menus.data && !shown.length && kind !== "recipe_book" && (
            <p className="muted"><T id="kitchen-screen.menus.no-menu-documents-yet">No menu documents yet. Upload one, or set a document's type to Menu.</T></p>
          )}
          {menus.data && !shown.length && kind === "recipe_book" && (
            <p className="muted"><T id="kitchen-screen.menus.no-recipe-books-yet">No recipe books yet. Generate one here or from the client recipe book.</T></p>
          )}
        </Block>
      </PageGrid>
      {uploading && <DocumentUpload presetType="menu" onClose={() => setUploading(false)} onSaved={() => { setUploading(false); menus.reload(); }} />}
    </>
  );
}

// "EVENT MENU · NOV 28": the linked event's date.
function EventKicker({ eventId }: { eventId: string }) {
  const event = useResource(["events", "menu-kicker", eventId], () => eventsApi.get(eventId));
  return (
    <>
      <LabelT id="labels.menu-kind" value="event">{kindLabels.event}</LabelT>
      {event.data && <> · {weekday(event.data.date).split(", ")[1]}</>}
    </>
  );
}

function MenuCard({ title, kicker, detail, pdf, documentId, tone }: {
  title: ReactNode;
  kicker: ReactNode;
  detail: ReactNode;
  pdf: string | null;
  documentId: string;
  tone: MenuKind;
}) {
  return (
    <li className="menu-card">
      <div className={`menu-card-cover menu-card-cover--${tone}`} aria-hidden="true">
        <strong>{title}</strong>
        <small>{kicker}</small>
        <span className="badge error"><T id="kitchen-screen.menus.pdf">PDF</T></span>
      </div>
      <div className="menu-card-body">
        <strong>{title}</strong>
        <small>{detail}</small>
        <div className="panel-actions">
          {pdf && (
            <Button variant="outline" asChild>
              <a href={pdf} target="_blank" rel="noreferrer"><T id="kitchen-screen.menus.open-pdf">Open PDF</T></a>
            </Button>
          )}
          <Button variant="outline" asChild>
            <Link to={`/documents?document=${documentId}`}><T id="kitchen-screen.menus.in-documents">In Documents</T></Link>
          </Button>
        </div>
      </div>
    </li>
  );
}

// The Ingredients tab's Stock pill (FLOW-267): out with nothing on hand, low under
// par, otherwise in stock.
export function IngredientStockPill({ item }: { item: { totalQuantity: number; belowPar: boolean | null } }) {
  if (item.totalQuantity <= 0) return <span className="badge error"><T id="kitchen-screen.stock.out">Out</T></span>;
  if (item.belowPar) return <span className="badge warning"><T id="kitchen-screen.stock.low">Low</T></span>;
  return <span className="badge success"><T id="kitchen-screen.stock.in-stock">In stock</T></span>;
}
export const ingredientStockText = (item: { totalQuantity: number; belowPar: boolean | null }) =>
  item.totalQuantity <= 0 ? "Out" : item.belowPar ? "Low" : "In stock";

// The Ingredients tab's bulk actions (FLOW-267): Move to storage and Set vendor,
// saved item by item through the inline endpoint.
export function IngredientBulkActions({ sections, onApply }: {
  sections: { id: string; name: string }[];
  onApply: (field: string, value: string) => Promise<void>;
}) {
  const [vendor, setVendor] = useState("");
  return (
    <>
      <Dropdown variant="dark" aria-label="Move to storage" value=""
        options={[{ value: "", label: <T id="kitchen-screen.bulk.move-to-storage">Move to storage</T>, text: "Move to storage" },
          ...sections.map((section) => ({ value: section.id, label: section.name }))]}
        onValueChange={(next) => next && void onApply("consumable.storageSectionId", next)} />
      <form className="bulk-vendor-form" onSubmit={(event) => {
        event.preventDefault();
        if (vendor.trim()) void onApply("consumable.preferredVendor", vendor.trim()).then(() => setVendor(""));
      }}>
        <input aria-label="Vendor for selected ingredients" value={vendor} onChange={(event) => setVendor(event.target.value)} />
        <Button type="submit" variant="outline" disabled={!vendor.trim()}><T id="kitchen-screen.bulk.set-vendor">Set vendor</T></Button>
      </form>
    </>
  );
}
