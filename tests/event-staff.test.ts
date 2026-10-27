import { describe, expect, it } from "vitest";
import {
  defaultDepartment,
  overlaps,
  productionLeadsInputSchema,
  shiftInputSchema,
  slotLabel,
  slotNumbers,
  staffingBreakdown,
} from "../shared/event-staff";
import { can } from "../shared/policy";

// Staff roster rules (FLOW-140) shared by the API and the event hub.

describe("double-booking", () => {
  const shift = (startsAt: string, endsAt: string) => ({ startsAt, endsAt });
  it("flags shifts that overlap (AC1)", () => {
    expect(
      overlaps(
        shift("2026-11-14T21:00:00Z", "2026-11-15T04:30:00Z"),
        shift("2026-11-14T17:00:00Z", "2026-11-14T22:00:00Z"),
      ),
    ).toBe(true);
    // One inside the other.
    expect(
      overlaps(
        shift("2026-11-14T21:00:00Z", "2026-11-15T04:30:00Z"),
        shift("2026-11-14T23:00:00Z", "2026-11-15T00:00:00Z"),
      ),
    ).toBe(true);
  });
  it("doesn't flag back-to-back or separate shifts", () => {
    expect(
      overlaps(
        shift("2026-11-14T14:00:00Z", "2026-11-14T21:00:00Z"),
        shift("2026-11-14T21:00:00Z", "2026-11-15T04:30:00Z"),
      ),
    ).toBe(false);
    expect(
      overlaps(
        shift("2026-11-13T13:00:00Z", "2026-11-13T17:00:00Z"),
        shift("2026-11-14T21:00:00Z", "2026-11-15T04:30:00Z"),
      ),
    ).toBe(false);
  });
});

describe("open slots and breakdown (AC2)", () => {
  it("numbers repeated positions in order and leaves single ones unnumbered", () => {
    const numbers = slotNumbers([
      { id: "a", position: "Chef on site" },
      { id: "b", position: "Server" },
      { id: "c", position: "Sous Chef" },
      { id: "d", position: "Server" },
      { id: "e", position: "Sous Chef" },
    ]);
    expect([...numbers]).toEqual([
      ["a", null],
      ["b", 1],
      ["c", 1],
      ["d", 2],
      ["e", 2],
    ]);
    expect(slotLabel({ position: "Server", number: 5 })).toBe("Server #5");
    expect(slotLabel({ position: "Driver", number: null })).toBe("Driver");
  });
  it("counts headcount and filled slots by department", () => {
    expect(
      staffingBreakdown([
        { department: "decor_setup", assigneeId: null },
        { department: "kitchen", assigneeId: "x" },
        { department: "kitchen", assigneeId: null },
        { department: "kitchen", assigneeId: "y" },
        { department: "decor_setup", assigneeId: "z" },
      ]),
    ).toEqual([
      { department: "kitchen", total: 3, filled: 2 },
      { department: "decor_setup", total: 2, filled: 1 },
    ]);
    expect(staffingBreakdown([])).toEqual([]);
  });
  it("starts the default positions in their department", () => {
    expect(defaultDepartment("Sous Chef")).toBe("kitchen");
    expect(defaultDepartment("Server")).toBe("service");
    expect(defaultDepartment("Decor/Setup crew")).toBe("decor_setup");
    expect(defaultDepartment("Fire juggler")).toBe("other");
  });
});

describe("shifts", () => {
  it("needs a day, date and both times", () => {
    expect(
      shiftInputSchema.safeParse({
        kind: "setup",
        date: "2026-11-13",
        startTime: "13:00",
        endTime: "18:00",
      }).success,
    ).toBe(true);
    expect(
      shiftInputSchema.safeParse({
        kind: "setup",
        date: "2026-11-13",
        startTime: "13:00",
      }).success,
    ).toBe(false);
    expect(
      shiftInputSchema.safeParse({
        kind: "rehearsal",
        date: "2026-11-13",
        startTime: "13:00",
        endTime: "18:00",
      }).success,
    ).toBe(false);
  });
});

describe("Production Leads", () => {
  const lead = "c1400000-0000-4000-8000-000000000005";
  const assistant = "c1400000-0000-4000-8000-000000000004";
  it("refuses assistants without a primary (AC3)", () => {
    const result = productionLeadsInputSchema.safeParse({
      productionLeadId: null,
      assistantLeadIds: [assistant],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toBe(
      "Name a primary Production Lead before adding assistants.",
    );
    expect(
      productionLeadsInputSchema.safeParse({
        productionLeadId: lead,
        assistantLeadIds: [assistant],
      }).success,
    ).toBe(true);
    expect(
      productionLeadsInputSchema.safeParse({
        productionLeadId: null,
        assistantLeadIds: [],
      }).success,
    ).toBe(true);
  });
  it("refuses the primary as an assistant and repeated assistants", () => {
    expect(
      productionLeadsInputSchema.safeParse({
        productionLeadId: lead,
        assistantLeadIds: [lead],
      }).success,
    ).toBe(false);
    expect(
      productionLeadsInputSchema.safeParse({
        productionLeadId: lead,
        assistantLeadIds: [assistant, assistant],
      }).success,
    ).toBe(false);
  });
  it("lets only Admin and the Sales Manager name them", () => {
    const actor = (role: "admin" | "sales_manager" | "salesperson") => ({
      userId: lead,
      role,
      employmentType: "full_time" as const,
    });
    expect(can(actor("admin"), "events.production_leads")).toBe(true);
    expect(can(actor("sales_manager"), "events.production_leads")).toBe(true);
    expect(can(actor("salesperson"), "events.production_leads")).toBe(false);
  });
});
