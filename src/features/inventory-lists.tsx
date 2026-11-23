import { useDeletable } from "../app/deletable";
import { Dropdown } from "../components/ui/Dropdown";
import { Allowed } from "../app/permissions";
import { Block, PageGrid } from "../app/page-grid";
import { usePermissions } from "../app/permissions";
import { isFtPlus } from "../../shared/access";
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
import { unitLabel, unitSchema } from "../../shared/units";
import { inventoryApi, sectionsApi } from "../services/core";
import { inventoryCategoriesApi } from "../services/inventory-categories";
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
import { LoadError } from "../components/record-display";
import { ItemForm } from "./inventory-item-form";
import { useListLabels } from "./list-fields";
import {
  barTierLabel,
  centsLabel,
  kindLabels,
  purchaseLabel,
  quantityLabel,
  subtypeLabel,
} from "./inventory-labels";
import "./inventory.css";
import { RoundCheck } from "../components/ui/round-check";
import { T, useCopy, LabelT, joined } from "../app/copy";

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
  const sections = useResource(
    ["sections", { kind }],
    () => sectionsApi.list({ kind }),
    { reference: true },
  );
  return (
    <Dropdown
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
    </Dropdown>
  );
}

function ClassificationFilters({ kind, categoryId, typeId, onCategory, onType }: {
  kind: string;
  categoryId: string;
  typeId: string;
  onCategory: (id: string) => void;
  onType: (id: string) => void;
}) {
  const catalog = useResource(["inventory-categories"], inventoryCategoriesApi.list, { reference: true });
  return <>
    <Dropdown aria-label="Inventory category" value={categoryId} onValueChange={(next) => { onCategory(next); onType(""); }}>
      <option value="">All categories</option>
      {(catalog.data?.categories ?? []).filter((entry) => kind === "all" || entry.kind === kind ||
        (kind === "consumable" && ["ingredient", "bar", "supply"].includes(entry.kind)))
        .map((entry) => <option key={entry.id} value={entry.id}>{kind === "all" ? `${entry.kind} · ${entry.name}` : entry.name}</option>)}
    </Dropdown>
    <Dropdown aria-label="Inventory type" value={typeId} disabled={!categoryId} onValueChange={onType}>
      <option value="">All types</option>
      {(catalog.data?.types ?? []).filter((entry) => entry.categoryId === categoryId)
        .map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
    </Dropdown>
  </>;
}

// How a consumable is bought, one stored field per column (FLOW-275): purchase
// unit, pack count, and each size with its unit. Each saves through the inline
// endpoint.
function purchaseColumns(
  save: (item: InventoryItem, field: string, value: string) => Promise<void>,
  canEdit: (item: InventoryItem) => boolean,
): ColumnDef<InventoryItem, unknown>[] {
  const editable = (item: InventoryItem) => canEdit(item) && Boolean(item.consumable);
  const units = unitSchema.options.map((unit) => ({ value: unit, label: unitLabel(unit) }));
  return [
    {
      id: "purchase",
      header: "Bought as",
      accessorFn: (item) => purchaseLabel(item.consumable),
      // The trigger reads like the column ("case of 12 × 750 ml"); the menu picks the unit.
      meta: { edit: "select", canEdit: editable, editValue: (item) => item.consumable?.purchaseUnit ?? "",
        editDisplay: (item) => purchaseLabel(item.consumable), editOptions: units, onEdit: (item, value) => save(item, "consumable.purchaseUnit", value) },
    },
    {
      id: "packCount",
      header: "Pack count",
      accessorFn: (item) => item.consumable?.packCount ?? "",
      meta: { edit: "number", canEdit: editable, onEdit: (item, value) => save(item, "consumable.packCount", value) },
    },
    {
      id: "eachSize",
      header: "Each size",
      accessorFn: (item) => item.consumable?.eachSize ? Number(item.consumable.eachSize.quantity) : "",
      meta: { edit: "number", canEdit: editable, onEdit: (item, value) => save(item, "consumable.eachSize.quantity", value) },
    },
    {
      id: "eachUnit",
      header: "Each unit",
      accessorFn: (item) => item.consumable?.eachSize ? unitLabel(item.consumable.eachSize.unit) : "",
      meta: { edit: "select", canEdit: editable, editValue: (item) => item.consumable?.eachSize?.unit ?? "",
        editOptions: units, onEdit: (item, value) => save(item, "consumable.eachSize.unit", value) },
    },
  ];
}

function classificationColumns(
  catalog: Awaited<ReturnType<typeof inventoryCategoriesApi.list>> | undefined,
  save: (item: InventoryItem, field: string, value: string) => Promise<void>,
  canEdit: (item: InventoryItem) => boolean,
  admin: boolean,
  reload: () => Promise<unknown>,
): ColumnDef<InventoryItem, unknown>[] {
  return [
    { accessorKey: "categoryId", header: "Category",
      meta: { edit: "select", canEdit,
        editCreate: admin ? async (item, name) => {
          const kind = item.kind === "consumable" ? item.subtype ?? "supply" : item.kind;
          const created = await inventoryCategoriesApi.createCategory(kind, name);
          await reload();
          return created.id;
        } : undefined,
        editOptions: (item) => [
          { value: "", label: "None" },
          ...(catalog?.categories ?? []).filter((row) => row.kind === (item.kind === "consumable" ? item.subtype : item.kind))
            .map((row) => ({ value: row.id, label: row.name })),
        ],
        onEdit: (item, value) => save(item, "categoryId", value),
      },
      cell: ({ row }) => catalog?.categories.find((entry) => entry.id === row.original.categoryId)?.name ?? "—",
    },
    { accessorKey: "typeId", header: "Type",
      meta: { edit: "select", canEdit: (item) => canEdit(item) && Boolean(item.categoryId),
        editCreate: admin ? async (item, name) => {
          if (!item.categoryId) throw new Error("Choose a category first.");
          const created = await inventoryCategoriesApi.createType(item.categoryId, name);
          await reload();
          return created.id;
        } : undefined,
        editOptions: (item) => [
          { value: "", label: "None" },
          ...(catalog?.types ?? []).filter((row) => row.categoryId === item.categoryId)
            .map((row) => ({ value: row.id, label: row.name })),
        ],
        onEdit: (item, value) => save(item, "typeId", value),
      },
      cell: ({ row }) => catalog?.types.find((entry) => entry.id === row.original.typeId)?.name ?? "—",
    },
  ];
}

export function InventoryList() {
  const searchItemNameOrCodePlaceholder = useCopy("inventory-lists.inventory-list.search-item-name-or-code.placeholder", "Search item name or code…");
  const navigate = useNavigate();
  const { actor, can } = usePermissions();
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState<ItemKind | "">("");
  const [categoryId, setCategoryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [archived, setArchived] = useState(false);
  const [create, setCreate] = useState(false);
  // Search and filters run on the server across every item (FLOW-179/180).
  const term = useDebounced(search.trim());
  const items = usePagedList(
    ["inventory-items", "list", archived, kind, categoryId, typeId, sectionId, term],
    (cursor) =>
      inventoryApi.list(
        {
          archived,
          kind: kind || undefined,
          categoryId: categoryId || undefined,
          typeId: typeId || undefined,
          sectionId: sectionId || undefined,
          search: term || undefined,
        },
        cursor,
      ),
  );
  const deletable = useDeletable("inventory_item", () => items.reload());
  const catalog = useResource(["inventory-categories"], inventoryCategoriesApi.list, { reference: true });
  const canEdit = (item: InventoryItem) => can("inventory.write") && (item.kind === "consumable" || can("rentals.apply_directly"));
  const save = async (item: InventoryItem, field: string, value: string) => {
    await inventoryApi.inline(item.id, field, value, item.updatedAt);
    items.reload();
  };
  const data = items.data ?? [];
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    { accessorKey: "name", header: "Item", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "name", value) } },
    {
      accessorKey: "code",
      header: "Code",
      cell: (c) => (
        <span className="sku">{(c.getValue() as string) || "—"}</span>
      ),
      meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "code", value) },
    },
    {
      id: "kind",
      header: "Kind",
      accessorFn: (item) =>
        [kindLabels[item.kind], subtypeLabel(item.subtype)]
          .filter(Boolean)
          .join(" · "),
      cell: ({ row }) =>
        joined([
          <LabelT id="labels.item-kind" value={row.original.kind}>{kindLabels[row.original.kind]}</LabelT>,
          subtypeLabel(row.original.subtype),
        ]),
    },
    ...classificationColumns(catalog.data, save, canEdit, can("inventory.sections"), () => catalog.refresh()),
    { accessorKey: "category", header: "Legacy category", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "legacyCategory", value) } },
    // FLOW-275: the three parts of "Group / variant", each editable on its own.
    { accessorKey: "group", header: "Group", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "group", value) } },
    { accessorKey: "tier", header: "Tier", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "tier", value) } },
    { accessorKey: "color", header: "Color", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "color", value) } },
    {
      id: "quantity",
      header: "On hand",
      accessorFn: (item) =>
        item.kind === "service" ? null : item.totalQuantity,
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
        title={<T id="inventory-lists.inventory-list.inventory">Inventory</T>}
        subtitle={<T id="inventory-lists.inventory-list.rentals-decor-kitchen-bar-and">Rentals, decor, kitchen, bar and supplies, and the services you sell.</T>}
        eyebrow={<T id="inventory-lists.inventory-list.stock-supplies">{"STOCK & SUPPLIES"}</T>}
      >
        <Button variant="outline" asChild>
          <Link to="/inventory/master"><T id="inventory-lists.inventory-list.master-sheet">Master sheet</T></Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/inventory/orders"><T id="inventory-lists.inventory-list.order-lists">Order lists</T></Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/approvals"><T id="inventory-lists.inventory-list.approvals">Approvals</T></Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/inventory/ingredients"><T id="inventory-lists.inventory-list.ingredients">Ingredients</T></Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/inventory/bar"><T id="inventory-lists.inventory-list.bar">Bar</T></Link>
        </Button>
        <Button variant="outline" asChild>
          <Link to="/inventory/supplies"><T id="inventory-lists.inventory-list.supplies">Supplies</T></Link>
        </Button>
        <Allowed action="inventory.count">
          <Button variant="outline" asChild>
            <Link to="/inventory/counts"><T id="inventory-lists.inventory-list.counts">Counts</T></Link>
          </Button>
        </Allowed>
        <Button variant="outline" asChild>
          <Link to="/inventory/low-stock"><T id="inventory-lists.inventory-list.low-stock">Low stock</T></Link>
        </Button>
        <Allowed action="inventory.sections">
          <Button variant="outline" asChild>
            <Link to="/inventory/sections"><T id="inventory-lists.inventory-list.sections">Sections</T></Link>
          </Button>
        </Allowed>
        {actor && (can("inventory.write") || isFtPlus(actor)) && (
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            <T id="inventory-lists.inventory-list.new-item">New Item</T>
          </Button>
        )}
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={searchItemNameOrCodePlaceholder} copyId="inventory-lists.inventory-list.search-item-name-or-code.placeholder"
        />
        <Dropdown
          aria-label="Kind"
          value={kind}
          onChange={(e) => { setKind(e.target.value as ItemKind | ""); setCategoryId(""); setTypeId(""); }}
        >
          <option value="">All kinds</option>
          {itemKindSchema.options.map((option) => (
            <option key={option} value={option}>
              {kindLabels[option]}
            </option>
          ))}
        </Dropdown>
        <ClassificationFilters kind={kind || "all"} categoryId={categoryId} typeId={typeId} onCategory={setCategoryId} onType={setTypeId} />
        <SectionFilter value={sectionId} onChange={setSectionId} />
        <label className="checkbox-filter">
          <RoundCheck
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          <T id="inventory-lists.inventory-list.show-archived">Show archived</T>
        </label>
        <span className="result-count">
          {items.hasMore ? <T id="inventory-lists.inventory-list.items" values={{ dataCount: data.length }}>{"{dataCount}+ items"}</T> : <T id="inventory-lists.inventory-list.items-2" values={{ dataCount: data.length }}>{"{dataCount} items"}</T>}
        </span>
      </FilterBar>
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : (
        <PageGrid pageKey="inventory.list">
          <Block id="list" name="List" h={24}>
          <DataTable selection={{ rowId: (row) => row.id, ...deletable }} copyKey="inventory-lists.inventory-list"
            data={data}
            columns={columns}
            openColumn
            onRow={(item) => navigate(`/inventory/${item.id}`)}
            label={<T id="inventory-lists.inventory-list.items-3">items</T>}
            exportName="inventory"
            exportAll={items.loadAll}
          />
          <LoadMore list={items} label={<T id="inventory-lists.inventory-list.load-more-items">Load more items</T>} />
        </Block>
          </PageGrid>
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
export function IngredientList({
  supplies = false,
}: { supplies?: boolean } = {}) {
  const searchSuppliesPlaceholder = useCopy("inventory-lists.ingredient-list.search-supplies.placeholder", "Search supplies…");
  const searchIngredientsPlaceholder = useCopy("inventory-lists.ingredient-list.search-ingredients.placeholder", "Search ingredients…");
  const vendorPlaceholder = useCopy("inventory-lists.ingredient-list.vendor.placeholder", "Vendor");
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [vendor, setVendor] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [belowPar, setBelowPar] = useState(false);
  const [create, setCreate] = useState(false);
  const term = useDebounced(search.trim());
  const vendorTerm = useDebounced(vendor.trim());
  const items = usePagedList(
    ["inventory-items", "ingredients", supplies, category, categoryId, typeId, sectionId, belowPar, term, vendorTerm],
    (cursor) =>
      inventoryApi.list(
        {
          kind: "consumable",
          subtype: supplies ? "supply" : "ingredient",
          category: category || undefined,
          categoryId: categoryId || undefined,
          typeId: typeId || undefined,
          sectionId: sectionId || undefined,
          belowPar,
          search: term || undefined,
          vendor: vendorTerm || undefined,
        },
        cursor,
      ),

  );
  const deletable = useDeletable("inventory_item", () => items.reload());
  const catalog = useResource(["inventory-categories"], inventoryCategoriesApi.list, { reference: true });
  const canEdit = () => can("inventory.write");
  const storageSections = useResource(["sections", { kind: "consumable" }], () => sectionsApi.list({ kind: "consumable" }), { reference: true });
  const save = async (item: InventoryItem, field: string, value: string) => {
    await inventoryApi.inline(item.id, field, value, item.updatedAt);
    items.reload();
  };
  // Business settings' categories (FLOW-45), archived ones included so old items
  // can still be found.
  const listed = useListLabels(
    supplies ? "supply_category" : "ingredient_category",
  );
  const categories = [
    ...new Set([...listed, ...(items.data ?? []).map((item) => item.category)]),
  ].filter(Boolean);
  const data = items.data ?? [];
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    { accessorKey: "name", header: supplies ? "Supply" : "Ingredient", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "name", value) } },
    ...classificationColumns(catalog.data, save, canEdit, can("inventory.sections"), () => catalog.refresh()),
    { accessorKey: "category", header: "Legacy category", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "legacyCategory", value) } },
    ...purchaseColumns(save, canEdit),
    {
      id: "recipeUnit",
      header: "Recipe unit",
      accessorFn: (item) =>
        item.consumable?.recipeUnit
          ? unitLabel(item.consumable.recipeUnit)
          : "—",
      meta: { edit: "select", canEdit, editValue: (item) => item.consumable?.recipeUnit ?? "",
        editOptions: [{ value: "", label: "None" }, ...unitSchema.options.map((unit) => ({ value: unit, label: unitLabel(unit) }))],
        onEdit: (item, value) => save(item, "consumable.recipeUnit", value) },
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
      accessorFn: (item) => item.consumable?.preferredVendor ?? "",
      meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "consumable.preferredVendor", value) },
    },
    {
      id: "storage",
      header: "Storage",
      accessorFn: (item) => item.consumable?.storageSectionName ?? "—",
      meta: { edit: "select", canEdit, editValue: (item) => item.consumable?.storageSectionId ?? "",
        editOptions: [{ value: "", label: "None" }, ...(storageSections.data ?? []).map((section) => ({ value: section.id, label: section.name }))],
        onEdit: (item, value) => save(item, "consumable.storageSectionId", value) },
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
            <span className="badge warning"><T id="inventory-lists.ingredient-list.below-par">Below par</T></span>
          )}
        </>
      ),
    },
  ];
  return (
    <>
      <Link to="/inventory" className="back-link">
        <T id="inventory-lists.ingredient-list.all-inventory">← All inventory</T>
      </Link>
      <PageHeader
        title={supplies ? <T id="inventory-lists.ingredient-list.supplies">Supplies</T> : <T id="inventory-lists.ingredient-list.ingredients">Ingredients</T>}
        subtitle={
          supplies
            ? <T id="inventory-lists.ingredient-list.disposables-pack-sizes-stock-and">Disposables, pack sizes, stock and low-stock supplies.</T>
            : <T id="inventory-lists.ingredient-list.what-the-kitchen-buys-how">{"What the kitchen buys, how it's used in recipes, and where it's kept."}</T>
        }
        eyebrow={supplies ? <T id="inventory-lists.ingredient-list.supplies-2">SUPPLIES</T> : <T id="inventory-lists.ingredient-list.kitchen">KITCHEN</T>}
      >
        {supplies && (
          <>
            <Allowed action="inventory.count">
              <Button variant="outline" asChild>
                <Link to="/inventory/counts"><T id="inventory-lists.ingredient-list.count">Count</T></Link>
              </Button>
            </Allowed>
            <Button variant="outline" asChild>
              <Link to="/inventory/low-stock"><T id="inventory-lists.ingredient-list.low-stock">Low stock</T></Link>
            </Button>
          </>
        )}
        <Allowed action="inventory.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            {supplies ? <T id="inventory-lists.ingredient-list.new-supply">New Supply</T> : <T id="inventory-lists.ingredient-list.new-ingredient">New Ingredient</T>}
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={supplies ? searchSuppliesPlaceholder : searchIngredientsPlaceholder}
          copyId={supplies ? "inventory-lists.ingredient-list.search-supplies.placeholder" : "inventory-lists.ingredient-list.search-ingredients.placeholder"}
        />
        <Dropdown
          aria-label="Category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </Dropdown>
        <ClassificationFilters kind={supplies ? "supply" : "ingredient"} categoryId={categoryId} typeId={typeId} onCategory={setCategoryId} onType={setTypeId} />
        <input
          aria-label="Vendor"
          placeholder={vendorPlaceholder} data-copy-id="inventory-lists.ingredient-list.vendor.placeholder"
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
          <RoundCheck
            checked={belowPar}
            onChange={(e) => setBelowPar(e.target.checked)}
          />
          <T id="inventory-lists.ingredient-list.below-par-only">Below par only</T>
        </label>
        <span className="result-count">
          {data.length}
          {items.hasMore ? "+" : ""} {supplies ? <T id="inventory-lists.ingredient-list.supplies-3">supplies</T> : <T id="inventory-lists.ingredient-list.ingredients-2">ingredients</T>}
        </span>
      </FilterBar>
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : (
        <>
          <DataTable selection={{ rowId: (row) => row.id, ...deletable }} copyKey="inventory-lists.ingredient-list"
            data={data}
            columns={supplies ? columns.filter((column) => column.id !== "recipeUnit") : columns}
            openColumn
            onRow={(item) => navigate(`/inventory/${item.id}`)}
            label={supplies ? <T id="inventory-lists.ingredient-list.supplies-3">supplies</T> : <T id="inventory-lists.ingredient-list.ingredients-2">ingredients</T>}
            exportName={supplies ? "supplies" : "ingredients"}
            exportAll={items.loadAll}
          />
          <LoadMore list={items} label={supplies ? <T id="inventory-lists.ingredient-list.load-more-supplies">Load more supplies</T> : <T id="inventory-lists.ingredient-list.load-more-ingredients">Load more ingredients</T>} />
        </>
      )}
      {create && (
        <ItemForm
          preset={{
            kind: "consumable",
            subtype: supplies ? "supply" : "ingredient",
          }}
          onClose={() => setCreate(false)}
          onSaved={() => items.reload()}
        />
      )}
    </>
  );
}

