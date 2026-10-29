import { expect, it } from "vitest";
import { suggestOrderLines } from "../shared/order-lists";

it("rounds a ten bottle shortage up to one twelve-bottle case", () => {
  const lines = suggestOrderLines([{
    itemId: "00000000-0000-4000-8000-000000000001", itemName: "Wine",
    unit: "each", purchaseUnit: "case", packCount: 12, eachSize: null,
    vendorId: null, vendorName: "Wine supplier", orderingInstructions: "Order by phone",
    onHand: 20, parLevel: null,
    shortages: [{ eventId: "00000000-0000-4000-8000-000000000002", eventTitle: "Gala",
      quantity: 10, orderBy: "2026-11-02" }],
  }]);
  expect(lines).toMatchObject([{ quantity: 1, purchaseUnit: "case", shortage: 10,
    orderBy: "2026-11-02", eventTitles: ["Gala"] }]);
});

it("uses the larger of par gap and event shortage, without double ordering", () => {
  const lines = suggestOrderLines([{
    itemId: "00000000-0000-4000-8000-000000000001", itemName: "Napkins",
    unit: "each", purchaseUnit: "dozen", packCount: null, eachSize: null,
    vendorId: null, vendorName: "", orderingInstructions: "", onHand: 2, parLevel: 20,
    shortages: [{ eventId: "00000000-0000-4000-8000-000000000002", eventTitle: "Gala",
      quantity: 10, orderBy: null }],
  }]);
  expect(lines[0]).toMatchObject({ quantity: 2, shortage: 18 });
});
