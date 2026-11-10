import { describe, expect, it } from "vitest";
import { roles, type Actor, type EmploymentType } from "../shared/access";
import {
  beoFields,
  beoSections,
  defaultBeoKeyFields,
  diffBeoFields,
  snapshotOfFields,
  touchesKeyField,
  type BeoContent,
} from "../shared/beo";
import { projectBeo } from "../shared/policy";

// The BEO's pure parts: field flattening and diffing (FLOW-144), and the one
// projection every surface uses (FLOW-148).
const content: BeoContent = {
  header: { title: "Banquet event order", eventId: "e0000000-0000-4000-8000-000000000001", eventDate: "2026-11-14" },
  event: {
    title: "Fall gala",
    client: "Juniper & Co.",
    pointOfContact: { name: "Pat", role: "primary poc", phone: "2025550100", email: "pat@juniper.example" },
    venue: "The Atrium",
    address: "1 Main St",
    venueContacts: [{ name: "Vic", role: "manager", phone: "2025550111", email: "vic@atrium.example" }],
    clientContacts: [{ name: "Pat", role: "primary poc", phone: "2025550100", email: "pat@juniper.example" }],
    contactHidden: false,
  },
  summary: {
    date: "2026-11-14",
    startTime: "18:00",
    endTime: "23:00",
    arrivalTime: null,
    eventType: "Gala",
    serviceType: "",
    foodServiceStyle: "",
    guestCount: 80,
    servings: null,
    dressCode: "Black tie",
    salesperson: "Sam",
  },
  foodSetup: {
    leavesKitchenTime: null,
    courses: [
      {
        course: "Mains",
        lines: [{ name: "Short rib", quantity: null, tbd: true, allergens: ["dairy"], dietaryTags: [], notes: "" }],
      },
    ],
    allergens: ["dairy"],
    dietaryTags: [],
    tbdCount: 1,
  },
  staff: {
    productionLead: null,
    assistantLeads: [],
    shifts: [
      {
        kind: "event_day",
        kindLabel: "Event day",
        date: "2026-11-14",
        startTime: "16:00",
        endTime: "23:30",
        activities: "",
        slots: [{ label: "Server", department: "service", assignee: null, open: true }],
      },
    ],
    openSlots: 1,
  },
  timeline: [{ date: "2026-11-14", isEventDay: true, shifts: [], entries: [] }],
  equipment: { groups: [], tbdCount: 0 },
  runOfShow: { mode: "auto", enabled: false, threshold: 150, rows: [] },
  layout: { areas: [], loadInNotes: "", parkingNotes: "" },
  setupCleanup: { transportationNotes: "", setupDetails: "", areas: [], cleanup: [] },
  notes: { additionalNotes: "" },
};
const actor = (role: Actor["role"], employmentType: EmploymentType): Actor => ({
  userId: "a0000000-0000-4000-8000-000000000001",
  role,
  employmentType,
});

describe("BEO sections", () => {
  it("lists the ten sections in order (FLOW-143 AC1)", () => {
    expect(beoSections).toEqual([
      "header",
      "event",
      "summary",
      "food_setup",
      "staff",
      "timeline",
      "equipment",
      "layout",
      "setup_cleanup",
      "notes",
    ]);
  });

  it("has no price, cost or payment field anywhere in the data (FLOW-143 AC2)", () => {
    expect(JSON.stringify(content)).not.toMatch(/price|cost|payment|amount/i);
    expect(beoFields(content).map((field) => field.key).join(" ")).not.toMatch(/price|cost|payment/i);
  });

  it("marks open staff slots and TBD quantities in the fields (FLOW-143 AC3)", () => {
    const fields = Object.fromEntries(beoFields(content).map((field) => [field.key, field.value]));
    expect(fields.staff_roster).toContain("Server: OPEN");
    expect(fields.menu).toContain("Short rib × TBD");
  });
});

describe("change tracking", () => {
  it("names only the fields whose value changed", () => {
    const before = snapshotOfFields(beoFields(content));
    const after = beoFields({ ...content, summary: { ...content.summary, dressCode: "Cocktail" } });
    expect(diffBeoFields(before, after)).toEqual([
      { key: "dress_code", label: "Dress code", section: "summary", from: "Black tie", to: "Cocktail" },
    ]);
  });

  it("keeps contact phones and emails out of the fields", () => {
    const text = beoFields(content).map((field) => field.value).join("|");
    expect(text).not.toContain("2025550100");
    expect(text).not.toContain("@");
  });

  it("treats date, location, guest count and menu as the key fields by default", () => {
    const guests = diffBeoFields(
      snapshotOfFields(beoFields(content)),
      beoFields({ ...content, summary: { ...content.summary, guestCount: 90 } }),
    );
    expect(touchesKeyField(guests, defaultBeoKeyFields)).toBe(true);
    const dress = [{ key: "dress_code" }];
    expect(touchesKeyField(dress, defaultBeoKeyFields)).toBe(false);
  });
});

describe("projectBeo (FLOW-148 AC3)", () => {
  // Full-time staff, and Admin, Technical and the Sales Manager at any employment type.
  const seesContacts = (role: Actor["role"], employmentType: EmploymentType) =>
    employmentType === "full_time" || ["admin", "technical", "sales_manager"].includes(role);
  const cases = roles.flatMap((role) =>
    (["full_time", "part_time"] as const).map(
      (employmentType) => [role, employmentType, seesContacts(role, employmentType)] as const,
    ),
  );

  it.each(cases)("%s (%s): phones and emails only for FT+ (%s)", (role, employmentType, sees) => {
    const view = projectBeo(actor(role, employmentType), content);
    const contacts = [
      view.event.pointOfContact!,
      ...view.event.venueContacts,
      ...view.event.clientContacts,
    ];
    for (const contact of contacts) {
      expect(contact.name).not.toBe("");
      expect(contact.role).not.toBe("");
      expect(Boolean(contact.phone)).toBe(sees);
      expect(Boolean(contact.email)).toBe(sees);
    }
    expect(view.event.contactHidden).toBe(!sees);
    // No role ever sees pricing: the projection has nothing priced to show.
    expect(JSON.stringify(view)).not.toMatch(/price|cost|payment|amount/i);
    // The ten sections stay whole for everyone.
    expect(Object.keys(view)).toEqual(Object.keys(content));
  });
});
