import { describe, expect, it } from "vitest";
import { itemRequirements, type RequirementItem } from "../shared/inventory-requirements";
import { describeRegeneration, planRegeneration, type RegenRow } from "../shared/planning";
import { pullGroupOf, pullScheduleInputSchema, samePullValue, type PullLineValue } from "../shared/pull-list";

// The regeneration planner and the pull list's pure rules (FLOW-133/134).
type V = { qty: number | null };
const same = (a: V, b: V) => a.qty === b.qty;
const row = (sourceKey: string, qty: number | null, extra: Partial<RegenRow<V>> = {}): RegenRow<V> => ({
  id: `id-${sourceKey}`,
  sourceKey,
  edited: false,
  removed: false,
  value: { qty },
  ...extra,
});
const gen = (sourceKey: string, qty: number | null) => ({ sourceKey, value: { qty } });

describe("planRegeneration", () => {
  it("adds new lines, updates changed ones and removes ones the proposal dropped", () => {
    const plan = planRegeneration([row("a", 1), row("b", 2)], [gen("a", 5), gen("c", 3)], same, false);
    expect(plan.add.map((l) => l.sourceKey)).toEqual(["c"]);
    expect(plan.update.map((l) => [l.sourceKey, l.value.qty])).toEqual([["a", 5]]);
    expect(plan.remove.map((l) => l.sourceKey)).toEqual(["b"]);
    expect(plan.kept).toEqual([]);
  });

  it("changes nothing when the lines already match", () => {
    const plan = planRegeneration([row("a", 1)], [gen("a", 1)], same, false);
    expect(plan).toEqual({ add: [], update: [], remove: [], kept: [] });
  });

  it("keeps edited and removed lines, and says why", () => {
    const plan = planRegeneration(
      [row("a", 9, { edited: true }), row("b", 2, { removed: true }), row("c", 4, { edited: true })],
      [gen("a", 1), gen("b", 2)],
      same,
      false,
    );
    expect(plan.kept.map((l) => [l.sourceKey, l.reason])).toEqual([["a", "edited"], ["b", "removed"], ["c", "edited"]]);
    expect(plan.update).toEqual([]);
    expect(plan.remove).toEqual([]);
  });

  it("doesn't report an edited line that already matches the proposal", () => {
    const plan = planRegeneration([row("a", 1, { edited: true })], [gen("a", 1)], same, false);
    expect(plan.kept).toEqual([]);
  });

  it("discards edits and removals when asked", () => {
    const plan = planRegeneration(
      [row("a", 9, { edited: true }), row("b", 2, { removed: true }), row("c", 4, { edited: true })],
      [gen("a", 1), gen("b", 2)],
      same,
      true,
    );
    expect(plan.update.map((l) => [l.sourceKey, l.restore])).toEqual([["a", false], ["b", true]]);
    expect(plan.remove.map((l) => l.sourceKey)).toEqual(["c"]);
    expect(plan.kept).toEqual([]);
  });

  it("leaves removed lines the proposal no longer has alone", () => {
    const plan = planRegeneration([row("z", 1, { removed: true })], [], same, false);
    expect(plan).toEqual({ add: [], update: [], remove: [], kept: [] });
  });
});

describe("describeRegeneration", () => {
  it("words each change and reports an unchanged plan as up to date", () => {
    const label = (v: V) => "Item";
    const summary = (v: V) => `${v.qty ?? "TBD"}`;
    expect(describeRegeneration(planRegeneration([row("a", 1)], [gen("a", 1)], same, false), label, summary).upToDate).toBe(true);
    const preview = describeRegeneration(planRegeneration([row("a", 1)], [gen("a", null)], same, false), label, summary);
    expect(preview.changes).toEqual([{ kind: "changed", label: "Item", current: "1", generated: "TBD", reason: null }]);
  });
});

describe("pull list rules", () => {
  it("groups consumables as supplies, decor as decor and other rentals as kitchen equipment", () => {
    expect(pullGroupOf({ kind: "consumable", subtype: "supply" })).toBe("supplies");
    expect(pullGroupOf({ kind: "rental", subtype: "decor" })).toBe("decor");
    expect(pullGroupOf({ kind: "rental", subtype: "glassware" })).toBe("kitchen_equipment");
    expect(pullGroupOf({ kind: "rental", subtype: null })).toBe("kitchen_equipment");
  });

  it("compares generated values", () => {
    const value: PullLineValue = { group: "decor", itemId: null, name: "Vase", sectionId: null, quantity: null, notes: "", setupDay: false };
    expect(samePullValue(value, { ...value })).toBe(true);
    expect(samePullValue(value, { ...value, quantity: 2 })).toBe(false);
  });

  it("needs a date and a time together", () => {
    const base = { pullerId: null };
    expect(pullScheduleInputSchema.safeParse({ ...base, date: "2026-12-10", time: "09:00" }).success).toBe(true);
    expect(pullScheduleInputSchema.safeParse({ ...base, date: null, time: null }).success).toBe(true);
    expect(pullScheduleInputSchema.safeParse({ ...base, date: "2026-12-10", time: null }).success).toBe(false);
  });

  it("expands kits and per-guest services from rows loaded for planning", () => {
    const items: RequirementItem[] = [
      { id: "glass", name: "Glass", active: true, archivedAt: null, service: null, rental: null },
      { id: "kit", name: "Kit", active: true, archivedAt: null, service: null, rental: { components: [{ itemId: "glass", quantity: 3 }] } },
      { id: "bar", name: "Bar service", active: true, archivedAt: null, service: { includes: [{ itemId: "glass", quantity: 1, basis: "per_guest" }] }, rental: null },
    ];
    expect(itemRequirements("kit", 2, items, 50)).toEqual([{ itemId: "glass", quantity: 6 }]);
    expect(itemRequirements("bar", 1, items, 50)).toEqual([{ itemId: "glass", quantity: 50 }]);
  });
});
