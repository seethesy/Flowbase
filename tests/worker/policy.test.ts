// @vitest-environment node
import { expect, it } from "vitest";
import { Hono } from "hono";
import { readFileSync, readdirSync } from "node:fs";
import {
  roles,
  isFtPlus,
  type Actor,
} from "../../shared/access";
import {
  actions,
  can,
  canCountItem,
  canMoveItem,
  clientScope,
  leadScope,
  eventScope,
  mayOverrideStatus,
  type Action,
} from "../../shared/policy";
import { createApp } from "../../worker/app";
import { permissionOf, requirePermission, isActorGuard } from "../../worker/auth";
import type { AppEnv } from "../../worker/hono";

const actor = (role: Actor["role"]): Actor => ({
  userId: "38000000-0000-4000-8000-000000000001",
  role,
});
// Columns: Admin, Technical, Sales Manager, Salesperson, Kitchen Lead,
// Kitchen Staff, Staff. F = full-time only; absent entries are denied.
const expected: Record<Action, string> = {
  "auth.read": "1111111",
  "venues.read": "1111111",
  "events.read": "1111111",
  "inventory.read": "1111111",
  "recipes.read": "1111111",
  "search.read": "1111111",
  "attachments.read": "1111111",
  "time.read": "1111111",
  "time.record": "1111111",
  "staff.read": "1111111",
  "staff.update_self": "1111111",
  "settings.read": "1111111",
  "tasks.read": "1111111",
  "tasks.write": "1111111",
  "sops.read": "1111111",
  "tasks.delegate": "111F1FF",
  "tasks.triage": "1110100",
  "tasks.templates": "1110100",
  "home.kitchen": "1000110",
  "operations.read": "1100000",
  "reports.operations.read": "1110000",
  "notifications.read": "1111111",
  "approvals.read": "1111111",
  "approvals.write": "1111111",
  "settings.manage": "1000000",
  "copy.edit": "1000000",
  "layout.edit": "1000000",
  "clients.read": "1111000",
  "clients.write": "1111000",
  "venues.write": "1111000",
  "events.write": "1111000",
  "events.status": "1001000",
  "events.production_leads": "1010000",
  "leads.read": "1111000",
  "leads.create": "1111000",
  "leads.update": "1111000",
  "leads.convert": "1111000",
  "leads.merge": "1111000",
  "leads.assign": "1000000",
  "bookings.record": "1111000",
  "addendums.record": "1111000",
  "payments.record": "1111000",
  "rentals.write": "1111000",
  "rentals.apply_directly": "1010000",
  "rentals.approve": "1000000",
  "proposals.read": "1111000",
  "proposals.write": "1111000",
  "proposals.approve": "1000000",
  "order_lists.approve": "1000000",
  "order_lists.write": "1000100",
  "beos.approve": "1010000",
  "users.manage": "1000000",
  "jobs.manage": "1000000",
  "imports.run": "1000000",
  "ingest.manage": "1000000",
  "inventory.sections": "1000000",
  "inventory.write": "1110100",
  "inventory.changes.request": "111FFFF",
  "recipes.write": "111F11F",
  "inventory.count": "111111F",
  "inventory.move": "111111F",
  "inventory.rentals.move": "111111F",
  "inventory.ingredients.count": "1000110",
  "inventory.consumables.count": "111FFFF",
  "attachments.write": "1111100",
  "sops.write": "1010100",
  // Areas of the roles editor (FLOW-269) that were guarded by other actions.
  "production.read": "1111111",
  "beos.read": "1111111",
  "vendors.read": "1111111",
  "vendors.write": "1110100",
  // Staff pay (FLOW-270 A1): Admin and Technical read and edit it.
  "staff.pay.read": "1100000",
  "staff.pay.write": "1100000",
  // Changing staff roles from the directory (FLOW-270 A5): Admin and Technical.
  "staff.roles": "1100000",
  // Marketing photos (FLOW-271): everyone reads, Sales roles and Admin write.
  "marketing.read": "1111111",
  "marketing.write": "1111000",
};
// Every Admin has live editing, wording and layout (FLOW-253 comment, FLOW-269).
it("gives every Admin both live-edit permissions", () => {
  expect(can(actor("admin"), "copy.edit")).toBe(true);
  expect(can(actor("admin"), "layout.edit")).toBe(true);
});
it("accounts for every protected action in the role matrix", () => {
  expect(Object.keys(expected).sort()).toEqual([...actions].sort());
});
for (const [index, role] of roles.entries()) {
  it(`${role} against every protected action`, () => {
    for (const action of actions) {
      const matrix = expected[action];
      const cell = index === 7 ? matrix[6] : matrix[index];
      expect(can(actor(role), action), action).toBe(cell === "1" || (cell === "F" && role !== "part_time_staff"));
    }
  });
  it(`${role} scopes records and stock operations`, () => {
    const who = actor(role);
    const all = ["admin", "technical", "sales_manager"].includes(role);
    const owned = role === "salesperson";
    expect([clientScope(who), leadScope(who), eventScope(who)]).toEqual(
      all ? ["all", "all", "all"] : owned ? ["own", "own", "own"] : ["none", "none", "staffed"],
    );
    expect(isFtPlus(who)).toBe(role !== "part_time_staff");
    expect(canCountItem(who, { kind: "consumable", subtype: "ingredient" })).toBe(
      ["admin", "kitchen_lead", "kitchen_staff"].includes(role),
    );
    expect(canCountItem(who, { kind: "consumable", subtype: "bar" })).toBe(role !== "part_time_staff");
    expect(canMoveItem(who, { kind: "consumable", subtype: "ingredient" })).toBe(
      ["admin", "technical", "sales_manager", "kitchen_lead"].includes(role),
    );
  });
}
it("keeps status overrides on Admin or the assigned salesperson", () => {
  for (const role of roles) {
    const who = actor(role);
    expect(mayOverrideStatus(who, { assignedSalespersonId: who.userId })).toBe(
      role === "admin" || role === "salesperson",
    );
    expect(mayOverrideStatus(who, { assignedSalespersonId: null })).toBe(
      role === "admin",
    );
  }
});
it("denied middleware never invokes a protected handler", async () => {
  for (const role of roles) {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("actor", actor(role));
      await next();
    });
    let writes = 0;
    app.post("/", requirePermission("users.manage"), (c) => {
      writes++;
      return c.json({ ok: true });
    });
    expect((await app.request("/", { method: "POST" })).status).toBe(
      role === "admin" ? 200 : 403,
    );
    expect(writes).toBe(role === "admin" ? 1 : 0);
  }
});

