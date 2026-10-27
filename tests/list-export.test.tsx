import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { TestAuth } from "./auth-provider";
import { DataTable } from "../src/components/shared";
import { csvCell, csvFileName, toCsv } from "../src/services/csv";
import type { Role, EmploymentType } from "../shared/access";

it("escapes commas, quotes and line breaks per RFC 4180", () => {
  expect(csvCell("plain")).toBe("plain");
  expect(csvCell("Smith, Jane")).toBe('"Smith, Jane"');
  expect(csvCell('The "Glasshouse"')).toBe('"The ""Glasshouse"""');
  expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  expect(csvCell(12.5)).toBe("12.5");
  expect(csvCell(Number.NaN)).toBe("");
  expect(csvCell(null)).toBe("");
  expect(csvCell(undefined)).toBe("");
  expect(csvCell(true)).toBe("Yes");
  expect(toCsv(["A", "B"], [["1", "x,y"], [null, 2]])).toBe(
    'A,B\r\n1,"x,y"\r\n,2\r\n',
  );
});

it("keeps text that looks like a formula as text", () => {
  for (const value of ["=HYPERLINK(\"x\")", "+1", "-2+3", "@SUM(A1)"])
    expect(csvCell(value)).toBe(`'${value}`);
  expect(csvCell("=1,2")).toBe(`"'=1,2"`);
  // Numbers stay numbers.
  expect(csvCell(-3)).toBe("-3");
});

it("names files after the list and the New York date", () => {
  expect(csvFileName("Low stock", new Date("2026-10-27T02:00:00Z"))).toBe(
    "low-stock-2026-10-26.csv",
  );
  expect(csvFileName("!!!", new Date("2026-10-27T15:00:00Z"))).toBe(
    "export-2026-10-27.csv",
  );
});

type Row = { name: string; cost: number | null; phone: string | null };
const rows: Row[] = [
  { name: "Brioche", cost: 450, phone: "202-555-0101" },
  { name: "Arugula, baby", cost: 1299, phone: null },
  { name: "Cream", cost: 899, phone: "202-555-0103" },
  ...Array.from({ length: 10 }, (_, i) => ({
    name: `Item ${String(i).padStart(2, "0")}`,
    cost: i,
    phone: null,
  })),
];
const columns: ColumnDef<Row, unknown>[] = [
  { id: "select", header: "Select", cell: () => <input type="checkbox" /> },
  { accessorKey: "name", header: "Item" },
  {
    id: "cost",
    header: "Unit cost",
    accessorFn: (row) => (row.cost === null ? "Hidden" : `$${row.cost / 100}`),
    meta: {
      fieldGroup: "internal_cost",
      csv: (row) => (row.cost === null ? "" : (row.cost / 100).toFixed(2)),
    },
  },
  {
    id: "phone",
    header: "Phone",
    accessorFn: (row) => row.phone ?? "—",
    meta: { fieldGroup: "client_contact" },
  },
];

let exported: Blob[] = [];
afterEach(() => {
  exported = [];
  vi.restoreAllMocks();
});
const exportFile = async (
  data: Row[],
  role: Role,
  employmentType: EmploymentType,
  sortBy?: string,
) => {
  // jsdom has no object URLs; capture the file instead.
  URL.createObjectURL = (blob: Blob | MediaSource) => {
    exported.push(blob as Blob);
    return "blob:export";
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const view = render(
    <TestAuth role={role} employmentType={employmentType}>
      <DataTable data={data} columns={columns} label="items" exportName="items" />
    </TestAuth>,
  );
  if (sortBy) await userEvent.click(screen.getByRole("button", { name: sortBy }));
  await userEvent.click(screen.getByRole("button", { name: "Export CSV" }));
  view.unmount();
  const text = await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(exported[0]);
  });
  return text.replace(/^﻿/, "").trimEnd().split("\r\n");
};

it("exports every filtered row in the current sort, not just the page on screen (AC1)", async () => {
  // The screen filtered the list down to these rows; the table shows 8 per page.
  const filtered = rows.filter((row) => row.name !== "Cream");
  const lines = await exportFile(filtered, "admin", "full_time", "Item");
  expect(lines[0]).toBe("Item,Unit cost,Phone");
  expect(lines).toHaveLength(filtered.length + 1);
  expect(lines.slice(1, 3)).toEqual([
    '"Arugula, baby",12.99,—',
    "Brioche,4.50,202-555-0101",
  ]);
  expect(lines.some((line) => line.startsWith("Cream"))).toBe(false);
  expect(lines.at(-1)).toBe("Item 09,0.09,—");
});

it("leaves hidden field groups out of the file (AC2)", async () => {
  // Kitchen Staff see costs but not client contacts when part-time; Staff see neither.
  expect((await exportFile(rows, "kitchen_staff", "part_time"))[0]).toBe(
    "Item,Unit cost",
  );
  exported = [];
  const staff = await exportFile(rows, "staff", "part_time");
  expect(staff[0]).toBe("Item");
  expect(staff.join("\n")).not.toMatch(/202-555|12\.99|Hidden/);
});

it("disables export for an empty list", () => {
  render(
    <TestAuth>
      <DataTable data={[]} columns={columns} exportName="items" />
    </TestAuth>,
  );
  expect(screen.getByRole("button", { name: "Export CSV" })).toBeDisabled();
});
