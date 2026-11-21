import { describe, expect, it } from "vitest";
import type { Actor } from "../shared/access";
import { canReadField, fieldRegistry, readableFields } from "../shared/fields";
import { emptyLayout, layoutDocSchema, layoutProblems, recordPages, type LayoutDoc } from "../shared/layout";

// FLOW-274: record pages and restricted roles.

const as = (role: Actor["role"]): Actor => ({ userId: "74000000-0000-4000-8000-000000000001", role });
const box = (id: string, field: string, y: number) => ({ id, kind: "field", field, x: 0, y, w: 6, h: 2 });
const withBoxes = (cardKey: string, boxes: unknown[]): LayoutDoc =>
  layoutDocSchema.parse({ ...emptyLayout(), fieldBoxes: { [cardKey]: { boxes } } });

describe("record pages (FLOW-274)", () => {
  it("has a field card for every record page, proposals included", () => {
    expect(recordPages["proposals.detail"]).toEqual({ source: "proposals", fieldCards: ["proposal-facts"] });
    for (const [pageKey, page] of Object.entries(recordPages)) {
      expect(page.fieldCards.length, pageKey).toBeGreaterThan(0);
      expect(fieldRegistry[page.source], pageKey).toBeDefined();
    }
  });

  it("accepts proposal boxes with the required field and rejects other cards and unknown fields", () => {
    const ok = withBoxes("proposal-facts", [box("b1", "title", 0), box("b2", "stage", 2)]);
    expect(layoutProblems("proposals.detail", ok)).toEqual([]);
    const missingTitle = withBoxes("proposal-facts", [box("b2", "stage", 0)]);
    expect(layoutProblems("proposals.detail", missingTitle).map((p) => p.message)).toContain("Proposal can't be hidden.");
    const unknownField = withBoxes("proposal-facts", [box("b1", "title", 0), box("b2", "nope", 2)]);
    expect(layoutProblems("proposals.detail", unknownField).some((p) => p.message.includes("Unknown field"))).toBe(true);
    expect(layoutProblems("proposals.detail", withBoxes("client-facts", [box("b1", "name", 0)])).length).toBeGreaterThan(0);
  });
});

describe("a restricted role and unreadable fields (FLOW-274 AC3, AC4)", () => {
  it("never offers or reads staff Notes for part-time staff, but does for full-time roles", () => {
    expect(canReadField(as("part_time_staff"), "staff", "notes")).toBe(false);
    expect(readableFields(as("part_time_staff"), "staff").some((field) => field.key === "notes")).toBe(false);
    for (const role of ["admin", "staff", "salesperson"] as const) expect(canReadField(as(role), "staff", "notes")).toBe(true);
  });

  it("lets an Admin save a box for a field only some roles can read", () => {
    const doc = withBoxes("staff-facts", [box("b1", "name", 0), box("b2", "notes", 2)]);
    expect(layoutProblems("staff.detail", doc)).toEqual([]);
  });
});
