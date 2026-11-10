import { describe, expect, it } from "vitest";
import { matchesProductionTemplate, templateDueAt } from "../shared/tasks";

describe("production schedule matching", () => {
  const offering = "a0000000-0000-4000-8000-000000000001";
  it("applies the Large Balloon Arch template to its mapped offering and calculates the due date", () => {
    const template = { matchCatalogId: offering, matchLineKind: "service" as const, matchEventType: null };
    expect(matchesProductionTemplate(template, "Wedding", [{ catalogId: offering, kind: "service" }])).toBe(true);
    expect(matchesProductionTemplate(template, "Wedding", [{ catalogId: null, kind: "service" }])).toBe(false);
    expect(templateDueAt(new Date("2026-11-20T20:00:00.000Z"), { offsetDays: -2, time: "09:00" }).toISOString())
      .toBe("2026-11-18T14:00:00.000Z");
  });
  it("keeps templates without a match available for manual use", () => {
    expect(matchesProductionTemplate({ matchCatalogId: null, matchLineKind: null, matchEventType: null }, "Wedding", [])).toBe(false);
  });
});
