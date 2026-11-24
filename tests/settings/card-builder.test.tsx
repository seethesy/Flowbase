import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { queryClient } from "../../src/app/queryClient";
import {
  CardBuilder,
  cardSaveProblem,
  pickedFields,
  switchDisplay,
  withPickedFields,
} from "../../src/app/live-edit/card-builder";
import { cardConfigSchema, type CardConfig } from "../../shared/layout";
import { TestAuth } from "../auth-provider";

// FLOW-327: the Add/Edit card drawer: one Fields picker for Table and Boxes,
// Save card disabled with a reason, and an existing card's config round-trips
// through the drawer unchanged.

const eventsTable: CardConfig = cardConfigSchema.parse({
  title: "Upcoming events",
  source: { type: "list", list: "events" },
  filters: [{ field: "status", op: "is_not", value: "lost" }],
  sort: { field: "date", dir: "desc" },
  limit: 5,
  display: { type: "table", columns: [{ key: "title", width: 180 }, { key: "date" }] },
});
const boxesCard: CardConfig = cardConfigSchema.parse({
  title: "Facts",
  source: { type: "record" },
  display: {
    type: "boxes",
    boxes: [
      { id: "heading-1", kind: "heading", text: "About", x: 0, y: 0, w: 12, h: 2 },
      { id: "field-1", kind: "field", field: "name", x: 0, y: 2, w: 6, h: 2 },
      { id: "field-2", kind: "field", field: "email", x: 6, y: 2, w: 6, h: 2 },
    ],
  },
});

describe("card fields", () => {
  it("reads and sets the picked fields of both displays without touching the rest", () => {
    expect(pickedFields(eventsTable)).toEqual(["title", "date"]);
    expect(pickedFields(boxesCard)).toEqual(["name", "email"]);
    // Same fields back: the very same config.
    expect(withPickedFields(eventsTable, pickedFields(eventsTable))).toEqual(eventsTable);
    expect(withPickedFields(boxesCard, pickedFields(boxesCard))).toEqual(boxesCard);
    // Columns keep their widths when reordered; a new one joins at the end.
    expect(withPickedFields(eventsTable, ["date", "title", "status"]).display).toEqual({
      type: "table",
      columns: [{ key: "date" }, { key: "title", width: 180 }, { key: "status" }],
    });
    // Unpicking a field box keeps text boxes and the other field's place.
    const fewer = withPickedFields(boxesCard, ["email"]);
    expect(fewer.display.type === "boxes" && fewer.display.boxes.map((box) => box.id)).toEqual(["heading-1", "field-2"]);
  });

  it("carries the picked fields across Table | Boxes", () => {
    expect(switchDisplay(eventsTable, "table")).toBe(eventsTable);
    const boxes = switchDisplay(eventsTable, "boxes");
    expect(pickedFields(boxes)).toEqual(["title", "date"]);
    expect(pickedFields(switchDisplay(boxes, "table"))).toEqual(["title", "date"]);
  });

  it("gives a reason Save card is disabled (AC4)", () => {
    expect(cardSaveProblem(eventsTable, "events")).toBeNull();
    expect(cardSaveProblem(eventsTable, null)).toMatch(/source/);
    expect(cardSaveProblem({ ...eventsTable, title: " " }, "events")).toMatch(/title/);
    expect(cardSaveProblem(withPickedFields(eventsTable, []), "events")).toMatch(/at least one field/);
    // A text box alone isn't a field.
    expect(cardSaveProblem(withPickedFields(boxesCard, []), "staff")).toMatch(/at least one field/);
  });
});

function mount(card: CardConfig, onDone: (card: CardConfig) => void) {
  render(
    <QueryClientProvider client={queryClient}>
      <TestAuth role="admin">
        <MemoryRouter>
          <CardBuilder initial={card} recordSource={null} onDone={onDone} onCancel={() => {}} />
        </MemoryRouter>
      </TestAuth>
    </QueryClientProvider>,
  );
}

describe("the card drawer", () => {
  beforeEach(() => {
    queryClient.clear();
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = String(input);
      if (path.startsWith("/api/events"))
        return Response.json([{ id: "e1", title: "Synthetic gala", date: "2026-12-01", status: "booked" }]);
      return Response.json([]);
    });
  });

  it("opens an existing card filled in and saves it unchanged (AC3)", async () => {
    const onDone = vi.fn();
    mount(eventsTable, onDone);
    const drawer = screen.getByRole("dialog", { name: "Card builder" });
    expect(within(drawer).getByLabelText("Title")).toHaveProperty("value", "Upcoming events");
    expect(within(drawer).getByRole("radio", { name: "Table" }).getAttribute("aria-checked")).toBe("true");
    expect(within(drawer).getByRole("checkbox", { name: "Show Event" })).toHaveProperty("checked", true);
    expect(within(drawer).getByRole("spinbutton", { name: "Row limit" })).toHaveProperty("value", "5");
    expect(within(drawer).getAllByRole("combobox", { name: "Filter field" })).toHaveLength(1);
    fireEvent.click(within(drawer).getByRole("button", { name: "Save card" }));
    expect(onDone).toHaveBeenCalledWith(eventsTable);
  });

  it("previews picked fields and disables Save card with a reason when none is picked (AC2, AC4)", async () => {
    const onDone = vi.fn();
    mount(withPickedFields(eventsTable, ["title"]), onDone);
    const drawer = screen.getByRole("dialog", { name: "Card builder" });
    const preview = within(drawer).getByRole("region", { name: "Preview" });
    await waitFor(() => expect(within(preview).getByText("Synthetic gala")).toBeTruthy());
    fireEvent.click(within(drawer).getByRole("checkbox", { name: "Show Event" }));
    const save = within(drawer).getByRole("button", { name: "Save card" });
    expect(save).toHaveProperty("disabled", true);
    expect(within(drawer).getByText("Pick at least one field to show.")).toBeTruthy();
    // Picking a field through search brings Save back, with that field.
    fireEvent.change(within(drawer).getByRole("searchbox", { name: "Search fields" }), { target: { value: "dat" } });
    fireEvent.click(within(drawer).getByRole("checkbox", { name: "Show Date" }));
    fireEvent.click(within(drawer).getByRole("radio", { name: "Boxes" }));
    expect(save).toHaveProperty("disabled", false);
    fireEvent.click(save);
    expect(pickedFields(onDone.mock.calls[0][0])).toEqual(["date"]);
    expect(onDone.mock.calls[0][0].display.type).toBe("boxes");
  });
});
