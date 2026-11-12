import type { ImportField, ImportRow } from "./imports";
import {
  barCategories,
  barSubcategories,
  barTierSchema,
  itemFlagLabels,
  pullOwnerLabels,
  pullOwners,
  type BarTier,
  type ItemFlag,
  type ItemKind,
  type PullOwner,
} from "./inventory";

// Row transforms and row parsing for the Master Inventory (FLOW-78) and Bar
// Inventory (FLOW-91) importers. Pure, so the browser (transforms, ADR-09), the
// Worker (parsing) and the tests share one implementation. Flowbase is public
// (ADR-27): nothing here or in the tests holds a row of the real files.

type Cells = ImportRow & { cells: string[] };
export type ImportNote = { rowNumber: number; text: string };
export type TransformResult = { rows: Cells[]; notes: ImportNote[] };

const clean = (value: string | undefined) => (value ?? "").trim();
const key = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
const apostrophes = (value: string) => value.replace(/[‘’]/g, "'");
const isNumber = (value: string) => /^\d+(\.\d+)?$/.test(value);

// ---- Master Inventory ----

export const masterInventoryFields: ImportField[] = [
  { key: "category", label: "Category", required: false, aliases: [] },
  { key: "subcategory", label: "Subcategory", required: false, aliases: [] },
  { key: "item", label: "Item", required: true, aliases: ["Name"] },
  { key: "qty", label: "Qty", required: false, aliases: ["Quantity"] },
  { key: "description", label: "Description", required: false, aliases: [] },
  { key: "location", label: "Location", required: false, aliases: [] },
  { key: "pull_owner", label: "Pull Owner", required: false, aliases: [] },
  { key: "cost", label: "Cost", required: false, aliases: [] },
  { key: "distributor", label: "Distributor", required: false, aliases: [] },
];

// Rows with no Item are skipped. Rows with the same Item and Description merge
// into the first; rows with the same Item but different Descriptions become
// separate items named "<Item> – <Description>" (a row with no Description keeps
// the plain name). Every dropped or renamed row is reported.
export function masterInventoryRows(rows: Cells[]): TransformResult {
  const notes: ImportNote[] = [];
  const named = rows.filter((row) => {
    const keep = clean(row.values.item) !== "";
    if (!keep) notes.push({ rowNumber: row.rowNumber, text: "No Item; skipped." });
    return keep;
  });
  const descriptions = new Map<string, Set<string>>();
  for (const row of named) {
    const item = key(row.values.item);
    const set = descriptions.get(item) ?? new Set<string>();
    set.add(key(clean(row.values.description)));
    descriptions.set(item, set);
  }
  const first = new Map<string, number>();
  const out: Cells[] = [];
  for (const row of named) {
    const item = clean(row.values.item);
    const description = clean(row.values.description);
    const pair = `${key(item)}|${key(description)}`;
    const earlier = first.get(pair);
    if (earlier !== undefined) {
      notes.push({
        rowNumber: row.rowNumber,
        text: `Same Item and Description as row ${earlier}; merged into it.`,
      });
      continue;
    }
    first.set(pair, row.rowNumber);
    const split = (descriptions.get(key(item))?.size ?? 0) > 1 && description !== "";
    const name = split ? `${item} – ${description}` : item;
    if (split)
      notes.push({
        rowNumber: row.rowNumber,
        text: `Other rows share this Item with a different Description; imported as ${name}.`,
      });
    out.push({ ...row, values: { ...row.values, item: name } });
  }
  return { rows: out, notes };
}

export const masterLocations = ["Warehouse", "Jamie's", "Storage Box"] as const;
export type MasterRow = {
  name: string;
  category: string;
  subcategory: string;
  kind: ItemKind;
  subtype: string | null;
  quantity: number;
  // The Description column, plus the sheet's Qty text when it wasn't a number.
  description: string;
  location: (typeof masterLocations)[number];
  pullOwner: PullOwner | null;
  costCents: number | null;
  distributor: string;
  flags: ItemFlag[];
};

