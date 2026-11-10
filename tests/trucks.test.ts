import { describe, expect, it } from "vitest";
import { busyWindowsOverlap, truckConflictMessage } from "../shared/trucks";

describe("truck busy windows", () => {
  const window = (start: string, end: string) => ({ departsAt: new Date(start), returnsAt: new Date(end) });
  it("warns on overlapping warehouse-to-warehouse windows with the exact message", () => {
    expect(busyWindowsOverlap(window("2026-11-20T15:00:00Z", "2026-11-20T17:00:00Z"),
      window("2026-11-20T13:00:00Z", "2026-11-20T17:00:00Z"))).toBe(true);
    expect(truckConflictMessage("Truck A", "Event A", "3:00pm", "Event B"))
      .toBe("You are attempting to assign Truck A to Event A at 3:00pm. Possible conflict: Truck A is already assigned to Event B");
  });
  it("allows a truck when the earlier trip is back at the warehouse", () => {
    expect(busyWindowsOverlap(window("2026-11-20T17:00:00Z", "2026-11-20T20:00:00Z"),
      window("2026-11-20T13:00:00Z", "2026-11-20T17:00:00Z"))).toBe(false);
  });
});
