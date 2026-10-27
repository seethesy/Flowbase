import { describe, expect, it } from "vitest";
import {
  passwordFieldPath,
  vendorFieldsSchema,
  vendorInputSchema,
} from "../shared/vendors";
import { itemInputSchema, type InventoryItem } from "../shared/inventory";
import {
  daysBetween,
  isSubRental,
  leadTimeWarning,
  ownedAvailability,
  ownedQuantity,
} from "../shared/sub-rentals";

const vendorId = "e1000000-0000-4000-8000-000000000001";

describe("vendor schema (FLOW-84)", () => {
  it("AC1: has no password field and refuses one anywhere in the body", () => {
    expect(
      Object.keys(vendorFieldsSchema.shape).filter((key) =>
        /pass|pwd|secret/i.test(key),
      ),
    ).toEqual([]);
    const base = { name: "Imperio", type: "beverage_distributor" };
    expect(vendorInputSchema.safeParse(base).success).toBe(true);
    for (const [body, path] of [
      [{ ...base, password: "x" }, "password"],
      [{ ...base, portalPassword: "x" }, "portalPassword"],
      [{ ...base, portal_pwd: "x" }, "portal_pwd"],
      [{ ...base, contacts: [{ name: "Dana", passcode: "1234" }] }, "contacts.0.passcode"],
    ] as const) {
      expect(passwordFieldPath(body)).toBe(path);
      const parsed = vendorInputSchema.safeParse(body);
      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues[0].message).toContain(
        "Flowbase never stores portal passwords",
      );
    }
  });

  it("defaults the ordering fields and validates them", () => {
    expect(
      vendorFieldsSchema.parse({ name: " Sysco ", type: "food_distributor" }),
    ).toEqual({
      name: "Sysco",
      type: "food_distributor",
      portalUrl: "",
      orderCutoff: "",
      deliveryDays: [],
      minimumOrderCents: null,
      leadTimeDays: null,
      orderingInstructions: "",
      notes: "",
    });
    for (const bad of [
      { portalUrl: "portal.sysco.com" },
      { deliveryDays: ["mon", "mon"] },
      { leadTimeDays: -1 },
      { type: "caterer" },
      { contacts: [{ name: "Rep", email: "not-an-email" }] },
    ])
      expect(
        vendorFieldsSchema.safeParse({
          name: "Sysco",
          type: "food_distributor",
          ...bad,
        }).success,
      ).toBe(false);
  });
});

const rental = (
  overrides: Partial<NonNullable<InventoryItem["rental"]>> = {},
  stock: InventoryItem["stock"] = [],
): Pick<InventoryItem, "id" | "kind" | "rental" | "stock"> => ({
  id: "e1000000-0000-4000-8000-000000000010",
  kind: "rental",
  rental: {
    ...itemInputSchema.parse({
      kind: "rental",
      subtype: "equipment",
      name: "Tent",
      rental: {},
    }).rental!,
    vendorName: null,
    ...overrides,
  },
  stock,
});
const level = (sectionName: string, quantity: number) => ({
  sectionId: "e1000000-0000-4000-8000-000000000020",
  sectionName,
  quantity,
});

describe("vendor (sub-rental) items (FLOW-75)", () => {
  it("needs a vendor for a lead time or vendor cost", () => {
    const base = { kind: "rental", subtype: "equipment", name: "Tent" };
    expect(
      itemInputSchema.safeParse({ ...base, rental: { leadTimeDays: 7 } })
        .error?.issues[0].message,
    ).toBe("Pick the vendor this item is rented from.");
    expect(
      itemInputSchema.safeParse({ ...base, rental: { vendorCostCents: 100 } })
        .success,
    ).toBe(false);
    expect(
      itemInputSchema.parse({
        ...base,
        rental: { vendorId, vendorCostCents: 100, leadTimeDays: 7 },
      }).rental,
    ).toMatchObject({ vendorId, vendorCostCents: 100, leadTimeDays: 7 });
  });

  it("AC1: reserving a vendor item never reduces owned availability", () => {
    const tent = rental({ vendorId, leadTimeDays: 7 }, [level("Vendor", 4)]);
    const chairs = {
      ...rental({}, [level("Warehouse", 40), level("Vendor", 10)]),
      id: "e1000000-0000-4000-8000-000000000011",
    };
    expect(isSubRental(tent)).toBe(true);
    expect(isSubRental(chairs)).toBe(false);
    // Stock in the Vendor section isn't owned.
    expect(ownedQuantity(chairs)).toBe(40);
    const reservations = [
      { itemId: tent.id, quantity: 500 },
      { itemId: chairs.id, quantity: 15 },
    ];
    expect(ownedAvailability(tent, reservations)).toBe("on_request");
    expect(ownedAvailability(chairs, reservations)).toBe(25);
    expect(
      ownedAvailability(chairs, [{ itemId: tent.id, quantity: 500 }]),
    ).toBe(40);
  });

  it("AC2: an event 3 days out with a 7-day lead-time item shows a warning", () => {
    const tent = rental({
      vendorId,
      vendorName: "Capital Party Rentals",
      leadTimeDays: 7,
    });
    expect(leadTimeWarning(tent, "2026-11-03", "2026-10-31")).toEqual({
      leadTimeDays: 7,
      daysUntilEvent: 3,
      message:
        "Capital Party Rentals needs 7 days' notice; the event is 3 days away.",
    });
    expect(leadTimeWarning(tent, "2026-11-07", "2026-10-31")).toBeNull();
    expect(leadTimeWarning(tent, "2026-11-08", "2026-10-31")).toBeNull();
    expect(leadTimeWarning(tent, "2026-10-31", "2026-10-31")?.message).toBe(
      "Capital Party Rentals needs 7 days' notice; the event is today.",
    );
    // A past event, an owned item and a vendor item without a lead time don't warn.
    expect(leadTimeWarning(tent, "2026-10-30", "2026-10-31")).toBeNull();
    expect(
      leadTimeWarning(rental({ leadTimeDays: 7 }), "2026-11-01", "2026-10-31"),
    ).toBeNull();
    expect(
      leadTimeWarning(rental({ vendorId }), "2026-11-01", "2026-10-31"),
    ).toBeNull();
  });

  it("counts calendar days across a DST change", () => {
    expect(daysBetween("2026-10-31", "2026-11-03")).toBe(3);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(() => daysBetween("2026-02-31", "2026-03-01")).toThrow();
  });
});
