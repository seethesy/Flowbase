// @vitest-environment node
import { expect, it } from "vitest";
import { roles, employmentTypes, type Actor } from "../../shared/access";
import {
  fieldGroups,
  canSeeField,
  serializeFields,
  serializeFieldGroups,
  redactFieldHistory,
} from "../../shared/visibility";

const userId = "39000000-0000-4000-8000-000000000001";
for (const role of roles)
  for (const employmentType of employmentTypes) {
    const who: Actor = { userId, role, employmentType };
    const privileged = ["admin", "technical", "sales_manager"].includes(role);
    const ft = privileged || employmentType === "full_time";
    const cost = ft || role === "kitchen_lead" || role === "kitchen_staff";
    const expected = {
      client_contact: ft,
      venue_contact: ft,
      vendor_contact: ft,
      lead_contact: privileged || role === "salesperson",
      internal_cost: cost,
      financials: privileged || role === "salesperson",
      // Without a subject, only FT+ (the person themselves is checked below).
      staff_contact: ft,
    };
    it(`${role}/${employmentType}: every group, serializers and history`, () => {
      for (const group of fieldGroups)
        expect(
          canSeeField(who, group, { assignedSalespersonId: userId }),
          group,
        ).toBe(expected[group]);
      expect(
        canSeeField(who, "financials", { assignedSalespersonId: null }),
      ).toBe(privileged);
      expect(
        canSeeField(who, "financials", {
          assignedSalespersonId: "someone-else",
        }),
      ).toBe(privileged);
      const contact = {
        id: "poc",
        name: "Contact",
        email: "secret@example.com",
        phone: "202-555-0111",
      };
      const client = { contacts: [contact] };
      const serialized = serializeFields(who, "client", client);
      expect(serialized.contacts[0].email).toBe(ft ? contact.email : null);
      expect(serialized.contacts[0].phone).toBe(ft ? contact.phone : null);
      expect(client.contacts[0].email).toBe(contact.email);
      expect(serializeFields(who, "venue", client).contacts).toEqual(
        ft ? client.contacts : null,
      );
      // FLOW-84 AC3: vendor contacts and account numbers are FT+ only.
      const vendor = serializeFields(who, "vendor", {
        name: "Imperio",
        accountNumber: "ACCT-778",
        contacts: [contact],
      });
      expect(vendor).toEqual({
        name: "Imperio",
        accountNumber: ft ? "ACCT-778" : null,
        contacts: ft ? [contact] : null,
      });
      const item = serializeFields(who, "inventory_item", {
        consumable: { unitCostCents: 9876, costHidden: false },
      });
      expect(item.consumable).toEqual({
        unitCostCents: cost ? 9876 : null,
        costHidden: !cost,
      });
      const changes = {
        contacts: {
          before: [contact],
          after: [{ ...contact, email: "new-secret@example.com" }],
        },
      };
      expect(redactFieldHistory(who, "client", changes)).toEqual(
        ft ? changes : {},
      );
      expect(redactFieldHistory(who, "venue", changes)).toEqual(
        ft ? changes : {},
      );
      const groups = {
        internal_cost: 9876,
        financials: { total: 12345, payments: [123] },
      };
      expect(
        serializeFieldGroups(who, groups, {
          assignedSalespersonId: userId,
          view: "beo",
        }),
      ).toEqual({ internal_cost: null, financials: null });
      expect(
        serializeFieldGroups(who, groups, { view: "client_recipe" })
          .internal_cost,
      ).toBeNull();
      expect(canSeeField(who, "internal_cost", { view: "internal_recipe" })).toBe(ft);
      // Staff directory (FLOW-40): a phone number shows to FT+ and its owner;
      // notes show to FT+ only, never because the notes are about you.
      const member = { id: "someone-else", mobile: "2025550123", notes: "Drives the box truck" };
      expect(
        serializeFields(who, "staff_member", member, { subjectUserId: member.id }),
      ).toEqual({
        id: member.id,
        mobile: ft ? member.mobile : null,
        notes: ft ? member.notes : null,
      });
      const self = { ...member, id: userId };
      expect(
        serializeFields(who, "staff_member", self, { subjectUserId: userId }),
      ).toEqual({ ...self, notes: ft ? self.notes : null });
      expect(canSeeField(who, "staff_contact", { subjectUserId: userId })).toBe(true);
      expect(canSeeField(who, "staff_contact", { subjectUserId: null })).toBe(ft);
      expect(
        serializeFields(
          who,
          "inventory_item",
          { rental: { priceCents: 4567 }, service: { priceCents: 8910 } },
          { view: "beo" },
        ),
      ).toEqual({
        rental: { priceCents: null },
        service: { priceCents: null },
      });
    });
  }
it("redacts hidden nested contact values without losing a visible name change", () => {
  const who: Actor = {
    userId,
    role: "salesperson",
    employmentType: "part_time",
  };
  const changes = {
    contacts: {
      before: [{ name: "Before", email: "old@example.com", phone: "111" }],
      after: [{ name: "After", email: "new@example.com", phone: "222" }],
    },
  };
  expect(redactFieldHistory(who, "client", changes)).toEqual({
    contacts: {
      before: [{ name: "Before", email: null, phone: null }],
      after: [{ name: "After", email: null, phone: null }],
    },
  });
});
