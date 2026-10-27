import { TestAuth } from "./auth-provider";
import { render, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { useResource } from "../src/app/useResource";
import { request } from "../src/services/core";
import { MovementForm, StockForm } from "../src/features/inventory-stock-forms";
import type { InventoryItem, Section } from "../shared/inventory";
import { z } from "zod";

// FLOW-189 AC3: data several forms on one page use is fetched once (TanStack
// Query), and a save makes the next screen that opens it fetch it again.
const now = "2026-10-22T09:00:00.000Z";
const section: Section = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Warehouse",
  kind: "rental",
  totalQuantity: 4,
  archivedAt: null,
};
const item: InventoryItem = {
  id: "a0000000-0000-4000-8000-0000000000b1",
  kind: "rental",
  subtype: "equipment",
  code: "",
  name: "Chafing dish",
  category: "",
  description: "",
  unit: "each",
  group: "",
  color: "",
  tier: "",
  ratio: null,
  active: true,
  rental: { priceCents: null, dimensions: "", colors: [], notes: "", assemblyNotes: "", bufferDaysBefore: 1, bufferDaysAfter: 1, vendorId: null, leadTimeDays: null, vendorName: null, components: [] },
  consumable: null,
  service: null,
  bar: null,
  stock: [{ sectionId: section.id, sectionName: section.name, quantity: 4 }],
  totalQuantity: 4,
  belowPar: null,
  archivedAt: null,
  createdAt: now,
  updatedAt: now,
};
// Lets any request the render would start reach fetch.
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const sectionRequests = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([input]) =>
      String(input).startsWith("/api/inventory/sections"),
    ).length;

it("fetches the sections once for two stock forms on one page", async () => {
  vi.mocked(fetch).mockImplementation(async () => Response.json([section]));
  const page = (
    <TestAuth>
      <MemoryRouter>
        <StockForm
          item={item}
          mode="transfer"
          onClose={() => {}}
          onSaved={() => {}}
        />
        <MovementForm item={item} onClose={() => {}} onSaved={() => {}} />
      </MemoryRouter>
    </TestAuth>
  );
  const { unmount } = render(page);
  await waitFor(() => expect(sectionRequests()).toBe(1));
  await settle();
  expect(sectionRequests()).toBe(1);
  // Closing the forms and opening them again on the same page reuses the list.
  unmount();
  render(page);
  await settle();
  expect(sectionRequests()).toBe(1);
});

it("shares one request per key and refetches after a save", async () => {
  let loads = 0;
  const load = async () => {
    loads += 1;
    return ["Warehouse"];
  };
  const useTwice = () => [
    useResource(["reference-test"], load, { reference: true }),
    useResource(["reference-test"], load, { reference: true }),
  ];
  const first = renderHook(useTwice);
  await waitFor(() =>
    expect(first.result.current[1].data).toEqual(["Warehouse"]),
  );
  expect(loads).toBe(1);
  first.unmount();

  // Any save goes through request(); afterwards cached data is stale.
  vi.mocked(fetch).mockImplementation(async () => Response.json({ ok: true }));
  await request(z.object({ ok: z.boolean() }), "/api/anything", "POST", {});
  const second = renderHook(useTwice);
  await waitFor(() => expect(loads).toBe(2));
  expect(second.result.current[0].data).toEqual(["Warehouse"]);
});