export function SuppliesList() {
  return <IngredientList supplies />;
}

// Bar stock (FLOW-90): consumables of subtype bar, counted, flagged below par and
// costed like ingredients.
export function BarList() {
  const searchNameOrBrandPlaceholder = useCopy("inventory-lists.bar-list.search-name-or-brand.placeholder", "Search name or brand…");
  const distributorPlaceholder = useCopy("inventory-lists.bar-list.distributor.placeholder", "Distributor");
  const navigate = useNavigate();
  const { can } = usePermissions();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [tier, setTier] = useState("");
  const [distributor, setDistributor] = useState("");
  const [belowPar, setBelowPar] = useState(false);
  const [create, setCreate] = useState(false);
  const term = useDebounced(search.trim());
  const distributorTerm = useDebounced(distributor.trim());
  const items = usePagedList(
    ["inventory-items", "bar", category, categoryId, typeId, subcategory, tier, belowPar, term, distributorTerm],
    (cursor) =>
      inventoryApi.list(
        {
          kind: "consumable",
          subtype: "bar",
          category: category || undefined,
          categoryId: categoryId || undefined,
          typeId: typeId || undefined,
          subcategory: subcategory || undefined,
          tier: tier || undefined,
          belowPar,
          search: term || undefined,
          vendor: distributorTerm || undefined,
        },
        cursor,
      ),
  );
  const deletable = useDeletable("inventory_item", () => items.reload());
  const catalog = useResource(["inventory-categories"], inventoryCategoriesApi.list, { reference: true });
  const canEdit = () => can("inventory.write");
  const save = async (item: InventoryItem, field: string, value: string) => {
    await inventoryApi.inline(item.id, field, value, item.updatedAt);
    items.reload();
  };
  const data = items.data ?? [];
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    { accessorKey: "name", header: "Item", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "name", value) } },
    {
      id: "brand",
      header: "Brand / varietal",
      accessorFn: (item) => item.bar?.brand ?? "",
      meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "bar.brand", value) },
    },
    ...classificationColumns(catalog.data, save, canEdit, can("inventory.sections"), () => catalog.refresh()),
    { accessorKey: "category", header: "Bar category", meta: { edit: "select", canEdit,
      editOptions: barCategories.map((entry) => ({ value: entry, label: entry })),
      onEdit: (item, value) => save(item, "legacyCategory", value) } },
    { id: "subcategory", header: "Bar subcategory", accessorFn: (item) => item.bar?.subcategory ?? "",
      meta: { edit: "select", canEdit,
        editOptions: (item) => [{ value: "", label: "None" }, ...(barSubcategories[item.category] ?? []).map((entry) => ({ value: entry, label: entry }))],
        onEdit: (item, value) => save(item, "bar.subcategory", value) } },
    {
      id: "tier",
      header: "Tier",
      accessorFn: (item) => barTierLabel(item.tier) || "—",
      meta: { edit: "select", canEdit, editValue: (item) => item.tier,
        editOptions: [{ value: "", label: "None" }, ...barTierSchema.options.map((tier) => ({ value: tier, label: barTierLabels[tier] }))],
        onEdit: (item, value) => save(item, "tier", value) },
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
      // The container is edited here; its size is part of "Bought as" on the item page.
      meta: { edit: "select", canEdit, editValue: (item) => item.bar?.container ?? "",
        editDisplay: (item) => [
          item.bar?.container ? barContainerLabels[item.bar.container] : "",
          item.consumable?.eachSize ? `${Number(item.consumable.eachSize.quantity)} ${unitLabel(item.consumable.eachSize.unit)}` : "",
        ].filter(Boolean).join(" "),
        editOptions: [{ value: "", label: "None" }, ...(Object.keys(barContainerLabels) as (keyof typeof barContainerLabels)[])
          .map((container) => ({ value: container, label: barContainerLabels[container] }))],
        onEdit: (item, value) => save(item, "bar.container", value) },
      cell: ({ row }) => {
        const item = row.original;
        const size = item.consumable?.eachSize
          ? `${Number(item.consumable.eachSize.quantity)} ${unitLabel(item.consumable.eachSize.unit)}`
          : "";
        if (!item.bar?.container) return size || "—";
        return joined([<LabelT id="labels.bar-container" value={item.bar.container}>{barContainerLabels[item.bar.container]}</LabelT>, size], " ");
      },
    },
    ...purchaseColumns(save, canEdit),
    {
      id: "distributor",
      header: "Distributor",
      accessorFn: (item) => item.consumable?.preferredVendor || "—",
      meta: { edit: "text", canEdit, editValue: (item) => item.consumable?.preferredVendor ?? "",
        onEdit: (item, value) => save(item, "consumable.preferredVendor", value) },
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
            <span className="badge warning"><T id="inventory-lists.bar-list.below-par">Below par</T></span>
          )}
        </>
      ),
    },
  ];
  return (
    <>
      <Link to="/inventory" className="back-link">
        <T id="inventory-lists.bar-list.all-inventory">← All inventory</T>
      </Link>
      <PageHeader
        title={<T id="inventory-lists.bar-list.bar">Bar</T>}
        subtitle={<T id="inventory-lists.bar-list.beer-wine-and-liquor-what">{"Beer, wine and liquor: what's in stock, what's low, and who supplies it."}</T>}
        eyebrow={<T id="inventory-lists.bar-list.bar-2">BAR</T>}
      >
        <Allowed action="inventory.count">
          <Button variant="outline" asChild>
            <Link to="/inventory/counts">
              <ClipboardCheck size={16} />
              <T id="inventory-lists.bar-list.count">Count</T>
            </Link>
          </Button>
        </Allowed>
        <Allowed action="inventory.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            <T id="inventory-lists.bar-list.new-bar-item">New Bar Item</T>
          </Button>
        </Allowed>
      </PageHeader>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={searchNameOrBrandPlaceholder} copyId="inventory-lists.bar-list.search-name-or-brand.placeholder"
        />
        <ClassificationFilters kind="bar" categoryId={categoryId} typeId={typeId} onCategory={setCategoryId} onType={setTypeId} />
        <Dropdown
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
        </Dropdown>
        <Dropdown
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
        </Dropdown>
        <Dropdown
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
        </Dropdown>
        <input
          aria-label="Distributor"
          placeholder={distributorPlaceholder} data-copy-id="inventory-lists.bar-list.distributor.placeholder"
          value={distributor}
          onChange={(e) => setDistributor(e.target.value)}
        />
        <label className="checkbox-filter">
          <RoundCheck
            checked={belowPar}
            onChange={(e) => setBelowPar(e.target.checked)}
          />
          <T id="inventory-lists.bar-list.below-par-only">Below par only</T>
        </label>
        <span className="result-count">
          {items.hasMore ? <T id="inventory-lists.bar-list.bar-items" values={{ dataCount: data.length }}>{"{dataCount}+ bar items"}</T> : <T id="inventory-lists.bar-list.bar-items-2" values={{ dataCount: data.length }}>{"{dataCount} bar items"}</T>}
        </span>
      </FilterBar>
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : (
        <>
          <DataTable selection={{ rowId: (row) => row.id, ...deletable }} copyKey="inventory-lists.bar-list"
            data={data}
            columns={columns}
            openColumn
            onRow={(item) => navigate(`/inventory/${item.id}`)}
            label={<T id="inventory-lists.bar-list.bar-items-3">bar items</T>}
            exportName="bar"
            exportAll={items.loadAll}
          />
          <LoadMore list={items} label={<T id="inventory-lists.bar-list.load-more-bar-items">Load more bar items</T>} />
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
