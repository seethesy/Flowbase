import { Allowed } from "../app/permissions";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  Plus,
  Pencil,
  Archive,
  RotateCcw,
  ArrowLeftRight,
  ClipboardCheck,
  AlertTriangle,
  PackagePlus,
} from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  allergenLabels,
  allergenSchema,
  barCategories,
  barContainerLabels,
  barContainerSchema,
  barSubcategories,
  barTierLabels,
  barTierSchema,
  costSourceLabels,
  ingredientCategories,
  movementDirection,
  movementTypeLabels,
  itemKindSchema,
  ratioBasisLabels,
  ratioBasisSchema,
  recipeUnitProblem,
  sectionKindFor,
  sectionKindLabels,
  sectionKindSchema,
  subtypesByKind,
  type Allergen,
  type BarContainer,
  type BarTier,
  type InventoryItem,
  type ItemInput,
  type ItemKind,
  type MovementInput,
  type RatioBasis,
  type Section as StockSection,
  type SectionKind,
  type StockMovement,
} from "../../shared/inventory";
import { utcToBusinessTime } from "../../shared/time";
import { unitLabel, unitSchema, type Unit } from "../../shared/units";
import { inventoryApi, sectionsApi } from "../services/core";
import { useResource } from "../app/useResource";
import {
  PageHeader,
  Button,
  SearchInput,
  FilterBar,
  DataTable,
  Section,
  ConfirmationDialog,
  DetailDrawer,
  FormField,
  LoadingSkeleton,
} from "../components/shared";
import { LoadError } from "./clients";
import { Attachments } from "./attachments";

// Inventory (FLOW-69/70/81/71/83/90): every item Flowbase tracks or sells, the
// sections stock lives in, the kitchen's ingredient catalog, bar stock, and each
// item's movement and cost history. Count mode and the low-stock list are in
// stock-counts.tsx.
const kindLabels: Record<ItemKind, string> = {
  rental: "Rental",
  consumable: "Consumable",
  service: "Service",
};
const subtypeLabel = (subtype: string | null) =>
  subtype ? subtype[0].toUpperCase() + subtype.slice(1) : "";
export const quantityLabel = (quantity: number, unit: Unit) =>
  `${Number(quantity.toFixed(4))} ${unitLabel(unit)}`;
export const centsLabel = (cents: number | null) =>
  cents === null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(cents / 100);
export function purchaseLabel(consumable: InventoryItem["consumable"]) {
  if (!consumable) return "—";
  const size = consumable.eachSize
    ? `${Number(consumable.eachSize.quantity)} ${unitLabel(consumable.eachSize.unit)}`
    : "";
  if (consumable.purchaseUnit === "case")
    return `case of ${consumable.packCount ?? "?"}${size && ` × ${size}`}`;
  return `${unitLabel(consumable.purchaseUnit)}${size && ` (each ≈ ${size})`}`;
}
const variantLabel = (item: InventoryItem) =>
  [item.group, item.tier, item.color].filter(Boolean).join(" · ");
export const dateTimeLabel = (iso: string) => {
  const { date, time } = utcToBusinessTime(new Date(iso));
  return `${date} ${time}`;
};
// A signed change, e.g. "+12" or "−3".
export const changeLabel = (quantity: number) =>
  `${quantity > 0 ? "+" : quantity < 0 ? "−" : "±"}${Number(Math.abs(quantity).toFixed(4))}`;
