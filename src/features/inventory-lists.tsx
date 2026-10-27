import { Allowed } from "../app/permissions";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, ClipboardCheck } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  barCategories,
  barContainerLabels,
  barSubcategories,
  barTierLabels,
  barTierSchema,
  itemKindSchema,
  type InventoryItem,
  type ItemKind,
  type SectionKind,
} from "../../shared/inventory";
import { unitLabel } from "../../shared/units";
import { inventoryApi, sectionsApi } from "../services/core";
import { useResource } from "../app/useResource";
import { LoadMore, useDebounced, usePagedList } from "../app/paging";
import {
  PageHeader,
  Button,
  SearchInput,
  FilterBar,
  DataTable,
  LoadingSkeleton,
} from "../components/shared";
import { LoadError } from "./clients";
import { ItemForm } from "./inventory-item-form";
import { useListLabels } from "./list-fields";
import {
  barTierLabel,
  centsLabel,
  kindLabels,
  purchaseLabel,
  quantityLabel,
  subtypeLabel,
  variantLabel,
} from "./inventory-labels";
import "./inventory.css";

// Unit cost in a CSV file: dollars without formatting, blank when unknown.
const costCsv = (item: InventoryItem) => {
  const cents = item.consumable?.unitCostCents;
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
};

function SectionFilter({
  value,
  onChange,
  kind,
  label = "Section",
}: {
  value: string;
  onChange: (value: string) => void;
  kind?: SectionKind;
  label?: string;
}) {
  const sections = useResource(() => sectionsApi.list({ kind }), [kind]);
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">All {label.toLowerCase()}s</option>
      {(sections.data ?? []).map((section) => (
        <option key={section.id} value={section.id}>
          {section.name}
        </option>
      ))}
    </select>
  );
}

export function InventoryList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<ItemKind | "">("");
  const [sectionId, setSectionId] = useState("");
  const [archived, setArchived] = useState(false);
  const [create, setCreate] = useState(false);
  // Search and filters run on the server across every item (FLOW-179/180).
  const term = useDebounced(search.trim());
  const items = usePagedList(
    (cursor) =>
      inventoryApi.list(
        {
          archived,
          kind: kind || undefined,
          sectionId: sectionId || undefined,
          search: term || undefined,
        },
        cursor,
      ),
    [archived, kind, sectionId, term],
  );
  const data = items.data ?? [];
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    { accessorKey: "name", header: "Item" },
    {
      accessorKey: "code",
      header: "Code",
      cell: (c) => (
        <span className="sku">{(c.getValue() as string) || "—"}</span>
      ),
    },
    {
      id: "kind",
      header: "Kind",
      accessorFn: (item) =>
        [kindLabels[item.kind], subtypeLabel(item.subtype)]
          .filter(Boolean)
          .join(" · "),
    },
    { accessorKey: "category", header: "Category" },
    { id: "variant", header: "Group / variant", accessorFn: variantLabel },
    {
      id: "quantity",
      header: "On hand",
      accessorFn: (item) => item.totalQuantity,
      sortingFn: "basic",
      cell: (c) =>
        c.row.original.kind === "service"
          ? "Not stocked"
          : quantityLabel(c.row.original.totalQuantity, c.row.original.unit),
    },
  ];
  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Rentals, decor, kitchen, bar and supplies, and the services you sell."
        eyebrow="STOCK & SUPPLIES"
      >
        <Button variant="outline" asChild>
          <Link to="/inventory/ingredients">Ingredients</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/inventory/bar">Bar</Link>
        </Button>
        <Allowed action="inventory.count">
          <Button variant="outline" asChild>
            <Link to="/inventory/counts">Counts</Link>
          </Button>
        </Allowed>
        <Button variant="outline" asChild>
          <Link to="/inventory/low-stock">Low stock</Link>
        </Button>
        <Allowed action="inventory.sections">
          <Button variant="outline" asChild>
            <Link to="/inventory/sections">Sections</Link>
          </Button>
        </Allowed>
        <Allowed action="inventory.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            New Item
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search item name or code…"
        />
        <select
          aria-label="Kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as ItemKind | "")}
        >
          <option value="">All kinds</option>
          {itemKindSchema.options.map((option) => (
            <option key={option} value={option}>
              {kindLabels[option]}
            </option>
          ))}
        </select>
        <SectionFilter value={sectionId} onChange={setSectionId} />
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
        <span className="result-count">
          {data.length}
          {items.hasMore ? "+" : ""} items
        </span>
      </FilterBar>
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : (
        <>
          <DataTable
            data={data}
            columns={columns}
            onRow={(item) => navigate(`/inventory/${item.id}`)}
            label="items"
            exportName="inventory"
          />
          <LoadMore list={items} label="Load more items" />
        </>
      )}
      {create && (
        <ItemForm
          onClose={() => setCreate(false)}
          onSaved={(item) => navigate(`/inventory/${item.id}`)}
        />
      )}
    </>
  );
}