// Q6: Guest Disposables and Packing are used up (consumable supplies), as are
// Sternos; Menu Card Design is a service; everything else is a rental.
const supplyCategories = ["guest disposables", "packing"];
export function masterKind(
  name: string,
  category: string,
  subcategory: string,
): { kind: ItemKind; subtype: string | null } {
  if (key(name) === "menu card design" && key(category) === "decor" && key(subcategory) === "signage")
    return { kind: "service", subtype: null };
  if (supplyCategories.includes(key(category)) || /^sternos\b/i.test(name))
    return { kind: "consumable", subtype: "supply" };
  return { kind: "rental", subtype: masterRentalSubtype(category, subcategory) };
}

// The model needs a rental subtype; the sheet has none, so it follows the
// category and subcategory.
export function masterRentalSubtype(category: string, subcategory: string): string {
  const [c, s] = [key(category), key(subcategory)];
  if (c === "decor") return "decor";
  if (s === "glassware") return "glassware";
  if (c === "guest tableware") return "tableware";
  if (c === "buffet rentals")
    return ["transport", "misc", "service"].includes(s) ? "equipment" : "tableware";
  if (c === "bar") return "bar";
  if (c === "rentals") {
    if (["chair", "tables"].includes(s)) return "furniture";
    if (/linen|napkin|runner|table setting/.test(s)) return "linen";
    if (/backdrop|drape/.test(s)) return "decor";
  }
  return "equipment";
}

const pullOwnerByLabel = new Map<string, PullOwner>(
  pullOwners.map((owner) => [key(pullOwnerLabels[owner]), owner]),
);

function parseCost(text: string): { cents: number | null } | { error: string } {
  if (text === "") return { cents: null };
  const value = text.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return { error: `Cost "${text}" isn't a number.` };
  const cents = Math.round(Number(value) * 100);
  return { cents: cents === 0 ? null : cents };
}

export type ParseResult<Row> = { row: Row } | { errors: string[] };

export function parseMasterRow(values: Record<string, string>): ParseResult<MasterRow> {
  const errors: string[] = [];
  const name = clean(values.item);
  if (!name) errors.push("Item is required.");
  const flags: ItemFlag[] = [];
  let category = clean(values.category);
  const subcategory = clean(values.subcategory);
  if (!category) {
    category = "Uncategorized";
    flags.push("needs_category");
  }

  const { kind, subtype } = masterKind(name, category, subcategory);
  const qtyText = clean(values.qty);
  let quantity = 0;
  let description = clean(values.description);
  if (isNumber(qtyText)) quantity = Number(qtyText);
  else {
    // Blank, "-" and "?" carry no count; other text is kept as written.
    if (kind !== "service") flags.push("needs_count");
    if (qtyText && !["-", "?"].includes(qtyText))
      description = [description, `Sheet quantity: ${qtyText}`].filter(Boolean).join("\n");
  }

  const locationText = apostrophes(clean(values.location));
  let location: MasterRow["location"] = "Warehouse";
  if (!locationText) flags.push("confirm_location");
  else {
    const found = masterLocations.find((option) => key(option) === key(locationText));
    if (found) location = found;
    else errors.push(`Location "${locationText}" isn't Warehouse, Jamie's or Storage Box.`);
  }

  const ownerText = clean(values.pull_owner);
  const pullOwner = ownerText ? (pullOwnerByLabel.get(key(ownerText)) ?? null) : null;
  if (ownerText && !pullOwner)
    errors.push(`Pull Owner "${ownerText}" isn't Pull Lead, Production Lead or Sales Manager.`);

  const cost = parseCost(clean(values.cost));
  if ("error" in cost) errors.push(cost.error);
  const costCents = "error" in cost ? null : cost.cents;
  if (costCents === null && kind !== "service") flags.push("needs_cost");

  if (errors.length) return { errors };
  return {
    row: {
      name,
      category,
      subcategory,
      kind,
      subtype,
      quantity,
      description,
      location,
      pullOwner,
      costCents,
      distributor: clean(values.distributor),
      flags,
    },
  };
}

const flagList = (flags: ItemFlag[]) =>
  flags.length ? ` · ${flags.map((flag) => itemFlagLabels[flag]).join(", ")}` : "";

export function describeMasterRow(row: MasterRow) {
  const where = row.kind === "service" ? "" : ` · ${row.location}`;
  const kind = row.subtype ? `${row.kind} (${row.subtype})` : row.kind;
  return {
    summary: `${row.category}${row.subcategory ? ` / ${row.subcategory}` : ""} · ${kind}${where}${row.kind === "service" ? "" : ` · qty ${row.quantity}`}${flagList(row.flags)}`,
    notes: [] as string[],
  };
}

