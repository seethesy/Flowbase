// @vitest-environment node
import { describe, expect, it } from "vitest";
import { roleSchema, type Actor, type Role } from "../../shared/access";
import { eventStatusSchema, type EventStatus } from "../../shared/core-records";
import {
  automaticNextStatuses,
  isAutomaticTransition,
  mayOverrideStatus,
} from "../../shared/event-lifecycle";

// FLOW-56 AC3: every pair of statuses, written out rather than derived.
const automatic: Record<EventStatus, EventStatus[]> = {
  inquiry: ["pitching", "lost"],
  pitching: ["proposal_creation", "lost"],
  proposal_creation: ["initial_proposal_sent", "lost"],
  initial_proposal_sent: ["negotiation", "lost"],
  negotiation: ["closing", "lost"],
  closing: ["closed", "lost"],
  closed: ["preparation", "lost"],
  preparation: ["finished", "lost"],
  finished: [],
  lost: [],
};
const statuses = eventStatusSchema.options;
const pairs = statuses.flatMap((from) => statuses.map((to) => [from, to] as const));

describe("automatic transitions", () => {
  it("covers every status", () => {
    expect(Object.keys(automatic).sort()).toEqual([...statuses].sort());
  });
  it.each(pairs)("%s → %s", (from, to) => {
    expect(isAutomaticTransition(from, to)).toBe(automatic[from].includes(to));
  });
  it.each(statuses)("lists the allowed next statuses from %s", (from) => {
    expect(automaticNextStatuses(from)).toEqual(automatic[from]);
  });
});

describe("manual overrides", () => {
  const me = "8d6f2a4e-5b1c-4e8a-9f3d-2c7b1a0e6d54";
  const someoneElse = "0b7c6d5e-4f3a-4b2c-9d1e-0f9a8b7c6d5e";
  const actor = (role: Role): Actor => ({
    userId: me,
    role,
    employmentType: "full_time",
  });
  // Any status to any status (A1); who may do it (A2).
  const expected: Record<Role, { own: boolean; other: boolean }> = {
    admin: { own: true, other: true },
    salesperson: { own: true, other: false },
    technical: { own: false, other: false },
    sales_manager: { own: false, other: false },
    kitchen_lead: { own: false, other: false },
    kitchen_staff: { own: false, other: false },
    staff: { own: false, other: false },
  };
  it("covers every role", () => {
    expect(Object.keys(expected).sort()).toEqual([...roleSchema.options].sort());
  });
  it.each(roleSchema.options)("%s", (role) => {
    expect(mayOverrideStatus(actor(role), { assignedSalespersonId: me })).toBe(
      expected[role].own,
    );
    expect(
      mayOverrideStatus(actor(role), { assignedSalespersonId: someoneElse }),
    ).toBe(expected[role].other);
    expect(mayOverrideStatus(actor(role), { assignedSalespersonId: null })).toBe(
      role === "admin",
    );
  });
});
