// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { roles, type Actor, type Role } from "../shared/access";
import {
  actions,
  builtInCan,
  can,
  clientScope,
  eventScope,
  leadScope,
  recordScopes,
} from "../shared/policy";
import {
  areas,
  cardVisibleTo,
  completeMatrix,
  dashboardCards,
  defaultMatrix,
  levelsFor,
  matrixProblem,
  setPolicyMatrix,
  type AreaKey,
  type Level,
  type Matrix,
} from "../shared/role-permissions";

// Roles and permissions (FLOW-269): the matrix against the built-in rules.

const actor = (role: Role): Actor => ({ userId: "26900000-0000-4000-8000-000000000001", role });
const edited = (role: Role, area: AreaKey, level: Level): Matrix => ({
  ...defaultMatrix,
  [role]: { ...defaultMatrix[role], [area]: level },
});
afterEach(() => setPolicyMatrix(null));

describe("the seeded matrix", () => {
  it("AC1: answers every action and scope exactly like the built-in rules", () => {
    setPolicyMatrix(defaultMatrix);
    for (const role of roles) {
      for (const action of actions) expect(can(actor(role), action), `${role} ${action}`).toBe(builtInCan(actor(role), action));
      expect(clientScope(actor(role))).toBe(recordScopes[role].client);
      expect(leadScope(actor(role))).toBe(recordScopes[role].lead);
      expect(eventScope(actor(role))).toBe(recordScopes[role].event);
    }
  });

  it("locks Admin to Write on every area, and offers only levels an area supports", () => {
    for (const area of areas) expect(defaultMatrix.admin[area.key]).toBe("write");
    expect(matrixProblem(defaultMatrix)).toBeNull();
    expect(matrixProblem(edited("admin", "inventory_bar", "read"))).toMatch(/Admin always has Write/);
    // Own only where records have an owner; Read only where something can be read.
    expect(matrixProblem(edited("staff", "inventory_bar", "own"))).toMatch(/no Own level/);
    expect(matrixProblem(edited("staff", "settings_users", "read"))).toMatch(/no Read level/);
    expect(levelsFor(areas.find((area) => area.key === "leads")!)).toEqual(["none", "read", "own", "write"]);
    expect(levelsFor(areas.find((area) => area.key === "live_editing")!)).toEqual(["none", "write"]);
  });

  it("completes a partial stored matrix with the seeded levels and ignores stale ones", () => {
    const matrix = completeMatrix({ staff: { inventory_bar: "none", leads: "own" }, admin: { leads: "none" } });
    expect(matrix.staff.inventory_bar).toBe("none");
    // Leads is an owned area, so Own is a valid level there.
    expect(matrix.staff.leads).toBe("own");
    expect(matrix.staff.tasks).toBe(defaultMatrix.staff.tasks);
    expect(matrix.admin.leads).toBe("write");
  });
});

describe("a changed matrix", () => {
  it("AC2: Staff Inventory from Read to None removes inventory for Staff only", () => {
    expect(defaultMatrix.staff.inventory_bar).toBe("read");
    setPolicyMatrix(edited("staff", "inventory_bar", "none"));
    for (const action of ["inventory.read", "inventory.count", "inventory.move", "inventory.write"] as const)
      expect(can(actor("staff"), action), action).toBe(false);
    expect(can(actor("kitchen_staff"), "inventory.read")).toBe(true);
    expect(can(actor("admin"), "inventory.read")).toBe(true);
    // Back to Read: the built-in rule again, counting included.
    setPolicyMatrix(edited("staff", "inventory_bar", "read"));
    expect(can(actor("staff"), "inventory.count")).toBe(true);
  });

  it("Read allows viewing but not changing, Write allows both", () => {
    setPolicyMatrix(edited("sales_manager", "clients", "read"));
    expect(can(actor("sales_manager"), "clients.read")).toBe(true);
    expect(can(actor("sales_manager"), "clients.write")).toBe(false);
    expect(clientScope(actor("sales_manager"))).toBe("all");
    setPolicyMatrix(edited("staff", "clients", "write"));
    expect(can(actor("staff"), "clients.read")).toBe(true);
    expect(can(actor("staff"), "clients.write")).toBe(true);
    expect(clientScope(actor("staff"))).toBe("all");
  });

  it("Own limits a role to its own records", () => {
    setPolicyMatrix(edited("sales_manager", "leads", "own"));
    expect(leadScope(actor("sales_manager"))).toBe("own");
    expect(can(actor("sales_manager"), "leads.update")).toBe(true);
    expect(leadScope(actor("technical"))).toBe("all");
    // A role that already works on its own keeps its scope; None hides everything.
    setPolicyMatrix(edited("salesperson", "events", "none"));
    expect(eventScope(actor("salesperson"))).toBe("none");
    expect(can(actor("salesperson"), "events.read")).toBe(false);
    setPolicyMatrix(edited("kitchen_lead", "events", "own"));
    expect(eventScope(actor("kitchen_lead"))).toBe("staffed");
  });

  it("AC5: Staff pay is Admin-only until an Admin grants it", () => {
    setPolicyMatrix(defaultMatrix);
    for (const role of roles)
      expect(can(actor(role), "staff.pay.read"), role).toBe(role === "admin");
    setPolicyMatrix(edited("sales_manager", "staff_pay", "read"));
    expect(can(actor("sales_manager"), "staff.pay.read")).toBe(true);
    expect(can(actor("sales_manager"), "staff.pay.write")).toBe(false);
    expect(can(actor("technical"), "staff.pay.read")).toBe(false);
  });

  it("never changes actions outside the areas, and never changes Admin", () => {
    const everything: Matrix = completeMatrix(
      Object.fromEntries(roles.map((role) => [role, Object.fromEntries(areas.map((area) => [area.key, "none"]))])),
    );
    setPolicyMatrix(everything);
    for (const action of ["auth.read", "search.read", "notifications.read", "time.record", "settings.read"] as const)
      expect(can(actor("part_time_staff"), action), action).toBe(true);
    for (const action of actions) expect(can(actor("admin"), action), action).toBe(true);
    expect(can(actor("technical"), "events.read")).toBe(false);
  });
});

describe("card visibility", () => {
  it("AC4: a hidden card is hidden for that role only", () => {
    const hidden = ["sales_manager"] as Role[];
    const visibleTo = roles.filter((role) => !hidden.includes(role));
    expect(cardVisibleTo(defaultMatrix, "sales_manager", "events", visibleTo)).toBe(false);
    expect(cardVisibleTo(defaultMatrix, "technical", "events", visibleTo)).toBe(true);
    expect(cardVisibleTo(defaultMatrix, "sales_manager", "events", undefined)).toBe(true);
  });

  it("hides a card whose source area the role can't read", () => {
    const matrix = edited("staff", "tasks", "none");
    expect(cardVisibleTo(matrix, "staff", "tasks", undefined)).toBe(false);
    expect(cardVisibleTo(matrix, "kitchen_staff", "tasks", undefined)).toBe(true);
    expect(dashboardCards.map((card) => card.key)).toEqual([
      "my-leads",
      "upcoming-events",
      "working-staff",
      "my-tasks",
      "all-tasks",
    ]);
  });
});
