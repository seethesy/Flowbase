import { describe, expect, it } from "vitest";
import { groupRentalRequests, rentalRequestText } from "../shared/rental-requests";

describe("vendor rental requests (FLOW-136)", () => {
  it("groups two rented items from one vendor into one request with two lines", () => {
    const groups = groupRentalRequests([
      { vendorId: "vendor-a", vendorName: "Atlas", itemId: "chair", name: "Chair", quantity: 20,
        from: "2026-12-11", through: "2026-12-13" },
      { vendorId: "vendor-a", vendorName: "Atlas", itemId: "glass", name: "Glass", quantity: 40,
        from: "2026-12-11", through: "2026-12-13" },
      { vendorId: "vendor-b", vendorName: "Benton", itemId: "table", name: "Table", quantity: 2,
        from: "2026-12-11", through: "2026-12-13" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].lines.map((line) => line.name)).toEqual(["Chair", "Glass"]);
  });

  it("formats event, fulfillment and dates without any price", () => {
    const text = rentalRequestText({ vendorId: "a0000000-0000-4000-8000-000000000001",
      vendorName: "Atlas", eventTitle: "Gala", eventDate: "2026-12-12", status: "draft",
      method: "delivery", details: "Back entrance, 9 am", lines: [{
        itemId: "b0000000-0000-4000-8000-000000000001", name: "Chair", quantity: 20,
        from: "2026-12-11", through: "2026-12-13",
      }] });
    expect(text).toContain("Gala — 2026-12-12");
    expect(text).toContain("Delivery: Back entrance, 9 am");
    expect(text).toContain("20 × Chair (2026-12-11–2026-12-13)");
    expect(text).not.toMatch(/price|cost|\$/i);
  });
});
