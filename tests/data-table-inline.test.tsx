import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { ColumnDef } from "@tanstack/react-table";
import { TestAuth } from "./auth-provider";
import { DataTable, EditableCell } from "../src/components/shared";

type Row = { id: string; name: string; stock: number };
const row: Row = { id: "one", name: "Old", stock: 7 };

it("edits a declared field, saves on Enter, cancels on Escape, and rolls back a failed save", async () => {
  const user = userEvent.setup();
  const save = vi.fn<(_row: Row, _value: string) => Promise<void>>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Save refused"));
  const columns: ColumnDef<Row, unknown>[] = [
    { accessorKey: "name", header: "Name", meta: { edit: "text", onEdit: save } },
    { accessorKey: "stock", header: "On hand", meta: { edit: "none" } },
  ];
  render(<TestAuth><DataTable data={[row]} columns={columns} onRow={() => {}} openColumn /></TestAuth>);
  await user.click(screen.getByRole("button", { name: "Old" }));
  const input = screen.getByRole("textbox");
  await user.clear(input);
  await user.type(input, "New{Enter}");
  expect(save).toHaveBeenCalledWith(row, "New");
  await user.click(screen.getByRole("button", { name: "New" }));
  await user.type(screen.getByRole("textbox"), " ignored{Escape}");
  expect(save).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "New" }));
  await user.clear(screen.getByRole("textbox"));
  await user.type(screen.getByRole("textbox"), "Rejected{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent("Save refused");
  expect(screen.getByRole("button", { name: "Old" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "7" })).not.toBeInTheDocument();
});

// FLOW-275: outside a table (All tasks, the Proposals tracker) the field name is
// the button's title and the open editor's accessible name.
it("names a labelled inline field and saves it like a table cell", async () => {
  const user = userEvent.setup();
  const save = vi.fn<(_row: Row, _value: string) => Promise<void>>().mockResolvedValue(undefined);
  render(<TestAuth><EditableCell label="Position" row={row} edit="text" value="" save={save} /></TestAuth>);
  await user.click(screen.getByTitle("Position"));
  await user.type(screen.getByRole("textbox", { name: "Position" }), "Server{Enter}");
  expect(save).toHaveBeenCalledWith(row, "Server");
  expect(screen.getByTitle("Position")).toHaveTextContent("Server");
});
