import { describe, expect, it } from "vitest";
import { alertReason, missingRunWindow } from "../worker/records/collector-health";

const config = { failureThreshold: 3, noLeadsGapHours: 48 };
const run = (status: string, at: string, leadsFound = 0) =>
  ({ status, finishedAt: new Date(at), leadsFound });

describe("collector health rules", () => {
  it("alerts for login trouble and repeated errors, then clears after recovery", () => {
    const now = new Date("2026-11-03T15:00:00Z");
    expect(alertReason([run("needs_login", "2026-11-03T14:00:00Z")], now, config)).toBe("needs_login");
    expect(alertReason([run("error", "2026-11-03T14:00:00Z"),
      run("error", "2026-11-03T12:00:00Z"), run("error", "2026-11-03T10:00:00Z")], now, config))
      .toBe("repeated_errors");
    expect(alertReason([run("ok", "2026-11-03T14:00:00Z", 1)], now, config)).toBe("ok");
  });
  it("reports a missing run at 2pm ET after three hours", () => {
    expect(missingRunWindow(new Date("2026-11-03T19:00:00Z"),
      new Date("2026-11-03T15:00:00Z"))).toBe(true);
    expect(alertReason([run("ok", "2026-11-03T15:00:00Z", 1)],
      new Date("2026-11-03T19:00:00Z"), config)).toBe("not_running");
  });
  it("does not report missing runs outside 8am–8pm ET", () => {
    expect(missingRunWindow(new Date("2026-11-03T03:00:00Z"), null)).toBe(false);
    expect(missingRunWindow(new Date("2026-11-03T13:00:00Z"), null)).toBe(false);
  });
});
