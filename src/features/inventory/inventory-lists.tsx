import { useDeletable } from "../../app/live-edit/deletable";
import { Dropdown } from "../../components/ui/Dropdown";
import { Allowed } from "../../app/permissions";
import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { usePermissions } from "../../app/permissions";
import { isFtPlus } from "../../../shared/access";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  barCategories,
  barContainerLabels,
  barSubcategories,
  barTierLabels,
  barTierSchema,
  type InventoryItem,
  type SectionKind,
} from "../../../shared/inventory";
import { unitLabel, unitSchema } from "../../../shared/units";
import { inventoryApi, sectionsApi } from "../../services/core";
import { inventoryCategoriesApi } from "../../services/inventory-categories";
import { useResource } from "../../app/useResource";
import { LoadMore, useDebounced, usePagedList } from "../../app/paging";
import {
  Button,
  SearchInput,
  FilterBar,
  DataTable,
  LoadingSkeleton,
} from "../../components/shared";
import { LoadError } from "../../components/record-display";
import { ItemForm } from "./inventory-item-form";
import { useListLabels } from "../common/list-fields";
import {
  barTierLabel,
  centsLabel,
  dateTimeLabel,
  purchaseLabel,
  quantityLabel,
} from "./inventory-labels";
import "./inventory.css";
import { IngredientBulkActions, IngredientStockPill, KitchenHeading, ingredientStockText } from "../kitchen/kitchen-screen";
import { InventoryHeading, StockPill, stockLabel, stockState } from "./inventory-screen";
import { StartCount } from "./stock-counts";
import { RoundCheck } from "../../components/ui/round-check";
import { T, useCopy, LabelT, joined } from "../../app/copy";

// Unit cost in a CSV file: dollars without formatting, blank when unknown.
const costCsv = (item: InventoryItem) => {
  const cents = item.consumable?.unitCostCents;
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
};