// The kitchen ingredient catalog (FLOW-81): consumables of subtype ingredient.
export function IngredientList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [vendor, setVendor] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [belowPar, setBelowPar] = useState(false);
  const [create, setCreate] = useState(false);
  const term = useDebounced(search.trim());
  const vendorTerm = useDebounced(vendor.trim());
  const items = usePagedList(
    (cursor) =>
      inventoryApi.list(
        {
          kind: "consumable",
          subtype: "ingredient",
          category: category || undefined,
          sectionId: sectionId || undefined,
          belowPar,
          search: term || undefined,
          vendor: vendorTerm || undefined,
        },
        cursor,
      ),
    [category, sectionId, belowPar, term, vendorTerm],
  // Business settings' categories (FLOW-45), archived ones included so old items
  // can still be found.
  const listed = useListLabels("ingredient_category");
  const categories = [
    ...new Set([...listed, ...(items.data ?? []).map((item) => item.category)]),
  ].filter(Boolean);
  );
  const data = items.data ?? [];
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    { accessorKey: "name", header: "Ingredient" },
    { accessorKey: "category", header: "Category" },
    {
      id: "purchase",
      header: "Bought as",
      accessorFn: (item) => purchaseLabel(item.consumable),
    },
    {
      id: "recipeUnit",
      header: "Recipe unit",
      accessorFn: (item) =>
        item.consumable?.recipeUnit
          ? unitLabel(item.consumable.recipeUnit)
          : "—",
    },
    {
      id: "cost",
      header: "Unit cost",
      accessorFn: (item) =>
        item.consumable?.costHidden
          ? "Hidden"
          : centsLabel(item.consumable?.unitCostCents ?? null),
      meta: { fieldGroup: "internal_cost", csv: costCsv },
    },
    {
      id: "vendor",
      header: "Vendor",
      accessorFn: (item) => item.consumable?.preferredVendor || "—",
    },
    {
      id: "storage",
      header: "Storage",
      accessorFn: (item) => item.consumable?.storageSectionName ?? "—",
    },
    {
      id: "onHand",
      header: "On hand",
      accessorFn: (item) => item.totalQuantity,
      sortingFn: "basic",
      cell: (c) => (
        <>
          {quantityLabel(c.row.original.totalQuantity, c.row.original.unit)}
          {c.row.original.belowPar && (
            <span className="badge warning">Below par</span>
          )}
        </>
      ),
    },
  ];
  return (
    <>
      <Link to="/inventory" className="back-link">
        ← All inventory
      </Link>
      <PageHeader
        title="Ingredients"
        subtitle="What the kitchen buys, how it's used in recipes, and where it's kept."
        eyebrow="KITCHEN"
      >
        <Allowed action="inventory.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            New Ingredient
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search ingredients…"
        />
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <input
          aria-label="Vendor"
          placeholder="Vendor"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />
        <SectionFilter
          value={sectionId}
          onChange={setSectionId}
          kind="consumable"
          label="Storage section"
        />
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={belowPar}
            onChange={(e) => setBelowPar(e.target.checked)}
          />
          Below par only
        </label>
        <span className="result-count">
          {data.length}
          {items.hasMore ? "+" : ""} ingredients
        </span>
      </FilterBar>
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : (
        <>
          <DataTable
            data={data}
            columns={columns}
            onRow={(item) => navigate(`/inventory/${item.id}`)}
            label="ingredients"
            exportName="ingredients"
          />
          <LoadMore list={items} label="Load more ingredients" />
        </>
      )}
      {create && (
        <ItemForm
          preset={{ kind: "consumable", subtype: "ingredient" }}
          onClose={() => setCreate(false)}
          onSaved={() => items.reload()}
        />
      )}
    </>
  );
}

