import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  applyTransforms,
  autoMap,
  batches,
  IMPORT_BATCH_SIZE,
  importBatchSchema,
  mapRows,
  type ImportField,
} from "../shared/imports";
import { parseCsv, parseXlsx } from "../src/services/import-files";

// Data import framework (FLOW-47): file parsing, column mapping, row transforms
// and batching, all in the browser.

const fields: ImportField[] = [
  { key: "code", label: "Code", required: true, aliases: ["SKU"] },
  { key: "name", label: "Item name", required: true, aliases: [] },
  { key: "category", label: "Category", required: false, aliases: [] },
  { key: "group", label: "Group", required: false, aliases: [] },
];

describe("parseCsv", () => {
  it("reads quoted commas, quotes and line breaks, CRLF and a byte order mark", () => {
    expect(
      parseCsv(
        '﻿Code,Name,Notes\r\nCH-1,"Chair, gold","He said ""hi"""\r\nTB-1,Table,"two\nlines"\n',
      ),
    ).toEqual([
      ["Code", "Name", "Notes"],
      ["CH-1", "Chair, gold", 'He said "hi"'],
      ["TB-1", "Table", "two\nlines"],
    ]);
  });
  it("keeps a last row without a line ending and empty cells", () => {
    expect(parseCsv("a,b\n,2")).toEqual([
      ["a", "b"],
      ["", "2"],
    ]);
  });
});

describe("parseXlsx", () => {
  const workbook = (sheet: string, shared = "") =>
    zipSync({
      "xl/workbook.xml": strToU8(
        `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inventory" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
      "xl/_rels/workbook.xml.rels": strToU8(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
      "xl/worksheets/sheet1.xml": strToU8(
        `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet}</sheetData></worksheet>`,
      ),
      ...(shared
        ? {
            "xl/sharedStrings.xml": strToU8(
              `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${shared}</sst>`,
            ),
          }
        : {}),
    });

  it("reads shared, rich, inline, number and boolean cells into their columns and rows", () => {
    const sheet = parseXlsx(
      workbook(
        `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>` +
          `<row r="3"><c r="A3" t="inlineStr"><is><t>CH-1</t></is></c><c r="B3"><v>12.5</v></c><c r="C3" t="b"><v>1</v></c></row>`,
        `<si><t>Code</t></si><si><r><t>Act</t></r><r><t>ive</t></r><rPh><t>x</t></rPh></si>`,
      ),
    );
    expect(sheet).toEqual([
      ["Code", "", "Active"],
      [],
      ["CH-1", "12.5", "TRUE"],
    ]);
  });
  it("rejects a file that isn't a workbook", () => {
    expect(() => parseXlsx(strToU8("Code,Name"))).toThrow(
      "This file isn't a readable .xlsx workbook.",
    );
  });
});

describe("column mapping", () => {
  it("maps headings to fields by label, key or alias, ignoring case and punctuation", () => {
    expect(autoMap(["SKU", "ITEM NAME", "Notes", "category "], fields)).toEqual({
      code: 0,
      name: 1,
      category: 3,
      group: null,
    });
  });
  it("keeps the sheet's row numbers, below a heading that isn't on row 1", () => {
    const rows = mapRows(
      [[], ["Code", "Name"], ["CH-1", " Chair "], ["", ""], ["TB-1", "Table"]],
      { code: 0, name: 1, category: null },
    );
    expect(rows.map((row) => row.rowNumber)).toEqual([3, 5]);
    expect(rows[0].values).toEqual({ code: "CH-1", name: "Chair" });
  });
});

describe("row transforms", () => {
  const sheet = [
    ["Code", "Name", "Group"],
    ["SEATING", "", ""],
    ["CH-1", "Chiavari chair", "Chairs"],
    ["CH-2", "Folding chair", ""],
    ["TABLES", "", ""],
    ["TB-1", "Round table", "Tables"],
  ];
  const mapped = () =>
    mapRows(sheet, { code: 0, name: 1, group: 2, category: null });

  it("turns category heading rows into the category of the rows under them", () => {
    const rows = applyTransforms(mapped(), [
      { type: "category_headers", field: "category" },
    ]);
    expect(rows.map((row) => [row.rowNumber, row.values.code, row.values.category])).toEqual([
      [3, "CH-1", "SEATING"],
      [4, "CH-2", "SEATING"],
      [6, "TB-1", "TABLES"],
    ]);
  });
  it("fills a grouped row's blank field from the row above", () => {
    const rows = applyTransforms(mapped(), [
      { type: "category_headers", field: "category" },
      { type: "fill_down", field: "group" },
    ]);
    expect(rows.map((row) => row.values.group)).toEqual([
      "Chairs",
      "Chairs",
      "Tables",
    ]);
  });
  it("leaves rows alone without transforms", () => {
    expect(applyTransforms(mapped(), [])).toHaveLength(5);
  });
});

describe("batching (AC3)", () => {
  it("splits rows into requests of at most 100", () => {
    const rows = Array.from({ length: 250 }, (_, index) => index);
    expect(batches(rows).map((batch) => batch.length)).toEqual([100, 100, 50]);
    expect(batches([])).toEqual([]);
  });
  it("rejects a request with more than 100 rows", () => {
    const row = (rowNumber: number) => ({ rowNumber, values: { code: "x" } });
    const full = Array.from({ length: IMPORT_BATCH_SIZE }, (_, i) => row(i + 2));
    expect(importBatchSchema.safeParse({ rows: full }).success).toBe(true);
    expect(
      importBatchSchema.safeParse({ rows: [...full, row(200)] }).success,
    ).toBe(false);
  });
});
