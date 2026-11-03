import { expect, it } from "vitest";
import { changedOnEventDay } from "../worker/notifications/event-day";

it("flags real changes on the New York event day only", () => {
  const start = new Date("2026-11-03T23:00:00Z");
  const before = { title: "Dinner", updatedAt: "old" };
  expect(changedOnEventDay(start, new Date("2026-11-03T15:00:00Z"), before,
    { title: "Dinner", updatedAt: "new" })).toBe(false);
  expect(changedOnEventDay(start, new Date("2026-11-03T15:00:00Z"), before,
    { title: "Reception", updatedAt: "new" })).toBe(true);
  expect(changedOnEventDay(start, new Date("2026-11-04T06:00:00Z"), before,
    { title: "Reception", updatedAt: "new" })).toBe(false);
});
