import { describe, expect, it } from "vitest";
import {
  itemInputSchema,
  itemSchema,
  type InventoryItem,
} from "../shared/inventory";
import {
  effectiveRatio,
  itemRequirements,
} from "../shared/inventory-requirements";
import { serializeFields } from "../shared/visibility";
import type { Actor } from "../shared/access";

const ids = Array.from(
  { length: 8 },
  (_, i) => `e0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
);
const item = (id: string, input: unknown): InventoryItem =>
  itemSchema.parse({
    ...itemInputSchema.parse(input),
    id,
    rental: null,
    service: null,
    consumable: null,
    bar: null,
    stock: [],
    totalQuantity: 0,
    belowPar: null,
    archivedAt: null,
    createdAt: "2026-10-27T00:00:00Z",
    updatedAt: "2026-10-27T00:00:00Z",
    ...Object.fromEntries(
      Object.entries(itemInputSchema.parse(input)).filter(([key]) =>
        ["rental", "service"].includes(key),
      ),
    ),
  });

describe("rental catalog (FLOW-72)", () => {
  it("inherits changing category defaults without copying them into the item, and preserves overrides", () => {
    const defaults = {
      ratioDefaults: [
        { category: "Glassware", quantity: 2, basis: "per_guest" as const },
      ],
    };
    const row = { category: " glassware ", ratio: null };
    expect(effectiveRatio(row, defaults)?.quantity).toBe(2);
    defaults.ratioDefaults[0].quantity = 3;
    expect(effectiveRatio(row, defaults)?.quantity).toBe(3);
    expect(
      effectiveRatio(
        { ...row, ratio: { quantity: 1, basis: "per_table" } },
        defaults,
      ),
    ).toEqual({ quantity: 1, basis: "per_table" });
    expect(
      effectiveRatio({ category: "Other", ratio: null }, defaults),
    ).toBeNull();
  });

  it.each(["staff", "kitchen_staff"] as const)(
    "hides both rental costs from %s, even full-time, and on BEOs",
    (role) => {
      const actor: Actor = {
        userId: ids[0],
        role,
        employmentType: "full_time",
      };
      const row = {
        rental: {
          priceCents: 100,
          internalCostCents: 50,
          replacementCostCents: 300,
        },
      };
      expect(serializeFields(actor, "inventory_item", row)).toEqual({
        rental: {
          priceCents: 100,
          internalCostCents: null,
          replacementCostCents: null,
        },
      });
      expect(
        serializeFields({ ...actor, role: "admin" }, "inventory_item", row, {
          view: "beo",
        }),
      ).toEqual({
        rental: {
          priceCents: null,
          internalCostCents: null,
          replacementCostCents: null,
        },
      });
      expect(
        serializeFields({ ...actor, role: "admin" }, "inventory_item", row),
      ).toEqual(row);
    },
  );

  it("defaults buffers and rejects negative buffers, duplicate colors and duplicate components", () => {
    const base = {
      kind: "rental",
      subtype: "decor",
      name: "Centerpiece",
      rental: {},
    };
    expect(itemInputSchema.parse(base).rental).toMatchObject({
      bufferDaysBefore: 1,
      bufferDaysAfter: 1,
    });
    for (const rental of [
      { bufferDaysBefore: -1 },
      { colors: ["Gold", "gold"] },
      {
        components: [
          { itemId: ids[1], quantity: 1 },
          { itemId: ids[1], quantity: 2 },
        ],
      },
    ])
      expect(itemInputSchema.safeParse({ ...base, rental }).success).toBe(
        false,
      );
  });
});

describe("kits, services and supply requirements (FLOW-79/80/92)", () => {
  const glass = item(ids[0], {
    kind: "rental",
    subtype: "glassware",
    name: "Hurricane glass",
  });
  const candle = item(ids[1], {
    kind: "consumable",
    subtype: "supply",
    name: "Candle",
    consumable: { purchaseUnit: "each" },
  });
  const kit = item(ids[2], {
    kind: "rental",
    subtype: "decor",
    name: "Centerpiece Candle Set",
    rental: {
      components: [
        { itemId: glass.id, quantity: 1 },
        { itemId: candle.id, quantity: 1 },
      ],
    },
  });
  it("expands ten kits into ten of each component without changing stock", () => {
    const items = [glass, candle, kit];
    const before = JSON.stringify(items);
    expect(itemRequirements(kit.id, 10, items, 120)).toEqual([
      { itemId: glass.id, quantity: 10 },
      { itemId: candle.id, quantity: 10 },
    ]);
    expect(JSON.stringify(items)).toBe(before);
  });
  it("expands Full Plasticware Package to 120 of each supply, combining fixed and per-guest includes", () => {
    const supplies = [
      "Paper plates",
      "Napkins",
      "Silverware",
      "Plastic cups",
    ].map((name, index) =>
      item(ids[index], {
        kind: "consumable",
        subtype: "supply",
        name,
        consumable: { purchaseUnit: "each" },
      }),
    );
    const service = item(ids[4], {
      kind: "service",
      name: "Full Plasticware Package",
      service: {
        priceCents: 350,
        priceBasis: "per_guest",
        includes: supplies.map((s) => ({
          itemId: s.id,
          quantity: 1,
          basis: "per_guest",
        })),
      },
    });
    expect(
      itemRequirements(service.id, 1, [...supplies, service], 120),
    ).toEqual(supplies.map((s) => ({ itemId: s.id, quantity: 120 })));
    const fixed = {
      ...service,
      service: {
        ...service.service!,
        includes: [
          { itemId: kit.id, quantity: 2, basis: "per_event" as const },
        ],
      },
    };
    expect(
      itemRequirements(fixed.id, 1, [glass, candle, kit, fixed], 120),
    ).toEqual([
      { itemId: glass.id, quantity: 2 },
      { itemId: candle.id, quantity: 2 },
    ]);
  });
  it("rejects missing and inactive components and indirect kit cycles", () => {
    expect(() => itemRequirements(kit.id, 1, [kit], 120)).toThrow(
      "unavailable",
    );
    expect(() =>
      itemRequirements(
        kit.id,
        1,
        [kit, { ...glass, active: false }, candle],
        120,
      ),
    ).toThrow("unavailable");
    const cyclic = {
      ...kit,
      rental: { ...kit.rental!, components: [{ itemId: kit.id, quantity: 1 }] },
    };
    expect(() => itemRequirements(kit.id, 1, [cyclic], 120)).toThrow("cycle");
    expect(() => itemRequirements(kit.id, -1, [kit], 120)).toThrow(
      "valid quantity",
    );
  });
  it.each([
    { priceCents: 10000, priceBasis: "per_event" },
    { priceCents: 350, priceBasis: "per_guest" },
    { pricedByQuote: true },
  ])("accepts each service pricing type: %j", (service) => {
    expect(
      itemInputSchema.safeParse({ kind: "service", name: "Service", service })
        .success,
    ).toBe(true);
  });
  it("rejects contradictory quote pricing and negative add-ons", () => {
    for (const service of [
      { pricedByQuote: true, priceCents: 10 },
      { addons: [{ name: "Upgrade", priceCents: -1 }] },
    ])
      expect(
        itemInputSchema.safeParse({ kind: "service", name: "Service", service })
          .success,
      ).toBe(false);
  });
});
