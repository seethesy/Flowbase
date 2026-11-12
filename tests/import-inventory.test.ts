import { describe, expect, it } from "vitest";
import {
  barExternalKey,
  barInventoryFields,
  describeBarRow,
  describeMasterRow,
  masterExternalKey,
  masterInventoryFields,
  masterKind,
  parseBarRow,
  parseMasterRow,
  type BarRow,
  type MasterRow,
} from "../shared/import-inventory";
import {
  applyTransformsWithNotes,
  autoMap,
  headingIndex,
  mapRows,
  type ImportTransform,
} from "../shared/imports";
import { parseCsv } from "../src/services/import-files";
import { barCategoryRows, barInventoryCsv, barNonBlankRows } from "./fixtures/bar-inventory";
import { masterInventoryCsv, masterNonBlankRows } from "./fixtures/master-inventory";

// The Master Inventory (FLOW-78) and Bar Inventory (FLOW-91) row rules, run the
// way the Imports screen runs them: parse the file, map columns, apply the
// importer's transforms, then parse each row. The fixtures reproduce the real
// files' layouts with invented values (ADR-27).

function run<Row>(
  csv: string,
  fields: typeof masterInventoryFields,
  layout: "master" | "bar",
  parse: (values: Record<string, string>) => { row: Row } | { errors: string[] },
) {
  const sheet = parseCsv(csv);
  const mapping = autoMap(sheet[headingIndex(sheet)], fields);
  const transforms: ImportTransform[] = [{ type: "inventory_rows", layout }];
  const { rows, notes } = applyTransformsWithNotes(mapRows(sheet, mapping), transforms);
  const parsed = rows.map((row) => ({ rowNumber: row.rowNumber, result: parse(row.values) }));
  return { rows, notes, parsed };
}
const rowOf = <Row>(
  parsed: { rowNumber: number; result: { row: Row } | { errors: string[] } }[],
  rowNumber: number,
) => {
  const found = parsed.find((entry) => entry.rowNumber === rowNumber)?.result;
  if (!found || !("row" in found)) throw new Error(`Row ${rowNumber} didn't parse.`);
  return found.row;
};

