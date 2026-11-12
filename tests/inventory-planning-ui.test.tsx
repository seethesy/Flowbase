import { TestAuth } from "./auth-provider";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { ItemPlanning } from "../src/features/inventory-planning";
import type { InventoryItem } from "../shared/inventory";

// Availability, conflicts and allocations on the item page (FLOW-224). The API
// answers; the screen shows what it returns.
const itemId = "a2240000-0000-4000-8000-000000000001";
const galaId = "a2240000-0000-4000-8000-0000000000e1";
const laterId = "a2240000-0000-4000-8000-0000000000e2";
const hiddenId = "a2240000-0000-4000-8000-0000000000e3";
const item = (kind: "rental" | "consumable") => ({ id: itemId, kind, unit: "each" }) as unknown as InventoryItem;
const mount = (kind: "rental" | "consumable") =>
  render(
    <TestAuth>
      <MemoryRouter>
        <ItemPlanning item={item(kind)} />
      </MemoryRouter>
    </TestAuth>,
  );

const hold = (over: Record<string, unknown>) => ({
  id: "a2240000-0000-4000-8000-0000000000b1", eventId: galaId, eventTitle: "Fall gala", eventDate: "2026-11-14",
  itemId, itemName: "Dinner plates", quantity: 80, status: "confirmed", windowStart: "2026-11-13",
  windowEnd: "2026-11-15", bookedAt: "2026-10-01T12:00:00.000Z", allocated: 80, shortfall: 0, issue: null, ...over,
});
const conflict = (over: Record<string, unknown>) => ({
  id: "a2240000-0000-4000-8000-0000000000c1", reservationId: "a2240000-0000-4000-8000-0000000000b2", itemId,
  itemName: "Dinner plates", eventId: laterId, eventTitle: "Booked later", eventDate: "2026-11-14", kind: "conflict",
  state: "open", quantity: 60, allocated: 20, shortfall: 40, openedAt: "2026-10-05T12:00:00.000Z",
  resolution: null, resolvedBy: null, resolvedAt: null, ...over,
});

it("changes the availability when the date range changes (AC1) and links each hold and conflict to its event", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === `/api/inventory/items/${itemId}/conflicts`) return Response.json([conflict({})]);
    if (url.pathname === `/api/inventory/items/${itemId}/availability`) {
      const busy = url.searchParams.get("from") === "2026-11-14";
      return Response.json({
        itemId, from: url.searchParams.get("from"), to: url.searchParams.get("to"), onRequest: false, owned: 100,
        available: busy ? 20 : 100, availableWithTentative: busy ? 0 : 100,
        holds: busy ? [hold({}), hold({ id: "a2240000-0000-4000-8000-0000000000b2", eventId: laterId,
          eventTitle: "Booked later", quantity: 60, allocated: 20, shortfall: 40, issue: "conflict", status: "tentative" })] : [],
      });
    }
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  mount("rental");
  expect(await screen.findByRole("row", { name: /^Available 100\b/ })).toBeInTheDocument();
  expect(await screen.findByText("Nothing is held in this range.")).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-11-14" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-11-15" } });
  expect(await screen.findByRole("row", { name: /^Available 20\b/ })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /^Available with tentative holds 0\b/ })).toBeInTheDocument();
  const holds = screen.getByRole("heading", { name: "Holds in this range" }).nextElementSibling as HTMLElement;
  expect(within(holds).getByRole("link", { name: "Fall gala" })).toHaveAttribute("href", `/events/${galaId}`);
  expect(within(holds).getByText(/Conflict: 40 short/)).toBeInTheDocument();
  // The open conflict links to its event.
  expect(await screen.findByRole("link", { name: /Booked later\s+·/ })).toHaveAttribute("href", `/events/${laterId}`);
});

it("asks for a range that ends on or after it starts, without requesting it", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname.endsWith("/conflicts")) return Response.json([]);
    return Response.json({ itemId, from: "2026-11-01", to: "2026-11-02", onRequest: true, owned: 0,
      available: null, availableWithTentative: null, holds: [] });
  });
  mount("rental");
  expect(await screen.findAllByText("Available on request")).toHaveLength(2);
  const before = vi.mocked(fetch).mock.calls.length;
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2099-01-02" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2099-01-01" } });
  expect(await screen.findByRole("alert")).toHaveTextContent("ends on or after");
  expect(vi.mocked(fetch).mock.calls.slice(before).some(([path]) => String(path).includes("2099-01-02"))).toBe(false);
});

it("lists a consumable's allocations in booking order, matching the wine fixtures (AC2), and hides titles it was not given", async () => {
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input) !== `/api/inventory/items/${itemId}/allocations`) throw new Error(`Unexpected request ${String(input)}`);
    return Response.json([
      { eventId: galaId, eventTitle: "Fall gala", eventDate: "2026-12-05", bookedAt: "2026-10-01T12:00:00.000Z",
        required: 80, allocated: 80, shortage: 0, projectedStock: 100, orderBy: null },
      { eventId: laterId, eventTitle: "Booked later", eventDate: "2026-12-10", bookedAt: "2026-10-05T12:00:00.000Z",
        required: 60, allocated: 20, shortage: 40, projectedStock: 20, orderBy: "2026-12-07" },
      { eventId: hiddenId, eventTitle: null, eventDate: "2026-12-12", bookedAt: "2026-10-06T12:00:00.000Z",
        required: 10, allocated: 0, shortage: 10, projectedStock: 0, orderBy: "2026-12-09" },
    ]);
  });
  mount("consumable");
  const table = await screen.findByRole("table", { name: "Allocations in booking order" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows).toHaveLength(3);
  const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => cell.textContent ?? "");
  expect(cells(rows[0])[0]).toBe("Fall gala");
  expect(cells(rows[0]).slice(2).map((text) => parseFloat(text) || text)).toEqual([80, 80, "—", 100, "—"]);
  expect(cells(rows[1]).slice(2, 6).map((text) => parseFloat(text))).toEqual([60, 20, 40, 20]);
  expect(cells(rows[1])[6]).toMatch(/Dec 7, 2026/);
  expect(within(rows[0]).getByRole("link", { name: "Fall gala" })).toHaveAttribute("href", `/events/${galaId}`);
  expect(within(rows[2]).queryByRole("link")).not.toBeInTheDocument();
  expect(within(rows[2]).getByText("An event you can't open")).toBeInTheDocument();
});

it("renders nothing for a service, which has no stock to commit", () => {
  const view = render(
    <TestAuth><MemoryRouter><ItemPlanning item={{ id: itemId, kind: "service", unit: "each" } as unknown as InventoryItem} /></MemoryRouter></TestAuth>,
  );
  expect(view.container).toBeEmptyDOMElement();
});