export const masterExternalKey = (row: MasterRow) => `master:${key(row.name)}`;

// ---- Bar Inventory ----

export const barInventoryFields: ImportField[] = [
  { key: "item", label: "Item", required: true, aliases: [] },
  { key: "qty", label: "Qty", required: false, aliases: ["Quantity"] },
  { key: "unit", label: "Unit", required: false, aliases: [] },
  { key: "details", label: "Details", required: false, aliases: ["Tier"] },
  { key: "distributor", label: "Distributor", required: false, aliases: ["Vendor"] },
];

// "WINE (Red)": capitals, optionally a type in brackets.
const barHeading = /^([^()a-z]*[A-Z][^()a-z]*?)\s*(?:\(([^)]*)\))?$/;

export function barHeadingOf(
  item: string,
): { category: string; subcategory: string } | null {
  const match = barHeading.exec(item);
  if (!match) return null;
  const word = match[1].trim();
  const category =
    barCategories.find((option) => key(option) === key(word)) ??
    word.charAt(0) + word.slice(1).toLowerCase();
  const given = clean(match[2]);
  const subcategory =
    (barSubcategories[category] ?? []).find((option) => key(option) === key(given)) ?? given;
  return { category, subcategory };
}

// Category rows (an Item in capitals with nothing else on the row) start a
// category and subcategory for the rows under them and are not items.
export function barInventoryRows(rows: Cells[]): TransformResult {
  const notes: ImportNote[] = [];
  const out: Cells[] = [];
  let category = "";
  let subcategory = "";
  for (const row of rows) {
    const item = clean(row.values.item);
    const alone = ["qty", "unit", "details", "distributor"].every(
      (field) => clean(row.values[field]) === "",
    );
    const heading = item && alone ? barHeadingOf(item) : null;
    if (heading) {
      ({ category, subcategory } = heading);
      notes.push({
        rowNumber: row.rowNumber,
        text: `Category row: ${category}${subcategory ? ` / ${subcategory}` : ""}.`,
      });
      continue;
    }
    out.push({ ...row, values: { ...row.values, category, subcategory } });
  }
  return { rows: out, notes };
}

export type BarRow = {
  name: string;
  category: string;
  subcategory: string;
  tier: BarTier | "";
  // Counted in cases of packCount, or each (bottles).
  purchaseUnit: "case" | "each";
  packCount: number | null;
  eachSize: { quantity: number; unit: "fl_oz" } | null;
  quantity: number;
  notes: string;
  distributor: string;
  flags: ItemFlag[];
  suggestion: string | null;
};

// Suggested spelling fixes, listed in the dry run for review; names import as
// written.
const spellings: Record<string, string> = {
  "coors lite": "Coors Light",
  "leinenkeguls shandy": "Leinenkugel's Shandy",
  "don perignon": "Dom Pérignon",
  odouls: "O'Doul's",
  titos: "Tito's",
  burnettes: "Burnett's",
  tanquerray: "Tanqueray",
  hennesssey: "Hennessy",
  hendricks: "Hendrick's",
  fleischmanns: "Fleischmann's",
  "jim bean - bourbon": "Jim Beam - Bourbon",
  "makers mark - bourbon": "Maker's Mark - Bourbon",
  "tanteo jalepeno": "Tanteo Jalapeño",
  "angurosta bitters": "Angostura Bitters",
  "angurosta orange bitters": "Angostura Orange Bitters",
  grenedine: "Grenadine",
  "saratoga sparklng": "Saratoga Sparkling",
  "stigel radler (grapefruiut)": "Stiegl Radler (Grapefruit)",
};

function parseUnit(text: string) {
  const none = { purchaseUnit: "each" as const, packCount: null, eachSize: null, note: "" };
  if (!text) return none;
  const pack = /^(\d+)\s*(?:pk|packs?|bottles?|cans?)?\s*(\(.*\))?$/i.exec(text);
  if (pack)
    return {
      ...none,
      purchaseUnit: "case" as const,
      packCount: Number(pack[1]),
      note: pack[2] ? `Unit: ${text}` : "",
    };
  const size = /^\((\d+(?:\.\d+)?)\s*fl\.?\s*oz\)$/i.exec(text);
  if (size)
    return { ...none, eachSize: { quantity: Number(size[1]), unit: "fl_oz" as const } };
  return { ...none, note: `Unit: ${text}` };
}