function SectionFilter({
  value,
  onChange,
  kind,
  label = "Location",
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
      {(catalog.data?.categories ?? []).filter((entry) => entry.kind === kind ||
        // The Master list holds rentals, services and supplies (FLOW-289).
        (kind === "master" && ["rental", "service", "supply"].includes(entry.kind)))
        .map((entry) => <option key={entry.id} value={entry.id}>{kind === "master" ? `${entry.kind} · ${entry.name}` : entry.name}</option>)}
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

// When an item's stock was last counted, and by whom (FLOW-291, from the old
// Counts page).
function countedColumns(): ColumnDef<InventoryItem, unknown>[] {
  return [
    {
      id: "lastCounted",
      header: "Last counted",
      accessorFn: (item) => item.lastCountedAt ?? "",
      cell: ({ row }) => (row.original.lastCountedAt ? dateTimeLabel(row.original.lastCountedAt) : "—"),
    },
    {
      id: "lastCountedBy",
      header: "Last counted by",
      accessorFn: (item) => item.lastCountedBy ?? "—",
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

// The Inventory screen's Inventory tab (FLOW-266, FLOW-291): the Master inventory
// list (rentals, decor, supplies and services; bar stock and ingredients have
// their own lists). Filters (category, type, vendor, location, below par) and
// the "Inventory" table: Open, Item, Kind (always "Rental"), Category, Type, On
// hand (the total; the item page shows each location), Par, Stock, Storage,
// Vendor, Unit cost, how it's bought, Last counted and Last counted by, then the
// item's other stored fields (FLOW-275). On hand comes from counts and Unit cost
// from receiving, so neither is edited here. Bulk: Move to storage and Set vendor
// (stocked items), Delete (reserved items are skipped).
export function InventoryList() {
  const navigate = useNavigate();
  const { actor, can } = usePermissions();
  const [categoryId, setCategoryId] = useState("");
  const [typeId, setTypeId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [vendor, setVendor] = useState("");
  const [belowPar, setBelowPar] = useState(false);
  const [archived, setArchived] = useState(false);
  const [create, setCreate] = useState(false);
  const [bulkError, setBulkError] = useState("");
  // Filters run on the server across every item (FLOW-179/180).
  const items = usePagedList(
    ["inventory-items", "list", archived, categoryId, typeId, sectionId, vendor, belowPar],
    (cursor) =>
      inventoryApi.list(
        {
          list: "master",
          archived,
          categoryId: categoryId || undefined,
          typeId: typeId || undefined,
          sectionId: sectionId || undefined,
          vendor: vendor || undefined,
          belowPar: belowPar || undefined,
        },
        cursor,
      ),
  );
  const deletable = useDeletable("inventory_item", () => items.reload());
  const catalog = useResource(["inventory-categories"], inventoryCategoriesApi.list, { reference: true });
  const storage = useResource(["sections", { kind: "location" }], () => sectionsApi.list({ kind: "location" }), { reference: true });
  const canEdit = (item: InventoryItem) => can("inventory.write") && (item.kind === "consumable" || can("rentals.apply_directly"));
  const consumableEdit = (item: InventoryItem) => canEdit(item) && Boolean(item.consumable);
  const save = async (item: InventoryItem, field: string, value: string) => {
    await inventoryApi.inline(item.id, field, value, item.updatedAt);
    items.reload();
  };
  const data = items.data ?? [];
  const vendors = [...new Set(data.map(vendorOf).filter(Boolean))].sort();
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    { accessorKey: "name", header: "Item", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "name", value) } },
    // Every Master item reads "Rental" (FLOW-289); the item form's Admin-only
    // Stock tracking says whether it's returned, used up or not stocked.
    {
      id: "kind",
      header: "Kind",
      accessorFn: () => "Rental",
      cell: () => <T id="inventory-lists.inventory-list.rental">Rental</T>,
    },
    ...classificationColumns(catalog.data, save, canEdit, can("inventory.sections"), () => catalog.refresh()),
    {
      id: "quantity",
      header: "On hand",
      accessorFn: (item) => (item.kind === "service" ? null : item.totalQuantity),
      sortingFn: "basic",
      cell: (c) => (c.row.original.kind === "service" ? "—" : quantityLabel(c.row.original.totalQuantity, c.row.original.unit)),
    },
    {
      id: "par",
      header: "Par",
      accessorFn: (item) => item.consumable?.parLevel ?? "",
      meta: { edit: "number", canEdit: consumableEdit, onEdit: (item, value) => save(item, "consumable.parLevel", value) },
    },
    {
      id: "stock",
      header: "Stock",
      accessorFn: (item) => stockLabel(stockState(item)),
      cell: ({ row }) => <StockPill state={stockState(row.original)} />,
    },
    {
      id: "storage",
      header: "Location",
      accessorFn: (item) => item.consumable?.storageSectionName ?? item.stock.map((level) => level.sectionName).join(", "),
      meta: { edit: "select", canEdit: consumableEdit, editValue: (item) => item.consumable?.storageSectionId ?? "",
        editOptions: [{ value: "", label: "None" }, ...(storage.data ?? []).map((section) => ({ value: section.id, label: section.name }))],
        onEdit: (item, value) => save(item, "consumable.storageSectionId", value) },
    },
    {
      id: "vendor",
      header: "Vendor",
      accessorFn: vendorOf,
      meta: { edit: "text", canEdit: consumableEdit, editValue: (item) => item.consumable?.preferredVendor ?? "",
        onEdit: (item, value) => save(item, "consumable.preferredVendor", value) },
    },
    {
      id: "cost",
      header: "Unit cost",
      accessorFn: (item) => item.consumable?.unitCostCents ?? null,
      cell: ({ row }) => (row.original.consumable?.unitCostCents == null ? "—" : centsLabel(row.original.consumable.unitCostCents)),
    },
    // The old Supplies and Counts pages' fields (FLOW-291).
    ...purchaseColumns(save, canEdit),
    ...countedColumns(),
    // The item's other stored fields, edited here too (FLOW-275).
    {
      accessorKey: "code",
      header: "Code",
      cell: (c) => <span className="sku">{(c.getValue() as string) || "—"}</span>,
      meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "code", value) },
    },
    { accessorKey: "category", header: "Legacy category", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "legacyCategory", value) } },
    { accessorKey: "group", header: "Group", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "group", value) } },
    { accessorKey: "tier", header: "Tier", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "tier", value) } },
    { accessorKey: "color", header: "Color", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "color", value) } },
  ];
  // Bulk changes on consumables; other kinds are skipped with a note.
  const bulk = async (ids: string[], clear: () => void, field: string, value: string) => {
    setBulkError("");
    const skipped: string[] = [];
    for (const id of ids) {
      const item = data.find((row) => row.id === id);
      if (!item?.consumable || !canEdit(item)) { if (item) skipped.push(item.name); continue; }
      try { await inventoryApi.inline(item.id, field, value, item.updatedAt); }
      catch (cause) { skipped.push(`${item.name} (${(cause as Error).message})`); }
    }
    if (skipped.length) setBulkError(skipped.join(", "));
    clear();
    items.reload();
  };
  const selection = {
    rowId: (row: InventoryItem) => row.id,
    ...deletable,
    actions: can("inventory.write")
      ? (ids: string[], clear: () => void) => <>
        <Dropdown variant="dark" aria-label="Move to storage" value=""
          options={[{ value: "", label: <T id="inventory-lists.inventory-list.move-to-storage">Move to storage</T>, text: "Move to storage" },
            ...(storage.data ?? []).map((section) => ({ value: section.id, label: section.name }))]}
          onValueChange={(next) => next && void bulk(ids, clear, "consumable.storageSectionId", next)} />
        <BulkVendor onSet={(name) => bulk(ids, clear, "consumable.preferredVendor", name)} />
      </>
      : undefined,
  };
  return (
    <>
      <InventoryHeading tab="inventory">
        <Allowed action="inventory.count">
          <StartCount />
        </Allowed>
        {actor && (can("inventory.write") || isFtPlus(actor)) && (
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            <T id="inventory-lists.inventory-list.new-item">New Item</T>
          </Button>
        )}
      </InventoryHeading>
      <PageGrid pageKey="inventory.list">
        <Block id="filters" name="Filters" h={3}>
          <FilterBar>
            <ClassificationFilters kind="master" categoryId={categoryId} typeId={typeId} onCategory={setCategoryId} onType={setTypeId} />
            <Dropdown
              variant="filter"
              aria-label="Vendor"
              value={vendor}
              options={[
                { value: "", label: <T id="inventory-lists.inventory-list.all-vendors">All vendors</T>, text: "All vendors" },
                ...[...new Set([...vendors, ...(vendor ? [vendor] : [])])].map((name) => ({ value: name, label: name })),
              ]}
              onValueChange={setVendor}
            />
            <SectionFilter value={sectionId} onChange={setSectionId} kind="location" />
            <label className="checkbox-filter">
              <RoundCheck checked={belowPar} onChange={(e) => setBelowPar(e.target.checked)} />
              <T id="inventory-lists.inventory-list.below-par-only">Below par only</T>
            </label>
            <label className="checkbox-filter">
              <RoundCheck checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              <T id="inventory-lists.inventory-list.show-archived">Show archived</T>
            </label>
          </FilterBar>
        </Block>
        <Block id="list" name="List" h={24}>
          {bulkError && <p role="alert" className="error-message"><T id="inventory-lists.inventory-list.skipped" values={{ names: bulkError }}>{"Skipped: {names}"}</T></p>}
          {items.error ? (
            <LoadError message={items.error} />
          ) : items.loading && !items.data ? (
            <LoadingSkeleton />
          ) : (
            <>
              <div className="section-heading"><h2><T id="inventory-lists.inventory-list.table-title">Inventory</T></h2></div>
              <DataTable selection={selection} copyKey="inventory-lists.inventory-list"
                data={data}
                columns={columns}
                openColumn
                onRow={(item) => navigate(`/inventory/${item.id}`)}
                label={<T id="inventory-lists.inventory-list.items-3">items</T>}
                exportName="inventory"
                exportAll={items.loadAll}
              />
              <LoadMore list={items} label={<T id="inventory-lists.inventory-list.load-more-items">Load more items</T>} />
              <p className="table-hint">
                <T id="inventory-lists.inventory-list.click-a-cell-to-edit">{"Click a cell to edit it (On hand changes through a stock count; Unit cost comes from receiving). Category and Type dropdowns let Admins add new ones. Drag, Shift+click or Ctrl/Cmd+click to select; Delete or Ctrl+Z."}</T>
              </p>
            </>
          )}
        </Block>
      </PageGrid>
      {create && (
        <ItemForm
          onClose={() => setCreate(false)}
          onSaved={(item) => navigate(`/inventory/${item.id}`)}
        />
      )}
    </>
  );
}