const barTierLabel = (tier: string) =>
  barTierSchema.safeParse(tier).success ? barTierLabels[tier as BarTier] : tier;

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
  const items = useResource(
    () =>
      inventoryApi.list({
        archived,
        kind: kind || undefined,
        sectionId: sectionId || undefined,
      }),
    [archived, kind, sectionId],
  );
  const data = (items.data ?? []).filter((item) =>
    `${item.code} ${item.name} ${item.group}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
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
        <span className="result-count">{data.length} items</span>
      </FilterBar>
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : (
        <DataTable
          data={data}
          columns={columns}
          onRow={(item) => navigate(`/inventory/${item.id}`)}
          label="items"
        />
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
  const items = useResource(
    () =>
      inventoryApi.list({
        kind: "consumable",
        subtype: "ingredient",
        category: category || undefined,
        sectionId: sectionId || undefined,
        belowPar,
      }),
    [category, sectionId, belowPar],
  );
  const data = (items.data ?? []).filter(
    (item) =>
      `${item.code} ${item.name}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (item.consumable?.preferredVendor ?? "")
        .toLowerCase()
        .includes(vendor.toLowerCase()),
  );
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
          {ingredientCategories.map((option) => (
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
        <span className="result-count">{data.length} ingredients</span>
      </FilterBar>
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : (
        <DataTable
          data={data}
          columns={columns}
          onRow={(item) => navigate(`/inventory/${item.id}`)}
          label="ingredients"
        />
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
  const items = useResource(
    () =>
      inventoryApi.list({
        kind: "consumable",
        subtype: "bar",
        category: category || undefined,
        subcategory: subcategory || undefined,
        tier: tier || undefined,
        belowPar,
      }),
    [category, subcategory, tier, belowPar],
  );
  const data = (items.data ?? []).filter(
    (item) =>
      `${item.code} ${item.name} ${item.bar?.brand ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (item.consumable?.preferredVendor ?? "")
        .toLowerCase()
        .includes(distributor.toLowerCase()),
  );
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
        <span className="result-count">{data.length} bar items</span>
      </FilterBar>
      {items.error ? (
        <LoadError message={items.error} />
      ) : items.loading && !items.data ? (
        <LoadingSkeleton />
      ) : (
        <DataTable
          data={data}
          columns={columns}
          onRow={(item) => navigate(`/inventory/${item.id}`)}
          label="bar items"
        />
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

const dollars = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? "" : (cents / 100).toFixed(2);
const toCents = (value: string) =>
  value.trim() === "" ? null : Math.round(Number(value) * 100);
const toNumber = (value: string) =>
  value.trim() === "" ? null : Number(value);
const numberText = (value: number | null | undefined) =>
  value === null || value === undefined ? "" : String(value);

function UnitSelect({
  label,
  value,
  onChange,
  optional,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  optional?: string;
}) {
  return (
    <FormField label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {optional && <option value="">{optional}</option>}
        {unitSchema.options.map((unit) => (
          <option key={unit} value={unit}>
            {unitLabel(unit)}
          </option>
        ))}
      </select>
    </FormField>
  );
}

type FieldName =
  | "code"
  | "name"
  | "category"
  | "description"
  | "unit"
  | "group"
  | "color"
  | "tier"
  | "ratioQuantity"
  | "ratioBasis"
  | "price"
  | "priceBasis"
  | "purchaseUnit"
  | "packCount"
  | "eachSizeQuantity"
  | "eachSizeUnit"
  | "recipeUnit"
  | "unitCost"
  | "preferredVendor"
  | "parLevel"
  | "storageSectionId"
  | "storageOrder"
  | "brand"
  | "subcategory"
  | "container";

export function ItemForm({
  item,
  preset,
  onClose,
  onSaved,
}: {
  item?: InventoryItem;
  preset?: { kind: ItemKind; subtype: string };
  onClose: () => void;
  onSaved: (item: InventoryItem) => void;
}) {
  const [kind, setKind] = useState<ItemKind>(
    item?.kind ?? preset?.kind ?? "rental",
  );
  const [subtype, setSubtype] = useState(
    item?.subtype ?? preset?.subtype ?? "equipment",
  );
  const [fields, setFields] = useState<Record<FieldName, string>>(() => ({
    code: item?.code ?? "",
    name: item?.name ?? "",
    category: item?.category ?? "",
    description: item?.description ?? "",
    unit: item?.unit ?? "each",
    group: item?.group ?? "",
    color: item?.color ?? "",
    tier: item?.tier ?? "",
    ratioQuantity: numberText(item?.ratio?.quantity),
    ratioBasis: item?.ratio?.basis ?? "per_guest",
    price: dollars(item?.rental?.priceCents ?? item?.service?.priceCents),
    priceBasis: item?.service?.priceBasis ?? "per_event",
    purchaseUnit: item?.consumable?.purchaseUnit ?? "each",
    packCount: numberText(item?.consumable?.packCount),
    eachSizeQuantity: numberText(item?.consumable?.eachSize?.quantity),
    eachSizeUnit: item?.consumable?.eachSize?.unit ?? "",
    recipeUnit: item?.consumable?.recipeUnit ?? "",
    unitCost: dollars(item?.consumable?.unitCostCents),
    preferredVendor: item?.consumable?.preferredVendor ?? "",
    parLevel: numberText(item?.consumable?.parLevel),
    storageSectionId: item?.consumable?.storageSectionId ?? "",
    storageOrder: numberText(item?.consumable?.storageOrder),
    brand: item?.bar?.brand ?? "",
    subcategory: item?.bar?.subcategory ?? "",
    container: item?.bar?.container ?? "",
  }));
  // A new bar item is kept in Bar Storage unless the user picks another section.
  const [storageTouched, setStorageTouched] = useState(Boolean(item));
  const [allergens, setAllergens] = useState<Allergen[]>(
    item?.consumable?.allergens ?? [],
  );
  const [active, setActive] = useState(item?.active ?? true);
  // An existing item whose cost came back hidden: the user isn't FT+, so the form
  // leaves the cost alone.
  const costHidden = item?.consumable?.costHidden ?? false;
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const storage = useResource(
    () =>
      kind === "consumable"
        ? sectionsApi.list({ kind: "consumable" })
        : Promise.resolve([] as StockSection[]),
    [kind],
  );
  const set = (key: FieldName) => (value: string) =>
    setFields((current) => ({ ...current, [key]: value }));
  const isBar = kind === "consumable" && subtype === "bar";
  const storageSectionId = storageTouched
    ? fields.storageSectionId
    : fields.storageSectionId ||
      (isBar
        ? ((storage.data ?? []).find(
            (section) => section.name === "Bar Storage",
          )?.id ?? "")
        : "");
  const input = (key: FieldName, props: { type?: string } = {}) => (
    <input
      type={props.type ?? "text"}
      step={props.type === "number" ? "any" : undefined}
      value={fields[key]}
      onChange={(e) => set(key)(e.target.value)}
    />
  );
  const eachSize =
    fields.eachSizeQuantity && fields.eachSizeUnit
      ? {
          quantity: Number(fields.eachSizeQuantity),
          unit: fields.eachSizeUnit as Unit,
        }
      : null;
  const consumableDraft = {
    purchaseUnit: fields.purchaseUnit as Unit,
    packCount: toNumber(fields.packCount),
    eachSize,
  };
  // FLOW-81 AC2: flag a recipe unit this ingredient can't be converted to.
  const conversionProblem =
    kind === "consumable" && fields.recipeUnit
      ? recipeUnitProblem(
          { unit: fields.unit as Unit, consumable: consumableDraft },
          fields.recipeUnit as Unit,
        )
      : null;
  const save = async () => {
    if (!fields.name.trim()) return setError("Name is required.");
    const ratioQuantity = toNumber(fields.ratioQuantity);
    const payload: ItemInput = {
      kind,
      subtype: kind === "service" ? null : subtype,
      code: fields.code,
      name: fields.name,
      category: fields.category,
      description: fields.description,
      unit: fields.unit as Unit,
      group: fields.group,
      color: fields.color,
      tier: fields.tier,
      ratio: ratioQuantity
        ? { quantity: ratioQuantity, basis: fields.ratioBasis as RatioBasis }
        : null,
      active,
      ...(kind === "rental" && {
        rental: { priceCents: toCents(fields.price) },
      }),
      ...(kind === "service" && {
        service: {
          priceCents: toCents(fields.price),
          priceBasis: fields.priceBasis as RatioBasis,
        },
      }),
      ...(kind === "consumable" && {
        consumable: {
          ...consumableDraft,
          recipeUnit: (fields.recipeUnit || null) as Unit | null,
          ...(!costHidden && { unitCostCents: toCents(fields.unitCost) }),
          preferredVendor: fields.preferredVendor,
          parLevel: toNumber(fields.parLevel),
          allergens,
          storageSectionId: storageSectionId || null,
          storageOrder: toNumber(fields.storageOrder),
        },
      }),
      ...(isBar && {
        bar: {
          brand: fields.brand,
          subcategory: barSubcategories[fields.category]?.includes(
            fields.subcategory,
          )
            ? fields.subcategory
            : "",
          container: (fields.container || null) as BarContainer | null,
        },
      }),
    };
    setSaving(true);
    setError("");
    try {
      onSaved(
        item
          ? await inventoryApi.update(item.id, payload)
          : await inventoryApi.create(payload),
      );
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const subtypes: readonly string[] = subtypesByKind[kind];
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title={
        item
          ? "Edit item"
          : preset
            ? `New ${preset.subtype === "bar" ? "bar item" : preset.subtype}`
            : "New item"
      }
      description="Saved to Flowbase."
      wide
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
        <div className="form-grid">
          <FormField label="Name *">
            <input
              value={fields.name}
              onChange={(e) => set("name")(e.target.value)}
              autoFocus
            />
          </FormField>
          <FormField label="Code / SKU">{input("code")}</FormField>
          {!item && !preset && (
            <FormField label="Kind">
              <select
                value={kind}
                onChange={(e) => {
                  const next = e.target.value as ItemKind;
                  setKind(next);
                  const options: readonly string[] = subtypesByKind[next];
                  setSubtype(options[0] ?? "");
                }}
              >
                {itemKindSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {kindLabels[option]}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {subtypes.length > 0 && !preset && (
            <FormField label="Subtype">
              <select
                value={subtype}
                onChange={(e) => setSubtype(e.target.value)}
              >
                {subtypes.map((option) => (
                  <option key={option} value={option}>
                    {subtypeLabel(option)}
                  </option>
                ))}
              </select>
            </FormField>
          )}
          {isBar ? (
            <>
              <FormField label="Category">
                <select
                  value={fields.category}
                  onChange={(e) => set("category")(e.target.value)}
                >
                  <option value="">Pick one</option>
                  {barCategories.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              </FormField>
              {barSubcategories[fields.category] && (
                <FormField label="Subcategory">
                  <select
                    value={fields.subcategory}
                    onChange={(e) => set("subcategory")(e.target.value)}
                  >
                    <option value="">Not set</option>
                    {barSubcategories[fields.category].map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                </FormField>
              )}
              <FormField label="Brand / varietal" hint="e.g. Pinot Grigio">
                {input("brand")}
              </FormField>
            </>
          ) : (
            <FormField label="Category">
              <input
                list="item-categories"
                value={fields.category}
                onChange={(e) => set("category")(e.target.value)}
              />
              <datalist id="item-categories">
                {ingredientCategories.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </FormField>
          )}
          {kind !== "service" && (
            <UnitSelect
              label="Stock unit"
              value={fields.unit}
              onChange={set("unit")}
            />
          )}
          <FormField label="Group" hint="e.g. Table Linens">
            {input("group")}
          </FormField>
          {isBar ? (
            <>
              <FormField label="Tier">
                <select
                  value={fields.tier}
                  onChange={(e) => set("tier")(e.target.value)}
                >
                  <option value="">Not set</option>
                  {barTierSchema.options.map((option) => (
                    <option key={option} value={option}>
                      {barTierLabels[option]}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField label="Container">
                <select
                  value={fields.container}
                  onChange={(e) => set("container")(e.target.value)}
                >
                  <option value="">Not set</option>
                  {barContainerSchema.options.map((option) => (
                    <option key={option} value={option}>
                      {barContainerLabels[option]}
                    </option>
                  ))}
                </select>
              </FormField>
            </>
          ) : (
            <FormField label="Tier" hint="e.g. Standard, Premium">
              {input("tier")}
            </FormField>
          )}
          <FormField label="Color / finish">{input("color")}</FormField>
        </div>
        <FormField label="Description">
          <textarea
            rows={2}
            value={fields.description}
            onChange={(e) => set("description")(e.target.value)}
          />
        </FormField>
        <div className="form-grid">
          <FormField
            label="Ratio"
            hint="e.g. 2 per guest; leave empty for none"
          >
            {input("ratioQuantity", { type: "number" })}
          </FormField>
          <FormField label="Ratio basis">
            <select
              value={fields.ratioBasis}
              onChange={(e) => set("ratioBasis")(e.target.value)}
            >
              {ratioBasisSchema.options.map((basis) => (
                <option key={basis} value={basis}>
                  {ratioBasisLabels[basis]}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        {kind === "rental" && (
          <FormField label="Price ($ per unit)">
            {input("price", { type: "number" })}
          </FormField>
        )}
        {kind === "service" && (
          <div className="form-grid">
            <FormField label="Price ($)">
              {input("price", { type: "number" })}
            </FormField>
            <FormField label="Priced">
              <select
                value={fields.priceBasis}
                onChange={(e) => set("priceBasis")(e.target.value)}
              >
                {ratioBasisSchema.options.map((basis) => (
                  <option key={basis} value={basis}>
                    {ratioBasisLabels[basis]}
                  </option>
                ))}
              </select>
            </FormField>
          </div>
        )}
        {kind === "consumable" && (
          <>
            <h3 className="form-subheading">Purchasing and units</h3>
            <div className="form-grid">
              <UnitSelect
                label="Purchase unit"
                value={fields.purchaseUnit}
                onChange={set("purchaseUnit")}
              />
              {fields.purchaseUnit === "case" && (
                <FormField label="Items per case">
                  {input("packCount", { type: "number" })}
                </FormField>
              )}
              <FormField
                label="One each is about"
                hint="e.g. 750 ml a bottle, or 8 oz a chicken breast"
              >
                {input("eachSizeQuantity", { type: "number" })}
              </FormField>
              <UnitSelect
                label="Each size unit"
                value={fields.eachSizeUnit}
                onChange={set("eachSizeUnit")}
                optional="Not set"
              />
              <UnitSelect
                label="Recipe unit"
                value={fields.recipeUnit}
                onChange={set("recipeUnit")}
                optional="Not set"
              />
              {costHidden ? (
                <p className="muted">
                  Costs are visible to full-time staff only.
                </p>
              ) : (
                <FormField
                  label={`Unit cost ($ per ${unitLabel(fields.purchaseUnit as Unit)})`}
                >
                  {input("unitCost", { type: "number" })}
                </FormField>
              )}
              <FormField label={isBar ? "Distributor" : "Preferred vendor"}>
                {input("preferredVendor")}
              </FormField>
              <FormField
                label={`Par level (${unitLabel(fields.unit as Unit)})`}
              >
                {input("parLevel", { type: "number" })}
              </FormField>
              <FormField label="Storage section">
                <select
                  value={storageSectionId}
                  onChange={(e) => {
                    setStorageTouched(true);
                    set("storageSectionId")(e.target.value);
                  }}
                >
                  <option value="">Not set</option>
                  {(storage.data ?? []).map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                label="Shelf order"
                hint="Where it sits in the section; count mode follows this order"
              >
                {input("storageOrder", { type: "number" })}
              </FormField>
            </div>
            {conversionProblem && (
              <p role="status" className="error-message">
                <AlertTriangle size={14} /> {conversionProblem} Add what one
                each weighs or holds.
              </p>
            )}
            <fieldset className="form-group" aria-label="Allergens">
              <legend>Allergens</legend>
              {allergenSchema.options.map((allergen) => (
                <label className="checkbox-filter" key={allergen}>
                  <input
                    type="checkbox"
                    checked={allergens.includes(allergen)}
                    onChange={(e) =>
                      setAllergens((current) =>
                        e.target.checked
                          ? [...current, allergen]
                          : current.filter((other) => other !== allergen),
                      )
                    }
                  />
                  {allergenLabels[allergen]}
                </label>
              ))}
            </fieldset>
          </>
        )}
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
            Save item
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

function StockForm({
  item,
  mode,
  onClose,
  onSaved,
}: {
  item: InventoryItem;
  mode: "transfer" | "count";
  onClose: () => void;
  onSaved: (item: InventoryItem) => void;
}) {
  const kind = sectionKindFor(item.kind) ?? "rental";
  const sections = useResource(() => sectionsApi.list({ kind }), [kind]);
  const [from, setFrom] = useState(item.stock[0]?.sectionId ?? "");
  const [to, setTo] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const options = (sections.data ?? []).map((section) => (
    <option key={section.id} value={section.id}>
      {section.name}
    </option>
  ));
  const save = async () => {
    const amount = toNumber(quantity);
    if (amount === null || Number.isNaN(amount))
      return setError("Enter a quantity.");
    if (!from || (mode === "transfer" && !to))
      return setError("Pick the sections.");
    setSaving(true);
    setError("");
    try {
      onSaved(
        mode === "transfer"
          ? await inventoryApi.transfer(item.id, {
              fromSectionId: from,
              toSectionId: to,
              quantity: amount,
              reason,
            })
          : await inventoryApi.count(item.id, {
              sectionId: from,
              quantity: amount,
              reason,
            }),
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
      title={mode === "transfer" ? "Transfer stock" : "Count stock"}
      description={
        mode === "transfer"
          ? "Moves stock between sections and records a transfer."
          : "Records what you counted in a section; the difference is saved as a count movement."
      }
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
        <FormField label={mode === "transfer" ? "From section" : "Section"}>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Pick a section</option>
            {options}
          </select>
        </FormField>
        {mode === "transfer" && (
          <FormField label="To section">
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Pick a section</option>
              {options}
            </select>
          </FormField>
        )}
        <FormField
          label={`${mode === "transfer" ? "Quantity" : "Counted quantity"} (${unitLabel(item.unit)})`}
        >
          <input
            type="number"
            step="any"
            min="0"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </FormField>
        <FormField label="Reason">
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {mode === "transfer" ? "Transfer" : "Save count"}
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

// Receipts, adjustments, damage or loss and usage entered by hand (FLOW-71). Pulls
// and returns come from the event pull list once it exists.
const handMovementTypes = [
  "receive",
  "adjust",
  "damage_loss",
  "consume",
] as const;

function MovementForm({
  item,
  onClose,
  onSaved,
}: {
  item: InventoryItem;
  onClose: () => void;
  onSaved: (item: InventoryItem) => void;
}) {
  const kind = sectionKindFor(item.kind) ?? "rental";
  const sections = useResource(() => sectionsApi.list({ kind }), [kind]);
  const [type, setType] =
    useState<(typeof handMovementTypes)[number]>("receive");
  const [sectionId, setSectionId] = useState(item.stock[0]?.sectionId ?? "");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const amount = toNumber(quantity);
    if (amount === null || Number.isNaN(amount) || amount === 0)
      return setError("Enter a quantity.");
    if (!sectionId) return setError("Pick a section.");
    const input: MovementInput = { type, sectionId, quantity: amount, reason };
    setSaving(true);
    setError("");
    try {
      onSaved(await inventoryApi.addMovement(item.id, input));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const direction = movementDirection[type];
  return (
    <DetailDrawer
      open
      onClose={onClose}
      title="Record movement"
      description="Adds a movement to the stock ledger. Quantities are never edited directly."
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
        <FormField label="Type">
          <select
            value={type}
            onChange={(e) =>
              setType(e.target.value as (typeof handMovementTypes)[number])
            }
          >
            {handMovementTypes.map((option) => (
              <option key={option} value={option}>
                {movementTypeLabels[option]}
              </option>
            ))}
          </select>
        </FormField>
        <FormField label="Section">
          <select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
          >
            <option value="">Pick a section</option>
            {(sections.data ?? []).map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}
              </option>
            ))}
          </select>
        </FormField>
        <FormField
          label={`${direction > 0 ? "Quantity in" : direction < 0 ? "Quantity out" : "Change"} (${unitLabel(item.unit)})`}
          hint={
            direction === 0 ? "Use a minus sign to remove stock." : undefined
          }
        >
          <input
            type="number"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </FormField>
        <FormField label={type === "adjust" ? "Reason *" : "Reason"}>
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Record
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

// FLOW-71 AC3: correcting a movement records the difference as a new movement linked
// to it; the original stays as it was.
function CorrectionForm({
  item,
  movement,
  current,
  onClose,
  onSaved,
}: {
  item: InventoryItem;
  movement: StockMovement;
  // The movement plus its corrections so far.
  current: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState(String(current));
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = async () => {
    const amount = toNumber(quantity);
    if (amount === null || Number.isNaN(amount))
      return setError("Enter what the movement should have been.");
    if (!reason.trim()) return setError("Give a reason for the correction.");
    setSaving(true);
    setError("");
    try {
      await inventoryApi.correct(movement.id, { quantity: amount, reason });
      onSaved();
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
      title="Correct movement"
      description={`${movementTypeLabels[movement.type]} of ${changeLabel(current)} ${unitLabel(item.unit)} in ${movement.sectionName} on ${dateTimeLabel(movement.createdAt)}. The difference is recorded as a new, linked movement.`}
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
        <FormField
          label={`Should have been (${unitLabel(item.unit)})`}
          hint="Signed: a minus sign removes stock."
        >
          <input
            type="number"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        </FormField>
        <FormField label="Reason *">
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </FormField>
        <div className="form-actions">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            Save correction
          </Button>
        </div>
      </form>
    </DetailDrawer>
  );
}

// The item's stock ledger, newest first (FLOW-71).
function MovementHistory({
  item,
  version,
  onCorrected,
}: {
  item: InventoryItem;
  version: number;
  onCorrected: () => void;
}) {
  const movements = useResource(
    () => inventoryApi.movements(item.id),
    [item.id, version],
  );
  const [correcting, setCorrecting] = useState<StockMovement | null>(null);
  const all = movements.data ?? [];
  const total = (movement: StockMovement) =>
    movement.quantity +
    all
      .filter((other) => other.correctsId === movement.id)
      .reduce((sum, other) => sum + other.quantity, 0);
  return (
    <Section title="Movement history">
      {movements.error ? (
        <LoadError message={movements.error} />
      ) : !movements.data ? (
        <LoadingSkeleton />
      ) : !all.length ? (
        <p className="muted">No stock movements yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="stock-table movement-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Type</th>
                <th>Section</th>
                <th>Change</th>
                <th>Reason</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {all.map((movement) => (
                <tr key={movement.id}>
                  <td>{dateTimeLabel(movement.createdAt)}</td>
                  <td>
                    {movementTypeLabels[movement.type]}
                    {movement.correctsId && (
                      <span className="badge neutral">Correction</span>
                    )}
                    {movement.correctedBy.length > 0 && (
                      <span className="badge warning">Corrected</span>
                    )}
                  </td>
                  <td>{movement.sectionName}</td>
                  <td>{changeLabel(movement.quantity)}</td>
                  <td>{movement.reason || "—"}</td>
                  <td>
                    {!movement.correctsId &&
                      movement.type !== "transfer" &&
                      !item.archivedAt && (
                        <Allowed action="inventory.move" item={item}>
                          <Button
                            variant="ghost"
                            onClick={() => setCorrecting(movement)}
                            aria-label={`Correct the ${movementTypeLabels[movement.type].toLowerCase()} of ${dateTimeLabel(movement.createdAt)}`}
                          >
                            Correct
                          </Button>
                        </Allowed>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {correcting && (
        <CorrectionForm
          item={item}
          movement={correcting}
          current={total(correcting)}
          onClose={() => setCorrecting(null)}
          onSaved={onCorrected}
        />
      )}
    </Section>
  );
}

// Unit-cost history (FLOW-83), for FT+ users.
function CostHistory({
  item,
  version,
}: {
  item: InventoryItem;
  version: number;
}) {
  const history = useResource(
    () => inventoryApi.costHistory(item.id),
    [item.id, version],
  );
  const unit = item.consumable ? unitLabel(item.consumable.purchaseUnit) : "";
  return (
    <Section title="Cost history">
      {history.error ? (
        <LoadError message={history.error} />
      ) : !history.data ? (
        <LoadingSkeleton />
      ) : !history.data.length ? (
        <p className="muted">No cost changes yet.</p>
      ) : (
        <table className="stock-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Cost per {unit}</th>
              <th>Was</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            {history.data.map((change) => (
              <tr key={change.id}>
                <td>{dateTimeLabel(change.changedAt)}</td>
                <td>{centsLabel(change.unitCostCents)}</td>
                <td>{centsLabel(change.previousCents)}</td>
                <td>{costSourceLabels[change.source]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

export function InventoryDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const item = useResource(() => inventoryApi.get(id), [id]);
  const [edit, setEdit] = useState(false);
  const [stockForm, setStockForm] = useState<
    "transfer" | "count" | "movement" | null
  >(null);
  const [archive, setArchive] = useState(false);
  // Bumped on every stock or cost change so the histories reload.
  const [version, setVersion] = useState(0);
  const saved = (next: InventoryItem) => {
    item.replace(next);
    setVersion((current) => current + 1);
  };
  const back = (
    <Link to="/inventory" className="back-link">
      ← All inventory
    </Link>
  );
  if (item.error)
    return (
      <>
        {back}
        <LoadError message={item.error} />
      </>
    );
  const i = item.data;
  if (!i) return <LoadingSkeleton />;
  const c = i.consumable;
  return (
    <>
      {back}
      <div className="record-heading">
        <div>
          <h1>{i.name}</h1>
          <p>
            <span className="badge neutral">
              {[kindLabels[i.kind], subtypeLabel(i.subtype)]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {i.code && <span className="sku">{i.code}</span>}
            {!i.active && <span className="badge error">Inactive</span>}
            {i.archivedAt && <span className="badge error">Archived</span>}
            {i.belowPar && <span className="badge warning">Below par</span>}
          </p>
        </div>
        <div className="page-actions">
          <Allowed action="inventory.write">
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil size={14} />
              Edit
            </Button>
          </Allowed>
          {i.archivedAt ? (
            <Allowed action="inventory.write">
              <Button
                variant="outline"
                onClick={async () =>
                  item.replace(await inventoryApi.setArchived(i.id, false))
                }
              >
                <RotateCcw size={14} />
                Restore
              </Button>
            </Allowed>
          ) : (
            <Allowed action="inventory.write">
              <Button variant="outline" onClick={() => setArchive(true)}>
                <Archive size={14} />
                Archive
              </Button>
            </Allowed>
          )}
        </div>
      </div>
      <div className="detail-grid">
        <Section title="Item details">
          <small>Category</small>
          <p>{i.category || "—"}</p>
          <small>Group / variant</small>
          <p>{variantLabel(i) || "—"}</p>
          <small>Ratio</small>
          <p>
            {i.ratio
              ? `${i.ratio.quantity} ${ratioBasisLabels[i.ratio.basis]}`
              : "—"}
          </p>
          {i.rental && (
            <>
              <small>Price</small>
              <p>{centsLabel(i.rental.priceCents)}</p>
            </>
          )}
          {i.service && (
            <>
              <small>Price</small>
              <p>
                {centsLabel(i.service.priceCents)}{" "}
                {ratioBasisLabels[i.service.priceBasis]}
              </p>
            </>
          )}
          <small>Description</small>
          <p>{i.description || "—"}</p>
        </Section>
        {c && (
          <Section title="Purchasing">
            <small>Bought as</small>
            <p>{purchaseLabel(c)}</p>
            <small>Recipe unit</small>
            <p>{c.recipeUnit ? unitLabel(c.recipeUnit) : "—"}</p>
            <small>Unit cost</small>
            <p>
              {c.costHidden
                ? "Cost hidden for your role and employment type."
                : c.unitCostCents === null
                  ? "—"
                  : `${centsLabel(c.unitCostCents)} per ${unitLabel(c.purchaseUnit)}`}
            </p>
            {i.bar && (
              <>
                <small>Brand / varietal</small>
                <p>{i.bar.brand || "—"}</p>
                <small>Subcategory</small>
                <p>{i.bar.subcategory || "—"}</p>
                <small>Container</small>
                <p>
                  {i.bar.container ? barContainerLabels[i.bar.container] : "—"}
                </p>
              </>
            )}
            <small>{i.bar ? "Distributor" : "Preferred vendor"}</small>
            <p>{c.preferredVendor || "—"}</p>
            <small>Par level</small>
            <p>
              {c.parLevel === null ? "—" : quantityLabel(c.parLevel, i.unit)}
            </p>
            <small>Storage</small>
            <p>{c.storageSectionName ?? "—"}</p>
            <small>Allergens</small>
            <p>
              {c.allergens
                .map((allergen) => allergenLabels[allergen])
                .join(", ") || "None flagged"}
            </p>
          </Section>
        )}
      </div>
      {i.kind === "service" ? (
        <Section title="Stock">
          <p className="muted">Services aren't stocked.</p>
        </Section>
      ) : (
        <Section
          title="Stock by section"
          action={
            !i.archivedAt && (
              <div className="page-actions">
                <Allowed action="inventory.move" item={i}>
                  <Button
                    variant="outline"
                    onClick={() => setStockForm("movement")}
                  >
                    <PackagePlus size={14} />
                    Record movement
                  </Button>
                </Allowed>
                <Allowed action="inventory.count" item={i}>
                  <Button
                    variant="outline"
                    onClick={() => setStockForm("count")}
                  >
                    <ClipboardCheck size={14} />
                    Count
                  </Button>
                </Allowed>
                <Allowed action="inventory.move" item={i}>
                  <Button
                    variant="outline"
                    onClick={() => setStockForm("transfer")}
                  >
                    <ArrowLeftRight size={14} />
                    Transfer
                  </Button>
                </Allowed>
              </div>
            )
          }
        >
          <table className="stock-table">
            <thead>
              <tr>
                <th>Section</th>
                <th>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {i.stock.map((level) => (
                <tr key={level.sectionId}>
                  <td>{level.sectionName}</td>
                  <td>{quantityLabel(level.quantity, i.unit)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row">Total</th>
                <td>
                  <strong>{quantityLabel(i.totalQuantity, i.unit)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
        </Section>
      )}
      {i.kind !== "service" && (
        <MovementHistory
          item={i}
          version={version}
          onCorrected={() => {
            item.reload();
            setVersion((current) => current + 1);
          }}
        />
      )}
      {c && !c.costHidden && <CostHistory item={i} version={version} />}
      <Attachments recordType="inventory_item" recordId={i.id} title="Photos" />
      {edit && (
        <ItemForm item={i} onClose={() => setEdit(false)} onSaved={saved} />
      )}
      {stockForm === "movement" && (
        <MovementForm
          item={i}
          onClose={() => setStockForm(null)}
          onSaved={saved}
        />
      )}
      {(stockForm === "transfer" || stockForm === "count") && (
        <StockForm
          item={i}
          mode={stockForm}
          onClose={() => setStockForm(null)}
          onSaved={saved}
        />
      )}
      <ConfirmationDialog
        open={archive}
        onClose={() => setArchive(false)}
        title="Archive this item?"
        onConfirm={async () => {
          await inventoryApi.setArchived(i.id, true);
          setArchive(false);
          navigate("/inventory");
        }}
      >
        {i.name} will be hidden from inventory lists.
      </ConfirmationDialog>
    </>
  );
}

// Sections (FLOW-70): Admin adds, renames and archives them.
export function SectionList() {
  const [archived, setArchived] = useState(false);
  const sections = useResource(
    () => sectionsApi.list({ archived }),
    [archived],
  );
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SectionKind>("rental");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [error, setError] = useState("");
  const run = async (action: () => Promise<unknown>) => {
    setError("");
    try {
      await action();
      sections.reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <>
      <Link to="/inventory" className="back-link">
        ← All inventory
      </Link>
      <PageHeader
        title="Sections"
        subtitle="Where stock lives. Vendor holds sub-rented items."
        eyebrow="STOCK & SUPPLIES"
      />
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      {!archived && (
        <Allowed action="inventory.sections">
          <form
            className="inline-row"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return setError("Name is required.");
              void run(async () => {
                await sectionsApi.create({ name, kind });
                setName("");
              });
            }}
          >
            <FormField label="New section name">
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField label="Holds">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as SectionKind)}
              >
                {sectionKindSchema.options.map((option) => (
                  <option key={option} value={option}>
                    {sectionKindLabels[option]}
                  </option>
                ))}
              </select>
            </FormField>
            <Button type="submit">
              <Plus size={14} /> Add section
            </Button>
          </form>
        </Allowed>
      )}
      <FilterBar>
        <label className="checkbox-filter">
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => setArchived(e.target.checked)}
          />
          Show archived
        </label>
      </FilterBar>
      {sections.error ? (
        <LoadError message={sections.error} />
      ) : !sections.data ? (
        <LoadingSkeleton />
      ) : (
        sectionKindSchema.options.map((group) => (
          <Section title={sectionKindLabels[group]} key={group}>
            <table className="stock-table">
              <tbody>
                {sections.data
                  ?.filter((section) => section.kind === group)
                  .map((section) => (
                    <tr key={section.id}>
                      <td>
                        {renaming?.id === section.id ? (
                          <form
                            className="inline-row"
                            onSubmit={(e) => {
                              e.preventDefault();
                              void run(async () => {
                                await sectionsApi.rename(
                                  section.id,
                                  renaming.name,
                                );
                                setRenaming(null);
                              });
                            }}
                          >
                            <FormField label={`Rename ${section.name}`}>
                              <input
                                autoFocus
                                value={renaming.name}
                                onChange={(e) =>
                                  setRenaming({
                                    id: section.id,
                                    name: e.target.value,
                                  })
                                }
                              />
                            </FormField>
                            <Button type="submit">Save name</Button>
                          </form>
                        ) : (
                          section.name
                        )}
                      </td>
                      <td>
                        {Number(section.totalQuantity.toFixed(4))} in stock
                      </td>
                      <td>
                        {archived ? (
                          <Allowed action="inventory.sections">
                            <Button
                              variant="ghost"
                              onClick={() =>
                                run(() =>
                                  sectionsApi.setArchived(section.id, false),
                                )
                              }
                            >
                              Restore {section.name}
                            </Button>
                          </Allowed>
                        ) : (
                          <>
                            <Allowed action="inventory.sections">
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  setRenaming({
                                    id: section.id,
                                    name: section.name,
                                  })
                                }
                              >
                                Rename {section.name}
                              </Button>
                            </Allowed>
                            <Allowed action="inventory.sections">
                              <Button
                                variant="ghost"
                                onClick={() =>
                                  run(() =>
                                    sectionsApi.setArchived(section.id, true),
                                  )
                                }
                              >
                                Archive {section.name}
                              </Button>
                            </Allowed>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </Section>
        ))
      )}
    </>
  );
}