// A number, or text that counts cases: "2 case", "1/2 case", "1 full crate",
// "2full 2 half" (2 full and 2 half cases). null when it isn't one.
function caseCount(text: string): number | null {
  const mixed = /^(\d+)\s*full\s+(\d+)\s*half$/i.exec(text);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / 2;
  const plain = /^(\d+(?:\.\d+)?|\d+\/\d+)\s*(?:full\s+)?(?:cases?|crates?)$/i.exec(text);
  if (!plain) return null;
  const [top, bottom] = plain[1].split("/");
  return bottom ? Number(top) / Number(bottom) : Number(top);
}

function parseTier(text: string): { tier: BarTier | ""; note: string } {
  const lower = key(text);
  if (!lower || lower === "n/a") return { tier: "", note: "" };
  const first = barTierSchema.safeParse(lower.split("/")[0].trim());
  if (!first.success) return { tier: "", note: `Details: ${text}` };
  return { tier: first.data, note: lower.includes("/") ? `Tier: ${text}` : "" };
}

function parseDistributor(text: string): { name: string; note: string } {
  if (!text || text === "-") return { name: "", note: "" };
  const starred = /^\*(.*)\*$/.exec(text);
  if (starred) return { name: "", note: `Distributor: ${clean(starred[1])}` };
  const bracketed = /^(.*?)\s*-?\s*(\(.*\))$/.exec(text);
  if (bracketed) return { name: clean(bracketed[1]), note: `Distributor: ${text}` };
  return { name: text, note: "" };
}

export function parseBarRow(values: Record<string, string>): ParseResult<BarRow> {
  const name = clean(values.item);
  const category = clean(values.category);
  if (!name) return { errors: ["Item is required."] };
  if (!category)
    return { errors: ["This row isn't under a category row (BEER, WINE, LIQUOR…)."] };
  const subcategory = clean(values.subcategory);
  if (!barCategories.includes(category))
    return { errors: [`${category} isn't a bar category.`] };
  if (subcategory && !(barSubcategories[category] ?? []).includes(subcategory))
    return { errors: [`${subcategory} isn't a type of ${category}.`] };
  const flags: ItemFlag[] = [];
  const notes: string[] = [];
  const unit = parseUnit(clean(values.unit));
  if (unit.note) notes.push(unit.note);

  const qtyText = clean(values.qty);
  let quantity = 0;
  if (isNumber(qtyText)) quantity = Number(qtyText);
  else {
    const cases = caseCount(qtyText);
    // A count of cases only means something against a pack or container size.
    if (cases !== null && (unit.purchaseUnit === "case" || unit.eachSize)) quantity = cases;
    else {
      flags.push("needs_count");
      if (qtyText) notes.push(`Sheet quantity: ${qtyText}`);
    }
  }

  const tier = parseTier(clean(values.details));
  if (tier.note) notes.push(tier.note);
  const distributor = parseDistributor(clean(values.distributor));
  if (distributor.note) notes.push(distributor.note);
  const suggestion = spellings[key(name)] ?? null;

  return {
    row: {
      name,
      category,
      subcategory,
      tier: tier.tier,
      purchaseUnit: unit.purchaseUnit,
      packCount: unit.packCount,
      eachSize: unit.eachSize,
      quantity,
      notes: notes.join("\n"),
      distributor: distributor.name,
      flags,
      suggestion,
    },
  };
}

export function describeBarRow(row: BarRow) {
  const unit =
    row.purchaseUnit === "case"
      ? `case of ${row.packCount}`
      : row.eachSize
        ? `each (${row.eachSize.quantity} fl oz)`
        : "each";
  return {
    summary: `${row.category}${row.subcategory ? ` / ${row.subcategory}` : ""} · tier ${row.tier || "none"} · ${unit} · qty ${row.quantity}${flagList(row.flags)}`,
    notes: row.suggestion ? [`Suggested spelling: ${row.name} → ${row.suggestion}.`] : [],
  };
}

export const barExternalKey = (row: BarRow) =>
  `bar:${key(row.category)}|${key(row.subcategory)}|${key(row.name)}`;
