import { expect, it } from "vitest";
import { allocatePool, barPlanInputSchema, reorderItem, type PoolDemand, type PoolItem } from "../shared/allocation";
import { suggestOrderLines } from "../shared/order-lists";

// Bar plan (FLOW-170): tiers are allocated as a pool (A1); a tier's shortage is
// ordered as its house pick (A2).
const titos: PoolItem = { itemId: "titos", name: "Tito's", onHand: 6, onOrder: [], leadTimeDays: 3, housePick: false };
const smirnoff: PoolItem = { itemId: "smirnoff", name: "Smirnoff", onHand: 10, onOrder: [], leadTimeDays: 2, housePick: true };
const demand = (eventId: string, bookedAt: string, extra: Partial<PoolDemand>): PoolDemand => ({
  eventId, bookedAt, enteredAt: bookedAt, eventDate: "2026-11-20", items: {}, tiers: [], ...extra,
});
const rail = (lineId: string, required: number) => ({ lineId, required, candidates: ["titos", "smirnoff"] });

it("allocates a tier line against every item of the tier, most stock first (AC2)", () => {
  const result = allocatePool([titos, smirnoff], [demand("gala", "2026-10-01T00:00:00Z", { tiers: [rail("t1", 12)] })]);
  expect(result.tiers).toEqual([{ eventId: "gala", lineId: "t1", required: 12, allocated: 12, shortage: 0,
    reorderItemId: "smirnoff", orderBy: null }]);
  expect(result.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ itemId: "smirnoff", allocated: 10, required: 10, shortage: 0, projectedStock: 10 }),
    expect.objectContaining({ itemId: "titos", allocated: 2, required: 2, shortage: 0, projectedStock: 6 }),
  ]));
});

it("gives the earlier-booked event the pool and orders the later one's shortage as the house pick", () => {
  const result = allocatePool([titos, smirnoff], [
    demand("later", "2026-10-05T00:00:00Z", { tiers: [rail("t2", 10)] }),
    demand("first", "2026-10-01T00:00:00Z", { tiers: [rail("t1", 12)] }),
  ]);
  const later = result.tiers.find((row) => row.eventId === "later")!;
  expect(later).toMatchObject({ allocated: 4, shortage: 6, reorderItemId: "smirnoff", orderBy: "2026-11-18" });
  expect(result.items.find((row) => row.eventId === "later" && row.itemId === "smirnoff"))
    .toMatchObject({ allocated: 0, shortage: 6, required: 6, orderBy: "2026-11-18" });
});

it("takes an event's item lines before its tier lines, and the narrowest tier first", () => {
  const result = allocatePool([titos, smirnoff], [demand("gala", "2026-10-01T00:00:00Z", {
    items: { titos: 6 },
    tiers: [rail("any", 4), { lineId: "vodka", required: 10, candidates: ["smirnoff"] }],
  })]);
  expect(result.tiers.find((row) => row.lineId === "vodka")).toMatchObject({ allocated: 10, shortage: 0 });
  // Tito's went to the item line, Smirnoff to the vodka line: nothing left for "any".
  expect(result.tiers.find((row) => row.lineId === "any")).toMatchObject({ allocated: 0, shortage: 4 });
});

it("counts on-order stock from its expected delivery date", () => {
  const ordered = { ...smirnoff, onHand: 0, onOrder: [{ quantity: 12, expectedDelivery: "2026-11-18" }] };
  const result = allocatePool([ordered], [demand("gala", "2026-10-01T00:00:00Z",
    { tiers: [{ lineId: "t1", required: 12, candidates: ["smirnoff"] }] })]);
  expect(result.tiers[0]).toMatchObject({ allocated: 12, shortage: 0 });
});

it("reorders the house pick, else the first item by name, and reports no item for an empty tier", () => {
  expect(reorderItem([titos, smirnoff])?.itemId).toBe("smirnoff");
  expect(reorderItem([titos, { ...smirnoff, housePick: false }])?.itemId).toBe("smirnoff");
  expect(reorderItem([titos])?.itemId).toBe("titos");
  const empty = allocatePool([], [demand("gala", "2026-10-01T00:00:00Z", { tiers: [{ lineId: "t1", required: 5, candidates: [] }] })]);
  expect(empty.tiers[0]).toMatchObject({ allocated: 0, shortage: 5, reorderItemId: null });
  expect(empty.items).toEqual([]);
});

it("turns a bar shortage into an order line rounded up to the case", () => {
  const [line] = suggestOrderLines([{ itemId: "00000000-0000-4000-8000-000000000001", itemName: "Smirnoff",
    unit: "each", purchaseUnit: "case", packCount: 12, eachSize: null, vendorId: null, vendorName: "Imperio",
    orderingInstructions: "", onHand: 0, parLevel: null,
    shortages: [{ eventId: "00000000-0000-4000-8000-000000000002", eventTitle: "Gala", quantity: 6, orderBy: "2026-11-18" }] }]);
  expect(line).toMatchObject({ quantity: 1, purchaseUnit: "case", shortage: 6 });
});

it("rejects the same tier twice in one plan", () => {
  const tier = { category: "Liquor", subcategory: "Vodka", tier: "rail" as const, quantity: 12 };
  expect(barPlanInputSchema.safeParse({ tiers: [tier] }).success).toBe(true);
  expect(barPlanInputSchema.safeParse({ tiers: [tier, tier] }).success).toBe(false);
});
