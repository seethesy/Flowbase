import { describe, expect, it } from "vitest";
import {
  allocateConsumable,
  requiredQuantity,
  type Demand,
} from "../shared/allocation";
import {
  allocateHolds,
  availability,
  holdStatusForEvent,
  holdWindow,
  issueSignature,
  type Hold,
} from "../shared/reservations";

const hold = (over: Partial<Hold> & { id: string }): Hold => ({
  eventId: `event-${over.id}`,
  itemId: "plates",
  quantity: 10,
  status: "confirmed",
  window: { start: "2026-12-05", end: "2026-12-05" },
  bookedAt: "2026-10-01T12:00:00Z",
  enteredAt: "2026-10-01T12:00:00Z",
  ...over,
});

describe("FLOW-76 hold windows and status", () => {
  it("widens a multi-day event by the item's buffers (AC1)", () => {
    expect(
      holdWindow({ startDate: "2026-12-05", endDate: "2026-12-07" }, { before: 1, after: 2 }),
    ).toEqual({ start: "2026-12-04", end: "2026-12-09" });
  });

  it("holds tentatively until Closed, then confirms, and releases a lost event", () => {
    expect(holdStatusForEvent("proposal_creation")).toBe("tentative");
    expect(holdStatusForEvent("closing")).toBe("tentative");
    expect(holdStatusForEvent("closed")).toBe("confirmed");
    expect(holdStatusForEvent("preparation")).toBe("confirmed");
    expect(holdStatusForEvent("lost")).toBe("released");
  });

  it("computes availability with and without tentative holds (AC2)", () => {
    const holds = [
      hold({ id: "a", quantity: 30 }),
      hold({ id: "b", quantity: 20, status: "tentative" }),
      hold({ id: "c", quantity: 50, status: "released" }),
      hold({ id: "d", quantity: 40, window: { start: "2026-12-20", end: "2026-12-21" } }),
    ];
    expect(availability(100, { start: "2026-12-04", end: "2026-12-06" }, holds)).toEqual({
      owned: 100,
      available: 70,
      availableWithTentative: 50,
    });
  });

  it("does not add holds that never overlap each other", () => {
    const holds = [
      hold({ id: "a", quantity: 60, window: { start: "2026-12-01", end: "2026-12-02" } }),
      hold({ id: "b", quantity: 60, window: { start: "2026-12-04", end: "2026-12-05" } }),
    ];
    expect(availability(100, { start: "2026-12-01", end: "2026-12-05" }, holds).available).toBe(40);
  });
});

describe("FLOW-77 conflict detection", () => {
  it("gives the earlier-booked event the stock and shorts the later one (AC3)", () => {
    const result = allocateHolds(100, [
      hold({ id: "b", quantity: 60, bookedAt: "2026-10-05T00:00:00Z" }),
      hold({ id: "a", quantity: 80, bookedAt: "2026-10-01T00:00:00Z" }),
    ]);
    const byId = Object.fromEntries(result.map((row) => [row.holdId, row]));
    expect(byId.a).toMatchObject({ allocated: 80, shortfall: 0, kind: null });
    expect(byId.b).toMatchObject({ allocated: 20, shortfall: 40, kind: "conflict" });
  });

  it("breaks equal booking times by entry order", () => {
    const result = allocateHolds(10, [
      hold({ id: "late", quantity: 10, enteredAt: "2026-10-02T00:00:00Z" }),
      hold({ id: "early", quantity: 10, enteredAt: "2026-10-01T00:00:00Z" }),
    ]);
    expect(result.find((row) => row.holdId === "early")?.shortfall).toBe(0);
    expect(result.find((row) => row.holdId === "late")?.shortfall).toBe(10);
  });

  it("ranks an unbooked hold after every booked one", () => {
    const result = allocateHolds(10, [
      hold({ id: "open", quantity: 10, bookedAt: null, status: "confirmed" }),
      hold({ id: "signed", quantity: 10, bookedAt: "2026-10-09T00:00:00Z" }),
    ]);
    expect(result.find((row) => row.holdId === "signed")?.shortfall).toBe(0);
    expect(result.find((row) => row.holdId === "open")?.kind).toBe("conflict");
  });

  it("is a warning when only tentative holds overcommit, a conflict once confirmed ones do", () => {
    const warning = allocateHolds(100, [
      hold({ id: "a", quantity: 80, status: "tentative" }),
      hold({ id: "b", quantity: 60, status: "tentative", bookedAt: "2026-10-05T00:00:00Z" }),
    ]);
    expect(warning.find((row) => row.holdId === "b")?.kind).toBe("warning");
    const conflict = allocateHolds(100, [
      hold({ id: "a", quantity: 80, status: "confirmed" }),
      hold({ id: "b", quantity: 60, status: "tentative", bookedAt: "2026-10-05T00:00:00Z" }),
    ]);
    expect(conflict.find((row) => row.holdId === "b")?.kind).toBe("conflict");
  });

  it("ignores released holds and changes its signature only when the situation changes", () => {
    const result = allocateHolds(10, [hold({ id: "x", quantity: 10, status: "released" })]);
    expect(result).toEqual([]);
    const a = issueSignature({ kind: "conflict", quantity: 60, allocated: 20, shortfall: 40 });
    expect(a).toBe(issueSignature({ kind: "conflict", quantity: 60, allocated: 20, shortfall: 40 }));
    expect(a).not.toBe(issueSignature({ kind: "conflict", quantity: 60, allocated: 30, shortfall: 30 }));
  });
});

const demand = (over: Partial<Demand> & { eventId: string }): Demand => ({
  required: 10,
  bookedAt: "2026-10-01T00:00:00Z",
  enteredAt: "2026-10-01T00:00:00Z",
  eventDate: "2026-12-05",
  leadTimeDays: 3,
  ...over,
});

describe("FLOW-85 consumable allocation", () => {
  it("scales per-guest requirements with the guest count (AC3)", () => {
    expect(requiredQuantity({ basis: "per_guest", quantity: 2 }, 150)).toBe(300);
    expect(requiredQuantity({ basis: "per_guest", quantity: 2 }, 175)).toBe(350);
    expect(requiredQuantity({ basis: "per_guest", quantity: 2 }, null)).toBe(0);
    expect(requiredQuantity({ basis: "fixed", quantity: 12 }, 175)).toBe(12);
  });

  it("allocates in booking order and reports shortage and order-by date (AC1, AC2)", () => {
    const rows = allocateConsumable(100, [], [
      demand({ eventId: "later", required: 60, bookedAt: "2026-10-05T00:00:00Z", eventDate: "2026-12-10" }),
      demand({ eventId: "first", required: 80 }),
    ]);
    expect(rows.map((row) => row.eventId)).toEqual(["first", "later"]);
    expect(rows[0]).toMatchObject({ allocated: 80, shortage: 0, projectedStock: 100, orderBy: null });
    expect(rows[1]).toMatchObject({
      allocated: 20,
      shortage: 40,
      projectedStock: 20,
      orderBy: "2026-12-07",
    });
  });

  it("counts an order only when it arrives by the event date (AC4)", () => {
    const rows = allocateConsumable(
      0,
      [
        { quantity: 50, expectedDelivery: "2026-12-04" },
        { quantity: 70, expectedDelivery: "2026-12-06" },
        { quantity: 99, expectedDelivery: null },
      ],
      [demand({ eventId: "e", required: 100 })],
    );
    expect(rows[0]).toMatchObject({ allocated: 50, shortage: 50, projectedStock: 50 });
  });
});