describe("Master Inventory importer (FLOW-78)", () => {
  const master = run<MasterRow>(masterInventoryCsv, masterInventoryFields, "master", parseMasterRow);
  const at = (rowNumber: number) => rowOf(master.parsed, rowNumber);

  it("maps every column of the header automatically", () => {
    const sheet = parseCsv(masterInventoryCsv);
    expect(Object.values(autoMap(sheet[0], masterInventoryFields)).every((index) => index !== null)).toBe(true);
  });

  it("accounts for every non-blank row: imported, merged or skipped and reported (AC1)", () => {
    const dropped = master.notes.filter((note) => /skipped|merged into/.test(note.text));
    expect(master.rows.length + dropped.length).toBe(masterNonBlankRows);
    expect(master.parsed.every((entry) => "row" in entry.result)).toBe(true);
    expect(dropped.map((note) => note.rowNumber)).toEqual([14, 15, 9]);
  });

  it("skips rows with no Item and lists them", () => {
    expect(master.notes.filter((note) => note.text === "No Item; skipped.").map((n) => n.rowNumber)).toEqual([14, 15]);
  });

  it("merges rows with the same Item and Description and reports it (AC2)", () => {
    expect(master.notes.find((note) => note.rowNumber === 9)?.text).toBe(
      "Same Item and Description as row 8; merged into it.",
    );
    expect(master.rows.filter((row) => row.values.item === "Sample Cutting Board")).toHaveLength(1);
  });

  it("makes rows with the same Item and different Descriptions separate items (AC2)", () => {
    expect([5, 6, 7].map((n) => at(n).name)).toEqual([
      "Sample Microphone – wireless",
      "Sample Microphone – wired",
      "Sample Microphone – clip-on",
    ]);
    expect(new Set([5, 6, 7].map((n) => masterExternalKey(at(n)))).size).toBe(3);
    // Unique items keep their plain name.
    expect(at(2).name).toBe("Sample Wire Chafer");
  });

  it("imports Sternos as a supply and follows Q6 for every other row (AC3)", () => {
    expect(at(3)).toMatchObject({ kind: "consumable", subtype: "supply" });
    expect(at(10)).toMatchObject({ kind: "consumable", subtype: "supply" });
    expect(at(12)).toMatchObject({ kind: "consumable", subtype: "supply" });
    expect(at(13)).toMatchObject({ kind: "service", subtype: null });
    expect(at(2)).toMatchObject({ kind: "rental", subtype: "equipment" });
    expect(at(19)).toMatchObject({ kind: "rental", subtype: "furniture" });
    expect(masterKind("Menu Cards", "Decor", "Signage").kind).toBe("rental");
  });

  it("takes numeric Qty as the starting quantity; blank, - and ? as 0 needing a count", () => {
    expect(at(2)).toMatchObject({ quantity: 4 });
    expect(at(2).flags).not.toContain("needs_count");
    expect(at(4)).toMatchObject({ quantity: 0 });
    expect(at(4).flags).toContain("needs_count");
    expect(at(10)).toMatchObject({ quantity: 0, description: "black" });
    expect(at(11)).toMatchObject({ quantity: 0, description: "black" });
    expect(at(10).flags).toContain("needs_count");
  });

  it("keeps text Qty as 0 needing a count, with the text in the notes", () => {
    expect(at(12)).toMatchObject({ quantity: 0, description: "Sheet quantity: 48 in box" });
    expect(at(12).flags).toContain("needs_count");
    expect(at(16).description).toBe("Sheet quantity: 2  box full");
  });

  it("keeps the Description as written, with pack sizes", () => {
    expect(at(3).description).toBe("72 pk");
    expect(at(5).description).toBe("wireless");
  });

  it("maps Location to the sections, blank to Warehouse needing confirmation", () => {
    expect(at(2).location).toBe("Warehouse");
    expect(at(10).location).toBe("Jamie's");
    expect(at(12).location).toBe("Storage Box");
    expect(at(16)).toMatchObject({ location: "Warehouse" });
    expect(at(16).flags).toContain("confirm_location");
    expect(at(2).flags).not.toContain("confirm_location");
  });

  it("reads Pull Owner, or none", () => {
    expect(at(2).pullOwner).toBe("pull_lead");
    expect(at(5).pullOwner).toBe("production_lead");
    expect(at(13).pullOwner).toBe("sales_manager");
    expect(at(16).pullOwner).toBeNull();
  });

  it("reads Cost in cents; 0 and blank mean no cost entered, flagged", () => {
    expect(at(2)).toMatchObject({ costCents: 4000 });
    expect(at(2).flags).not.toContain("needs_cost");
    expect(at(3)).toMatchObject({ costCents: null });
    expect(at(3).flags).toContain("needs_cost");
    expect(at(4).flags).toContain("needs_cost");
    expect(at(13).flags).not.toContain("needs_cost");
  });

  it("links the Distributor", () => {
    expect(at(2).distributor).toBe("Sample Store");
    expect(at(3).distributor).toBe("");
  });

  it("imports rows with no Category as Uncategorized, flagged (and keeps a Subcategory)", () => {
    expect(at(16)).toMatchObject({ category: "Uncategorized", subcategory: "" });
    expect(at(16).flags).toContain("needs_category");
    expect(at(17)).toMatchObject({ category: "Uncategorized", subcategory: "Floral" });
    expect(at(2).flags).not.toContain("needs_category");
  });

  it("trims spaces around text", () => {
    expect(at(19).name).toBe("Sample Padded Chair");
  });

  it("describes each item for the dry-run report", () => {
    expect(describeMasterRow(at(2)).summary).toBe(
      "On-site Kitchen / Heating · rental (equipment) · Warehouse · qty 4",
    );
    expect(describeMasterRow(at(16)).summary).toContain("Needs category");
    expect(describeMasterRow(at(13)).summary).toBe("Decor / Signage · service");
  });

  it.each([
    ["a Cost that isn't a number", { item: "A", cost: "a lot" }, 'Cost "a lot" isn\'t a number.'],
    ["an unknown Location", { item: "A", location: "Attic" }, 'Location "Attic" isn\'t Warehouse, Jamie\'s or Storage Box.'],
    ["an unknown Pull Owner", { item: "A", pull_owner: "Intern" }, 'Pull Owner "Intern" isn\'t Pull Lead, Production Lead or Sales Manager.'],
    ["no Item", { item: "" }, "Item is required."],
  ])("rejects %s", (_name, values, message) => {
    const result = parseMasterRow(values);
    expect("errors" in result && result.errors).toContain(message);
  });

  it("accepts a curly apostrophe in Jamie's", () => {
    const result = parseMasterRow({ item: "A", location: "Jamie’s" });
    expect("row" in result && result.row.location).toBe("Jamie's");
  });
});