// Hono stores one entry per middleware and handler. Group each actual endpoint
// with its attached middleware; global sign-in alone cannot satisfy the audit.
function unguarded(app: ReturnType<typeof createApp>) {
  const endpoints = new Map<string, typeof app.routes>();
  for (const route of app.routes) {
    if (
      !route.path.startsWith("/api/") ||
      (route.method === "ALL" && (route.path.endsWith("*") || isActorGuard(route.handler)))
    )
      continue;
    if (
      // The Google OAuth callback is Google's browser redirect: it trusts only
      // the signed state (FLOW-268, tests/db/events/google-calendar.test.ts).
      ["/api/health", "/api/auth/config", "/api/google-calendar/callback"].includes(route.path) ||
      /^\/api\/(demo|dev|ingest)\//.test(route.path)
    )
      continue;
    const key = `${route.method} ${route.path}`;
    endpoints.set(key, [...(endpoints.get(key) ?? []), route]);
  }
  return [...endpoints]
    .filter(
      ([, routes]) => !routes.some((route) => permissionOf(route.handler)),
    )
    .map(([key]) => key);
}
it("guards every staff API endpoint through the policy module", () => {
  expect(unguarded(createApp())).toEqual([]);
});
it("detects an unguarded route added beneath an existing signed-in resource", () => {
  const app = createApp();
  app.post("/api/events/unprotected", (c) => c.json({ leaked: true }));
  expect(unguarded(app)).toContain("POST /api/events/unprotected");
});
it("keeps field decisions out of record modules", () => {
  // Record modules sit in area folders (FLOW-312).
  const files = readdirSync("worker/records", { recursive: true, encoding: "utf8" });
  expect(files.length).toBeGreaterThan(50);
  for (const file of files.filter((file) => file.endsWith(".ts"))) {
    const source = readFileSync(`worker/records/${file}`, "utf8");
    expect(source, file).not.toMatch(
      /isFtPlus|actor\.role\s*(?:===|!==)|\[.*?\]\.includes\(actor\.role\)/,
    );
  }
});
