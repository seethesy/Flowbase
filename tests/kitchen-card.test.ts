// @vitest-environment node
import { describe, expect, it } from "vitest";
import { scaleQuantity } from "../shared/recipes";

// FLOW-267 AC3: the kitchen card's scaling.
describe("scaling a recipe to N servings", () => {
  it("multiplies each quantity by N over the yield", () => {
    expect(scaleQuantity(6, 12, 12)).toBe(6);
    expect(scaleQuantity(6, 12, 24)).toBe(12);
    expect(scaleQuantity(1.5, 12, 30)).toBe(3.75);
    expect(scaleQuantity(0.25, 12, 6)).toBe(0.125);
  });
  it("rounds to three decimals", () => {
    expect(scaleQuantity(1, 3, 1)).toBe(0.333);
    expect(scaleQuantity(2, 3, 1)).toBe(0.667);
  });
  it("leaves a line without a quantity, a recipe without a yield and a bad N alone", () => {
    expect(scaleQuantity(null, 12, 24)).toBeNull();
    expect(scaleQuantity(6, null, 24)).toBe(6);
    expect(scaleQuantity(6, 0, 24)).toBe(6);
    expect(scaleQuantity(6, 12, 0)).toBe(6);
    expect(scaleQuantity(6, 12, Number.NaN)).toBe(6);
  });
});