const vendorOf = (item: InventoryItem) => item.consumable?.preferredVendor || item.rental?.vendorName || "";

// "Set vendor" in the bulk bar: a name typed once for every selected item.
function BulkVendor({ onSet }: { onSet: (name: string) => Promise<void> }) {
  const placeholder = useCopy("inventory-lists.bulk-vendor.vendor-name.placeholder", "Vendor name");
  const [name, setName] = useState("");
  return (
    <form className="bulk-inline-form" onSubmit={(event) => { event.preventDefault(); if (name.trim()) void onSet(name.trim()).then(() => setName("")); }}>
      <input aria-label="Vendor for selected items" placeholder={placeholder} data-copy-id="inventory-lists.bulk-vendor.vendor-name.placeholder"
        value={name} onChange={(event) => setName(event.target.value)} />
      <Button type="submit" variant="outline" disabled={!name.trim()}><T id="inventory-lists.bulk-vendor.set-vendor">Set vendor</T></Button>
    </form>
  );
}

// The kitchen ingredient catalog (FLOW-81, FLOW-289): the Kitchen Ingredients
// list, at /kitchen/ingredients.
export function IngredientList() {
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
  const [bulkError, setBulkError] = useState("");
  const term = useDebounced(search.trim());
  const vendorTerm = useDebounced(vendor.trim());
  const items = usePagedList(
    ["inventory-items", "ingredients", category, categoryId, typeId, sectionId, belowPar, term, vendorTerm],
    (cursor) =>
      inventoryApi.list(
        {
          list: "kitchen",
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
  // Kitchen Ingredients are the kitchen's list (FLOW-289).
  const canEdit = () => can("recipes.write");
  const storageSections = useResource(["sections", { kind: "storage" }], () => sectionsApi.list({ kind: "storage" }), { reference: true });
  const save = async (item: InventoryItem, field: string, value: string) => {
    await inventoryApi.inline(item.id, field, value, item.updatedAt);
    items.reload();
  };
  // Business settings' categories (FLOW-45), archived ones included so old items
  // can still be found.
  const listed = useListLabels("ingredient_category");
  const categories = [
    ...new Set([...listed, ...(items.data ?? []).map((item) => item.category)]),
  ].filter(Boolean);
  const data = items.data ?? [];
  const columns: ColumnDef<InventoryItem, unknown>[] = [
    { accessorKey: "name", header: "Ingredient", meta: { edit: "text", canEdit, onEdit: (item, value) => save(item, "name", value) } },
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
    // FLOW-267: par and the stock state.
    {
      id: "par",
      header: "Par",
      accessorFn: (item) => item.consumable?.parLevel ?? "",
      meta: { edit: "number", canEdit, onEdit: (item, value) => save(item, "consumable.parLevel", value) },
    },
    {
      id: "stock",
      header: "Stock",
      accessorFn: ingredientStockText,
      cell: ({ row }) => <IngredientStockPill item={row.original} />,
    },
  ];
  // Bulk on the Kitchen › Ingredients tab (FLOW-267): Move to storage, Set vendor.
  const applyBulk = (ids: string[], clear: () => void) => async (field: string, value: string) => {
    setBulkError("");
    const failed: string[] = [];
    for (const id of ids) {
      const item = data.find((row) => row.id === id);
      if (!item) continue;
      try { await inventoryApi.inline(item.id, field, value, item.updatedAt); }
      catch (cause) { failed.push(`${item.name} (${(cause as Error).message})`); }
    }
    if (failed.length) setBulkError(failed.join(", "));
    clear();
    items.reload();
  };
  return (
    <>
      <KitchenHeading tab="ingredients">
        {/* FLOW-292: what's below par is ordered from the Order tab. */}
        <Button variant="outline" asChild>
          <Link to="/inventory/order#kitchen"><T id="inventory-lists.ingredient-list.order">Order</T></Link>
        </Button>
        <Allowed action="inventory.count">
          <StartCount kind="storage" />
        </Allowed>
        <Allowed action="recipes.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            <T id="inventory-lists.ingredient-list.new-ingredient">New Ingredient</T>
          </Button>
        </Allowed>
      </KitchenHeading>
      {bulkError && <p role="alert" className="error-message"><T id="inventory-lists.ingredient-list.not-changed" values={{ names: bulkError }}>{"Not changed: {names}"}</T></p>}
      <PageGrid pageKey="inventory.consumables">
        <Block id="filters" name="Filters" h={3}>
      <FilterBar>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={searchIngredientsPlaceholder}
          copyId="inventory-lists.ingredient-list.search-ingredients.placeholder"
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
        <ClassificationFilters kind="ingredient" categoryId={categoryId} typeId={typeId} onCategory={setCategoryId} onType={setTypeId} />
        <input
          aria-label="Vendor"
          placeholder={vendorPlaceholder} data-copy-id="inventory-lists.ingredient-list.vendor.placeholder"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        />
        <SectionFilter
          value={sectionId}
          onChange={setSectionId}
          kind="storage"
          label="Storage area"
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
          {items.hasMore ? "+" : ""} <T id="inventory-lists.ingredient-list.ingredients-2">ingredients</T>
        </span>
      </FilterBar>
        </Block>
        {!items.error && items.data && (
          <Block id="list" name="List" h={24}>
          <DataTable copyKey="inventory-lists.ingredient-list"
            selection={{
              rowId: (row) => row.id,
              ...deletable,
              actions: can("recipes.write")
                ? (ids, clear) => <IngredientBulkActions sections={storageSections.data ?? []} onApply={applyBulk(ids, clear)} />
                : undefined,
            }}
            data={data}
            columns={columns}
            openColumn
            onRow={(item) => navigate(`/inventory/${item.id}`)}
            label={<T id="inventory-lists.ingredient-list.ingredients-2">ingredients</T>}
            exportName="ingredients"
            exportAll={items.loadAll}
          />
          <LoadMore list={items} label={<T id="inventory-lists.ingredient-list.load-more-ingredients">Load more ingredients</T>} />
          </Block>
        )}
      </PageGrid>
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : null}
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

// Bar stock (FLOW-90, FLOW-289): the Bar Inventory list, counted, flagged below
// par and costed like ingredients. Bar stock is kept at locations, but no bar
// screen shows them.
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
          list: "bar",
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
    // FLOW-266: par and the stock state, as on the Inventory tab.
    {
      id: "par",
      header: "Par",
      accessorFn: (item) => item.consumable?.parLevel ?? "",
      meta: { edit: "number", canEdit, onEdit: (item, value) => save(item, "consumable.parLevel", value) },
    },
    {
      id: "stock",
      header: "Stock",
      accessorFn: (item) => stockLabel(stockState(item)),
      cell: ({ row }) => <StockPill state={stockState(row.original)} />,
    },
  ];
  // Bulk: Set tier (FLOW-266).
  const [bulkError, setBulkError] = useState("");
  const setTiers = async (ids: string[], clear: () => void, value: string) => {
    setBulkError("");
    const failed: string[] = [];
    for (const id of ids) {
      const item = data.find((row) => row.id === id);
      if (!item) continue;
      try { await inventoryApi.inline(item.id, "tier", value, item.updatedAt); }
      catch (cause) { failed.push(`${item.name} (${(cause as Error).message})`); }
    }
    if (failed.length) setBulkError(failed.join(", "));
    clear();
    items.reload();
  };
  return (
    <>
      <InventoryHeading tab="bar">
        <Allowed action="inventory.count">
          <StartCount />
        </Allowed>
        <Allowed action="inventory.write">
          <Button onClick={() => setCreate(true)}>
            <Plus size={16} />
            <T id="inventory-lists.bar-list.new-bar-item">New Bar Item</T>
          </Button>
        </Allowed>
      </InventoryHeading>
      {bulkError && <p role="alert" className="error-message"><T id="inventory-lists.bar-list.not-changed" values={{ names: bulkError }}>{"Not changed: {names}"}</T></p>}
      <PageGrid pageKey="inventory.bar">
        <Block id="filters" name="Filters" h={3}>
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
        </Block>
        {!items.error && items.data && (
          <Block id="list" name="List" h={24}>
          <DataTable copyKey="inventory-lists.bar-list"
            selection={{
              rowId: (row) => row.id,
              ...deletable,
              actions: can("inventory.write")
                ? (ids, clear) => <Dropdown variant="dark" aria-label="Set tier" value=""
                  options={[{ value: "", label: <T id="inventory-lists.bar-list.set-tier">Set tier</T>, text: "Set tier" },
                    ...barTierSchema.options.map((option) => ({ value: option, label: barTierLabels[option] }))]}
                  onValueChange={(next) => next && void setTiers(ids, clear, next)} />
                : undefined,
            }}
            data={data}
            columns={columns}
            openColumn
            onRow={(item) => navigate(`/inventory/${item.id}`)}
            label={<T id="inventory-lists.bar-list.bar-items-3">bar items</T>}
            exportName="bar"
            exportAll={items.loadAll}
          />
          <LoadMore list={items} label={<T id="inventory-lists.bar-list.load-more-bar-items">Load more bar items</T>} />
          </Block>
        )}
      </PageGrid>
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : null}
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
