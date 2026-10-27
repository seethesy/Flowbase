import { utcToBusinessTime } from "../../shared/time";

// List export (FLOW-48). Files are built in the browser from the rows on screen
// (ADR-09): the list's current filter and sort, and only fields the API returned.
export type CsvValue = string | number | boolean | null | undefined;

// Spreadsheet apps run a cell that starts with one of these as a formula; such
// text gets a leading apostrophe so a name like "=1+1" stays text.
const formulaStart = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const text = formulaStart.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

// RFC 4180: comma-separated, CRLF line endings, a header row first.
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  return [headers, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")
    .concat("\r\n");
}

// e.g. "staff-2026-10-26.csv", dated in New York.
export function csvFileName(name: string, now = new Date()): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "export";
  return `${slug}-${utcToBusinessTime(now).date}.csv`;
}

export function downloadCsv(fileName: string, csv: string) {
  // The byte order mark makes Excel read the file as UTF-8.
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
