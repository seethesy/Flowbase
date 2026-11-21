import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { TestAuth } from "./auth-provider";
import { DataTable, type DeleteResult } from "../src/components/shared";

// FLOW-260: selection, bulk bar, Delete + Undo on the shared DataTable.
type Row = { id: string; name: string };
const all: Row[] = ["Alpha", "Bravo", "Charlie", "Delta", "Echo"].map((name, i) => ({ id: `r${i}`, name }));
const columns: ColumnDef<Row, unknown>[] = [{ accessorKey: "name", header: "Name" }];

function Harness({
  onDelete,
  onRestore,
  onRow = () => {},
}: {
  onDelete?: (ids: string[]) => Promise<DeleteResult>;
  onRestore?: (ids: string[]) => Promise<void>;
  onRow?: (row: Row) => void;
}) {
  const [rows, setRows] = useState(all);
  return (
    <TestAuth>
      <DataTable
        data={rows}
        columns={columns}
        onRow={onRow}
        selection={{
          rowId: (row) => row.id,
          onDelete: onDelete
            ? async (ids) => {
                const result = await onDelete(ids);
                setRows((list) => list.filter((row) => !result.deleted.includes(row.id)));
                return result;
              }
            : undefined,
          onRestore: onRestore
            ? async (ids) => {
                await onRestore(ids);
                setRows(all);
              }
            : undefined,
        }}
      />
    </TestAuth>
  );
}
const row = (name: string) => screen.getByRole("cell", { name }).closest("tr")!;
const names = () => screen.getAllByRole("row").filter((tr) => tr.getAttribute("aria-selected") === "true").map((tr) => tr.textContent);

it("drag, Shift+click and Ctrl+click select like Excel; a plain click opens the row instead (AC1)", async () => {
  const user = userEvent.setup();
  const onRow = vi.fn();
  render(<Harness onRow={onRow} />);
  await user.click(screen.getByRole("button", { name: "Alpha" }));
  expect(onRow).toHaveBeenCalledTimes(1);
  expect(names()).toEqual([]);

  await user.pointer([{ keys: "[MouseLeft>]", target: row("Alpha") }, { target: row("Bravo") }, { target: row("Charlie") }, { keys: "[/MouseLeft]" }]);
  expect(names()).toEqual(["Alpha", "Bravo", "Charlie"]);
  // The click that ends a drag doesn't open the row.
  expect(onRow).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("region", { name: "Selected rows" })).toHaveTextContent("3 selected");

  await user.keyboard("{Control>}");
  await user.click(row("Echo"));
  await user.keyboard("{/Control}");
  expect(names()).toEqual(["Alpha", "Bravo", "Charlie", "Echo"]);

  await user.keyboard("{Shift>}");
  await user.click(row("Delta"));
  await user.keyboard("{/Shift}");
  expect(names()).toEqual(["Delta", "Echo"]);
  expect(onRow).toHaveBeenCalledTimes(1);

  await user.click(screen.getByRole("button", { name: "Clear" }));
  expect(names()).toEqual([]);
});

it("deletes the selection, skips blocked rows with their reason, and Undo or Ctrl+Z restores (AC2, AC3)", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const onDelete = vi.fn(async (ids: string[]) => ({
    deleted: ids.filter((id) => id !== "r1"),
    skipped: ids.includes("r1") ? [{ id: "r1", name: "Bravo", reason: "has a signed contract" }] : [],
  }));
  const onRestore = vi.fn(async () => {});
  render(<Harness onDelete={onDelete} onRestore={onRestore} />);
  await user.pointer([{ keys: "[MouseLeft>]", target: row("Alpha") }, { target: row("Bravo") }, { target: row("Charlie") }, { keys: "[/MouseLeft]" }]);
  await user.click(within(screen.getByRole("region", { name: "Selected rows" })).getByRole("button", { name: "Delete" }));
  expect(onDelete).toHaveBeenCalledWith(["r0", "r1", "r2"]);
  const toast = screen.getByRole("status");
  expect(toast).toHaveTextContent("2 deleted.");
  expect(toast).toHaveTextContent("1 skipped: Bravo has a signed contract");
  expect(screen.queryByRole("cell", { name: "Alpha" })).not.toBeInTheDocument();
  expect(screen.getByRole("cell", { name: "Bravo" })).toBeInTheDocument();

  await user.keyboard("{Control>}z{/Control}");
  expect(onRestore).toHaveBeenCalledWith(["r0", "r2"]);
  expect(screen.getByRole("cell", { name: "Alpha" })).toBeInTheDocument();
  expect(screen.queryByRole("status")).not.toBeInTheDocument();

  // The Delete key deletes when the table has focus; the toast goes after 10 seconds.
  await user.pointer([{ keys: "[MouseLeft>]", target: row("Delta") }, { target: row("Echo") }, { keys: "[/MouseLeft]" }]);
  row("Delta").closest<HTMLElement>(".table-card")!.focus();
  await user.keyboard("{Delete}");
  expect(onDelete).toHaveBeenLastCalledWith(["r3", "r4"]);
  await user.click(within(screen.getByRole("status")).getByRole("button", { name: /Undo/ }));
  expect(onRestore).toHaveBeenLastCalledWith(["r3", "r4"]);
  await user.pointer([{ keys: "[MouseLeft>]", target: row("Delta") }, { target: row("Echo") }, { keys: "[/MouseLeft]" }]);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  act(() => {
    vi.advanceTimersByTime(10_001);
  });
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  vi.useRealTimers();
});

it("shows no Delete to someone who can't edit (AC4)", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.pointer([{ keys: "[MouseLeft>]", target: row("Alpha") }, { target: row("Bravo") }, { keys: "[/MouseLeft]" }]);
  expect(screen.getByRole("region", { name: "Selected rows" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
});
