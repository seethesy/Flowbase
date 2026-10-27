import { unzipSync } from "fflate";

// Reads an import file in the browser (FLOW-47, ADR-09): CSV or XLSX into rows of
// cell text, top row first. Only the first worksheet of a workbook is read.
// Numbers come through as stored (a date cell is its serial number); module
// importers parse their own values.
export type Sheet = string[][];

// RFC 4180 CSV: quoted fields may hold commas, quotes ("") and line breaks. A
// leading byte order mark is ignored; CRLF and LF both end a row.
export function parseCsv(text: string): Sheet {
  const source = text.replace(/^﻿/, "");
  const rows: Sheet = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const xml = (bytes: Uint8Array | undefined) =>
  bytes
    ? new DOMParser().parseFromString(
        new TextDecoder().decode(bytes),
        "application/xml",
      )
    : null;
const elements = (node: Document | Element, name: string) =>
  Array.from(node.getElementsByTagName(name));

// Text of a shared or inline string: its runs, without phonetic guides.
const stringText = (node: Element) =>
  elements(node, "t")
    .filter((t) => t.parentElement?.tagName !== "rPh")
    .map((t) => t.textContent ?? "")
    .join("");

// "C12" -> column 2 (zero-based), row 11.
function cellPosition(reference: string) {
  const match = /^([A-Z]+)(\d+)$/.exec(reference);
  if (!match) return null;
  let column = 0;
  for (const letter of match[1]) column = column * 26 + letter.charCodeAt(0) - 64;
  return { column: column - 1, row: Number(match[2]) - 1 };
}

export function parseXlsx(bytes: Uint8Array): Sheet {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("This file isn't a readable .xlsx workbook.");
  }
  const workbook = xml(files["xl/workbook.xml"]);
  const relations = xml(files["xl/_rels/workbook.xml.rels"]);
  const first = workbook && elements(workbook, "sheet")[0];
  if (!workbook || !relations || !first)
    throw new Error("This file isn't a readable .xlsx workbook.");
  const relationId = first.getAttribute("r:id");
  const target = elements(relations, "Relationship")
    .find((relation) => relation.getAttribute("Id") === relationId)
    ?.getAttribute("Target");
  const path = target?.startsWith("/")
    ? target.slice(1)
    : `xl/${target ?? "worksheets/sheet1.xml"}`;
  const worksheet = xml(files[path]);
  if (!worksheet) throw new Error("The workbook's first sheet is missing.");
  const shared = xml(files["xl/sharedStrings.xml"]);
  const strings = shared ? elements(shared, "si").map(stringText) : [];

  const sheet: Sheet = [];
  elements(worksheet, "row").forEach((rowNode, rowOrder) => {
    const rowIndex = Number(rowNode.getAttribute("r") ?? rowOrder + 1) - 1;
    const cells: string[] = [];
    elements(rowNode, "c").forEach((cellNode, cellOrder) => {
      const position = cellPosition(cellNode.getAttribute("r") ?? "");
      const column = position?.column ?? cellOrder;
      const type = cellNode.getAttribute("t");
      const value = elements(cellNode, "v")[0]?.textContent ?? "";
      const text =
        type === "s"
          ? (strings[Number(value)] ?? "")
          : type === "inlineStr"
            ? stringText(cellNode)
            : type === "b"
              ? value === "1"
                ? "TRUE"
                : "FALSE"
              : value;
      while (cells.length < column) cells.push("");
      cells[column] = text;
    });
    while (sheet.length < rowIndex) sheet.push([]);
    sheet[rowIndex] = cells;
  });
  return sheet;
}

// Reads a chosen file by its extension.
export async function readImportFile(file: File): Promise<Sheet> {
  const name = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (name.endsWith(".csv")) return parseCsv(new TextDecoder().decode(bytes));
  if (name.endsWith(".xlsx")) return parseXlsx(bytes);
  throw new Error("Choose a .csv or .xlsx file.");
}
