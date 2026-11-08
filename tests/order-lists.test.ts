import { expect, it } from "vitest";
import { applyReceipt, listStatusFromOrders, listVendors, outstanding, recordOrderInputSchema,
  suggestOrderLines } from "../shared/order-lists";

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