// Bar stock (FLOW-90): consumables of subtype bar, counted, flagged below par and
// costed like ingredients.
export function BarList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [tier, setTier] = useState("");
  const [distributor, setDistributor] = useState("");
  const [belowPar, setBelowPar] = useState(false);
  const [create, setCreate] = useState(false);
  const term = useDebounced(search.trim());
  const distributorTerm = useDebounced(distributor.trim());
  const items = usePagedList(
    (cursor) =>
      inventoryApi.list(
        {
          kind: "consumable",
          subtype: "bar",
          category: category || undefined,
          subcategory: subcategory || undefined,
          tier: tier || undefined,
          belowPar,
          search: term || undefined,
          vendor: distributorTerm || undefined,
        },
        cursor,
      ),
    [category, subcategory, tier, belowPar, term, distributorTerm],
  );
  const data = items.data ?? [];
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    { accessorKey: "name", header: "Item" },
    {
      id: "brand",
      header: "Brand / varietal",
      accessorFn: (item) => item.bar?.brand || "—",
    },
    {
      id: "category",
      header: "Category",
      accessorFn: (item) =>
        [item.category, item.bar?.subcategory].filter(Boolean).join(" · "),
    },
    {
      id: "tier",
      header: "Tier",
      accessorFn: (item) => barTierLabel(item.tier) || "—",
    },
    {
      id: "container",
      header: "Container",
      accessorFn: (item) =>
        [
          item.bar?.container ? barContainerLabels[item.bar.container] : "",
          item.consumable?.eachSize
            ? `${Number(item.consumable.eachSize.quantity)} ${unitLabel(item.consumable.eachSize.unit)}`
            : "",
        ]
          .filter(Boolean)
          .join(" ") || "—",
    },
    {
      id: "pack",
      header: "Bought as",
      accessorFn: (item) => purchaseLabel(item.consumable),
    },
    {
      id: "distributor",
      header: "Distributor",
      accessorFn: (item) => item.consumable?.preferredVendor || "—",
    },
    {
      id: "cost",
      header: "Unit cost",
      accessorFn: (item) =>
        item.consumable?.costHidden
          ? "Hidden"
          : centsLabel(item.consumable?.unitCostCents ?? null),
      meta: { fieldGroup: "internal_cost", csv: costCsv },
    },
    {
      id: "onHand",
      header: "On hand",
      accessorFn: (item) => item.totalQuantity,
      sortingFn: "basic",
      cell: (c) => (
        <>
          {quantityLabel(c.row.original.totalQuantity, c.row.original.unit)}
          {c.row.original.belowPar && (
            <span className="badge warning">Below par</span>
          )}
        </>
      ),
    },
  ];
  return (
    <>
      <Link to="/inventory" className="back-link">
        ← All inventory
      </Link>
      <PageHeader
        title="Bar"
        subtitle="Beer, wine and liquor: what's in stock, what's low, and who supplies it."
        eyebrow="BAR"
      >
        <Allowed action="inventory.count">
          <Button variant="outline" asChild>
            <Link to="/inventory/counts">
              <ClipboardCheck size={16} />
              Count
            </Link>
          </Button>
        </Allowed>
        <Allowed action="inventory.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            New Bar Item
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search name or brand…"
        />
        <select
          aria-label="Category"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            if (!barSubcategories[e.target.value]?.includes(subcategory))
              setSubcategory("");
          }}
        >
          <option value="">All categories</option>
          {barCategories.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <select
          aria-label="Subcategory"
          value={subcategory}
          disabled={Boolean(category) && !barSubcategories[category]}
          onChange={(e) => {
            setSubcategory(e.target.value);
            const parent = Object.keys(barSubcategories).find((key) =>
              barSubcategories[key].includes(e.target.value),
            );
            if (parent) setCategory(parent);
          }}
        >
          <option value="">All subcategories</option>
          {Object.entries(barSubcategories)
            .filter(([parent]) => !category || parent === category)
            .map(([parent, options]) => (
              <optgroup key={parent} label={parent}>
                {options.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </optgroup>
            ))}
        </select>
        <select
          aria-label="Tier"
          value={tier}
          onChange={(e) => setTier(e.target.value)}
        >
          <option value="">All tiers</option>
          {barTierSchema.options.map((option) => (
            <option key={option} value={option}>
              {barTierLabels[option]}
            </option>
          ))}
        </select>
        <input
          aria-label="Distributor"
          placeholder="Distributor"
          value={distributor}
          onChange={(e) => setDistributor(e.target.value)}
        />
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={belowPar}
            onChange={(e) => setBelowPar(e.target.checked)}
          />
          Below par only
        </label>
        <span className="result-count">
          {data.length}
          {items.hasMore ? "+" : ""} bar items
        </span>
      </FilterBar>
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : (
        <>
          <DataTable
            data={data}
            columns={columns}
            onRow={(item) => navigate(`/inventory/${item.id}`)}
            label="bar items"
            exportName="bar"
          />
          <LoadMore list={items} label="Load more bar items" />
        </>
      )}
      {create && (
        <ItemForm
          preset={{ kind: "consumable", subtype: "bar" }}
          onClose={() => setCreate(false)}
          onSaved={() => items.reload()}
        />
      )}
    </>
  );
}
