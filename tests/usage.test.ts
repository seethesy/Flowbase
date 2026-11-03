import { expect, it } from "vitest";
import { crossedThresholds, usagePeriod } from "../worker/records/usage";

it("uses daily, monthly and storage periods", () => {
  const now = new Date("2026-11-03T23:59:00Z");
  expect(usagePeriod("worker_requests", now)).toBe("2026-11-03");
  expect(usagePeriod("github_minutes", now)).toBe("2026-11");
  expect(usagePeriod("r2_bytes", now)).toBe("current");
});
it("reports the 70% and 90% thresholds, with no warning for a disabled cap", () => {
  expect(crossedThresholds(69, 100)).toEqual([]);
  expect(crossedThresholds(70, 100)).toEqual([70]);
  expect(crossedThresholds(90, 100)).toEqual([70, 90]);
  expect(crossedThresholds(100, 0)).toEqual([]);
});