describe("Bar Inventory importer (FLOW-91)", () => {
  const bar = run<BarRow>(barInventoryCsv, barInventoryFields, "bar", parseBarRow);
  const at = (rowNumber: number) => rowOf(bar.parsed, rowNumber);

  it("lists every bar item with its category, subcategory, tier, unit and quantity (AC1)", () => {
    expect(bar.parsed.every((entry) => "row" in entry.result)).toBe(true);
    expect(bar.rows.length + barCategoryRows.length).toBe(barNonBlankRows);
    expect(bar.notes.map((note) => note.rowNumber)).toEqual(barCategoryRows);
    expect(describeBarRow(at(18)).summary).toBe(
      "Liquor / Vodka · tier rail · each · qty 1",
    );
    expect(describeBarRow(at(3)).summary).toBe("Beer · tier none · case of 24 · qty 4");
  });

  it("ignores the note in column J", () => {
    const sheet = parseCsv(barInventoryCsv);
    expect(Object.values(autoMap(sheet[0], barInventoryFields))).toEqual([0, 1, 2, 3, 4]);
  });

  it("starts a category and subcategory at a capitals row, with a type in brackets", () => {
    expect(at(3)).toMatchObject({ category: "Beer", subcategory: "" });
    expect(at(10)).toMatchObject({ category: "Wine", subcategory: "White" });
    expect(at(12)).toMatchObject({ category: "Wine", subcategory: "Red" });
    expect(at(14)).toMatchObject({ category: "Champagne" });
    expect(at(18)).toMatchObject({ category: "Liquor", subcategory: "Vodka" });
    expect(at(21)).toMatchObject({ category: "Liquor", subcategory: "Gin" });
    expect(at(23)).toMatchObject({ category: "Mixers & Juices" });
    expect(at(29)).toMatchObject({ category: "Soft Beverages" });
  });

  it("treats a non-capital item-only row as an item", () => {
    expect(at(27)).toMatchObject({ name: "Sample Mint", category: "Garnishes", quantity: 0 });
    expect(at(27).flags).toContain("needs_count");
  });

  it("reads the tier; a combined value takes the first and keeps the text; N/A sets none", () => {
    expect(at(18).tier).toBe("rail");
    expect(at(19)).toMatchObject({ tier: "mid", notes: expect.stringContaining("Tier: mid/high") });
    expect(at(5).tier).toBe("");
    expect(at(15).tier).toBe("high");
    expect(at(3).tier).toBe("");
  });

  it("reads the Unit: a pack, a bare count, bottles, a container size, or blank for bottles", () => {
    expect(at(3)).toMatchObject({ purchaseUnit: "case", packCount: 24 });
    expect(at(5)).toMatchObject({ purchaseUnit: "case", packCount: 6 });
    expect(at(6)).toMatchObject({ purchaseUnit: "case", packCount: 12 });
    expect(at(7)).toMatchObject({ purchaseUnit: "case", packCount: 12 });
    expect(at(24)).toMatchObject({ purchaseUnit: "each", eachSize: { quantity: 64, unit: "fl_oz" } });
    expect(at(18)).toMatchObject({ purchaseUnit: "each", packCount: null, eachSize: null });
    expect(at(25).notes).toContain("Unit: 12 bottles(1QT/per)");
  });

  it("takes numeric Qty, halves and quarters included, as quantities in Units", () => {
    expect([3, 4, 10, 19].map((n) => at(n).quantity)).toEqual([4, 0, 1.5, 3.25]);
  });

  it("parses text Qty that counts cases; anything else is 0 needing a count with the text kept", () => {
    expect(at(12).quantity).toBe(2);
    expect(at(14).quantity).toBe(3);
    expect(at(25).quantity).toBe(2);
    expect(at(24).quantity).toBe(3);
    expect(at(30).quantity).toBe(1);
    expect(at(23)).toMatchObject({ quantity: 0, notes: "Sheet quantity: 3 case" });
    expect(at(23).flags).toContain("needs_count");
    expect(at(29)).toMatchObject({ quantity: 0, notes: "Sheet quantity: 1/2 case" });
    expect(at(15).quantity).toBe(0);
    expect(at(15).flags).toContain("needs_count");
    expect(at(3).flags).not.toContain("needs_count");
  });

  it("links the Distributor; - , blank and asterisk text mean none (asterisk text kept)", () => {
    expect(at(3).distributor).toBe("Sample Beer Co");
    expect(at(4).distributor).toBe("Sample Beer Co");
    expect(at(10).distributor).toBe("Impero Wine Distributors");
    expect(at(5).distributor).toBe("");
    expect(at(7).distributor).toBe("");
    expect(at(15)).toMatchObject({ distributor: "", notes: expect.stringContaining("other higher end dist.") });
    expect(at(30).distributor).toBe("Hop & Wine");
  });

  it("imports names as written and lists suggested spelling fixes", () => {
    expect(at(4).name).toBe("Coors Lite");
    expect(describeBarRow(at(4)).notes).toEqual(["Suggested spelling: Coors Lite → Coors Light."]);
    expect(describeBarRow(at(3)).notes).toEqual([]);
  });

  it("keys items by category, subcategory and name, so the same name under another type is another item", () => {
    expect(barExternalKey(at(18))).toBe("bar:liquor|vodka|sample rail vodka");
    expect(barExternalKey(at(21))).toBe("bar:liquor|gin|sample rail vodka");
  });

  it("rejects a row above any category row, and an item with no name", () => {
    expect(parseBarRow({ item: "Orphan" })).toEqual({
      errors: ["This row isn't under a category row (BEER, WINE, LIQUOR…)."],
    });
    expect(parseBarRow({ item: "", category: "Beer" })).toEqual({ errors: ["Item is required."] });
  });
});
