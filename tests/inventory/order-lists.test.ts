import { expect, it } from "vitest";
import { applyReceipt, estimatedTotalCents, isDeletableList, listStatusFromOrders, listVendors,
  orderListNotesSchema, orderListStatuses, outstanding, recordOrderInputSchema,
  suggestOrderLines } from "../../shared/order-lists";

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

// The Order tab reorders items at par too (FLOW-292, Ash 2026-11-23).
it("orders one purchase unit of an item exactly at par only from the Order tab", () => {
  const atPar = {
    itemId: "00000000-0000-4000-8000-000000000001", itemName: "Napkins",
    unit: "each" as const, purchaseUnit: "dozen" as const, packCount: null, eachSize: null,
    vendorId: null, vendorName: "", orderingInstructions: "", onHand: 20, parLevel: 20, shortages: [],
  };
  expect(suggestOrderLines([atPar])).toEqual([]);
  expect(suggestOrderLines([atPar], { atPar: true })).toMatchObject([{ quantity: 1, purchaseUnit: "dozen", shortage: 0 }]);
  expect(suggestOrderLines([{ ...atPar, onHand: 21 }], { atPar: true })).toEqual([]);
  expect(suggestOrderLines([{ ...atPar, onHand: 0, parLevel: 0 }], { atPar: true })).toEqual([]);
});

// Ordering record (FLOW-87) and receiving (FLOW-88).
const wine = "00000000-0000-4000-8000-000000000001";
const glasses = "00000000-0000-4000-8000-000000000003";
const orderLine = (itemId: string, ordered: number, received = 0) => ({ itemId, itemName: "Item",
  purchaseUnit: "case", approvedQuantity: ordered, ordered, received, note: "" });

it("requires the portal order number and expected delivery date to record an order (FLOW-87 AC1)", () => {
  const base = { vendorName: "Wine vendor", portalOrderNumber: "PO-1", orderedOn: "2026-11-03",
    expectedDelivery: "2026-11-06" };
  expect(recordOrderInputSchema.safeParse(base).success).toBe(true);
  expect(recordOrderInputSchema.safeParse({ ...base, portalOrderNumber: "  " }).success).toBe(false);
  expect(recordOrderInputSchema.safeParse({ ...base, expectedDelivery: undefined }).success).toBe(false);
  expect(recordOrderInputSchema.safeParse({ ...base, expectedDelivery: "2026-11-01" }).success).toBe(false);
});

it("moves a list through ordered, partially received and received as its vendor orders do", () => {
  const vendors = ["Produce", "Wine vendor"];
  expect(listStatusFromOrders(vendors, [])).toBe("approved");
  expect(listStatusFromOrders(vendors, [{ vendorName: "Wine vendor", status: "ordered" }])).toBe("ordered");
  expect(listStatusFromOrders(vendors, [{ vendorName: "Wine vendor", status: "partially_received" },
    { vendorName: "Produce", status: "ordered" }])).toBe("partially_received");
  // One vendor received while another isn't ordered yet: not received.
  expect(listStatusFromOrders(vendors, [{ vendorName: "Wine vendor", status: "received" }])).toBe("partially_received");
  // A vendor's cancelled order is that vendor's part done.
  expect(listStatusFromOrders(vendors, [{ vendorName: "Wine vendor", status: "received" },
    { vendorName: "Produce", status: "cancelled" }])).toBe("received");
  expect(listStatusFromOrders(vendors, [{ vendorName: "Wine vendor", status: "received" },
    { vendorName: "Produce", status: "cancelled" }, { vendorName: "Produce", status: "ordered" }])).toBe("partially_received");
  expect(listStatusFromOrders(vendors, [{ vendorName: "Wine vendor", status: "cancelled" },
    { vendorName: "Produce", status: "cancelled" }])).toBe("cancelled");
  expect(listStatusFromOrders(vendors, [{ vendorName: "Wine vendor", status: "cancelled" }])).toBe("approved");
  expect(listVendors([{ vendorName: "B", quantity: 1 }, { vendorName: "A", quantity: 2 },
    { vendorName: "C", quantity: 0 }])).toEqual(["A", "B"]);
});

it("receiving 2 of 3 cases leaves the order partially received with 1 case to come (FLOW-88 AC1)", () => {
  const first = applyReceipt([orderLine(wine, 3), orderLine(glasses, 1)],
    [{ itemId: wine, quantity: 2, note: "1 case short" }, { itemId: glasses, quantity: 1, note: "" }], false);
  expect(first.status).toBe("partially_received");
  expect(first.lines[0]).toMatchObject({ received: 2, note: "1 case short" });
  expect(outstanding(first.lines[0])).toBe(1);
  expect(outstanding(first.lines[1])).toBe(0);
  const second = applyReceipt(first.lines, [{ itemId: wine, quantity: 1, note: "Arrived Friday" }], false);
  expect(second.status).toBe("received");
  expect(second.lines[0]).toMatchObject({ received: 3, note: "1 case short\nArrived Friday" });
});

it("closes a short order when nothing more is coming, and never counts over-delivery as still owed", () => {
  const closed = applyReceipt([orderLine(wine, 3)], [{ itemId: wine, quantity: 2, note: "Back-ordered" }], true);
  expect(closed.status).toBe("received");
  expect(outstanding(closed.lines[0])).toBe(1);
  expect(outstanding(orderLine(wine, 3, 4))).toBe(0);
  expect(applyReceipt([orderLine(wine, 0.5)], [{ itemId: wine, quantity: 0.25, note: "" }], false).lines[0].received)
    .toBe(0.25);
});

// FLOW-300: the Purchasing tab's Est. total, notes and which lists can be deleted.
it("sums quantity × unit cost per line, skipping lines without a cost", () => {
  const a = "00000000-0000-4000-8000-0000000000a1";
  const b = "00000000-0000-4000-8000-0000000000b1";
  const costs = new Map<string, number | null>([[a, 1250], [b, null]]);
  expect(estimatedTotalCents([{ itemId: a, quantity: 3 }, { itemId: b, quantity: 5 }], costs)).toBe(3750);
  expect(estimatedTotalCents([{ itemId: a, quantity: 0.5 }], new Map([[a, 333]]))).toBe(167);
  expect(estimatedTotalCents([{ itemId: b, quantity: 2 }], costs)).toBeNull();
  expect(estimatedTotalCents([], costs)).toBeNull();
});

it("lets only Draft, Rejected and Cancelled lists be deleted", () => {
  expect(orderListStatuses.filter(isDeletableList)).toEqual(["draft", "rejected", "cancelled"]);
});

it("trims a list's notes and caps them at 2000 characters", () => {
  expect(orderListNotesSchema.parse({ notes: "  Back door  " }).notes).toBe("Back door");
  expect(orderListNotesSchema.safeParse({ notes: "x".repeat(2001) }).success).toBe(false);
});
