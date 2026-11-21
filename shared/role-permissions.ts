import { z } from "zod";
import { roles, type Actor, type Role } from "./access";
import {
  builtInCan,
  recordScopes,
  setPolicyHooks,
  type Action,
  type Scope,
} from "./policy";

// Roles and permissions (FLOW-269): what each role may read or write, area by
// area. The matrix is stored (role_permissions) and edited in Settings; it is
// seeded from the built-in rules in shared/policy.ts, so until an Admin changes a
// cell every answer is the built-in one. A changed cell replaces the built-in
// rule for that role in that area:
//   None  — nothing in the area.
//   Read  — read-only, every record.
//   Own   — read and write, only the records assigned to them (Leads, Clients,
//           Proposals, Events, BEOs).
//   Write — read and write, every record.
// Admin is locked to Write everywhere, so no one can lock Admins out.

export const levels = ["none", "read", "own", "write"] as const;
export const levelSchema = z.enum(levels);
export type Level = z.infer<typeof levelSchema>;
export const levelLabels: Record<Level, string> = {
  none: "None",
  read: "Read",
  own: "Own",
  write: "Write",
};

export type AreaKey =
  | "leads"
  | "clients"
  | "proposals"
  | "events"
  | "beos"
  | "production"
  | "day_of"
  | "tasks"
  | "staff_directory"
  | "staff_pay"
  | "inventory_bar"
  | "purchasing"
  | "vendors"
  | "recipes_menus"
  | "documents"
  | "marketing_photos"
  | "reports"
  | "settings_users"
  | "live_editing";

export type AreaDef = {
  key: AreaKey;
  label: string;
  // Offers the Own level: records have an owner (an assigned salesperson or the
  // event's staff).
  own?: boolean;
  // What Read allows; Write adds the second list. The first action of each list
  // decides a role's seeded level.
  read: readonly Action[];
  write: readonly Action[];
};

export const areas: readonly AreaDef[] = [
  { key: "leads", label: "Leads", own: true, read: ["leads.read"], write: ["leads.update", "leads.create", "leads.convert", "leads.merge", "leads.assign"] },
  { key: "clients", label: "Clients", own: true, read: ["clients.read"], write: ["clients.write"] },
  { key: "proposals", label: "Proposals", own: true, read: ["proposals.read"], write: ["proposals.write", "proposals.approve", "bookings.record", "addendums.record", "payments.record"] },
  { key: "events", label: "Events", own: true, read: ["events.read", "venues.read"], write: ["events.write", "venues.write", "events.status", "events.production_leads"] },
  { key: "beos", label: "BEOs", own: true, read: ["beos.read"], write: ["beos.approve"] },
  { key: "production", label: "Production", read: ["production.read"], write: ["home.kitchen"] },
  { key: "day_of", label: "Day-of", read: ["dayof.read"], write: [] },
  { key: "tasks", label: "Tasks", read: ["tasks.read"], write: ["tasks.write", "tasks.delegate", "tasks.triage", "tasks.templates"] },
  { key: "staff_directory", label: "Staff directory", read: ["staff.read"], write: [] },
  { key: "staff_pay", label: "Staff pay", read: ["staff.pay.read"], write: ["staff.pay.write"] },
  {
    key: "inventory_bar",
    label: "Inventory and Bar",
    read: ["inventory.read", "inventory.count", "inventory.move", "inventory.rentals.move", "inventory.ingredients.count", "inventory.consumables.count", "inventory.changes.request"],
    write: ["inventory.write", "inventory.sections", "rentals.write", "rentals.approve", "rentals.apply_directly"],
  },
  { key: "purchasing", label: "Purchasing", read: [], write: ["order_lists.write", "order_lists.approve"] },
  { key: "vendors", label: "Vendors", read: ["vendors.read"], write: ["vendors.write"] },
  { key: "recipes_menus", label: "Recipes and Menus", read: ["recipes.read"], write: ["recipes.write"] },
  { key: "documents", label: "Documents", read: ["attachments.read", "sops.read"], write: ["attachments.write", "sops.write"] },
  { key: "marketing_photos", label: "Marketing photos", read: ["marketing.read"], write: ["marketing.write"] },
  { key: "reports", label: "Reports", read: ["reports.operations.read", "operations.read"], write: [] },
  { key: "settings_users", label: "Settings and users", read: [], write: ["settings.manage", "users.manage", "jobs.manage", "ingest.manage"] },
  { key: "live_editing", label: "Live editing (wording and layout)", read: [], write: ["copy.edit", "layout.edit"] },
];
export const areaKeys = areas.map((area) => area.key);
export const areaSchema = z.enum(areaKeys as [AreaKey, ...AreaKey[]]);
const areaByKey = new Map(areas.map((area) => [area.key, area]));
export const areaOf = (key: AreaKey) => areaByKey.get(key)!;
// The area an action belongs to; actions outside every area (signing in, search,
// own notifications, own time...) are never changed by the matrix.
const areaByAction = new Map<Action, AreaDef>(
  areas.flatMap((area) => [...area.read, ...area.write].map((action) => [action, area] as const)),
);

// The levels an area offers: Read only where something can be read, Own only
// where records have an owner, and Write only where something can be written.
export function levelsFor(area: AreaDef): Level[] {
  return levels.filter(
    (level) =>
      level === "none" ||
      (level === "read" && area.read.length > 0) ||
      (level === "own" && area.own === true) ||
      (level === "write" && area.write.length > 0),
  );
}

export type Matrix = Record<Role, Record<AreaKey, Level>>;

// Records whose scope helpers read the matrix; proposals and BEOs follow the
// event they belong to.
const scopeRecord = (area: AreaKey): "client" | "lead" | "event" =>
  area === "clients" ? "client" : area === "leads" ? "lead" : "event";

// The level today's rules give a role in an area. This seeds the matrix.
function seededLevel(role: Role, area: AreaDef): Level {
  if (role === "admin") return "write";
  const actor: Actor = { userId: "00000000-0000-4000-8000-000000000000", role };
  const holds = (action: Action) => builtInCan(actor, action);
  const [primaryRead] = area.read;
  const [primaryWrite] = area.write;
  if (area.own) {
    const scope = recordScopes[role][scopeRecord(area.key)];
    if (scope === "none" || ![...area.read, ...area.write].some(holds)) return "none";
    if (scope === "own" || scope === "staffed") return "own";
  }
  if (primaryWrite && holds(primaryWrite)) return "write";
  if (primaryRead && holds(primaryRead)) return "read";
  return "none";
}

export const defaultMatrix: Matrix = Object.fromEntries(
  roles.map((role) => [
    role,
    Object.fromEntries(areas.map((area) => [area.key, seededLevel(role, area)])),
  ]),
) as Matrix;

// What GET/PUT /api/permissions carry: a level for every role and area.
export const matrixSchema = z
  .object(
    Object.fromEntries(
      roles.map((role) => [
        role,
        z.object(Object.fromEntries(areaKeys.map((key) => [key, levelSchema]))).strict(),
      ]),
    ) as unknown as Record<Role, z.ZodType<Record<AreaKey, Level>>>,
  )
  .strict() as unknown as z.ZodType<Matrix>;

// Why a matrix can't be saved, or null. Admin must stay at Write everywhere (the
// API answers 400), and a level must be one the area offers.
export function matrixProblem(matrix: Matrix): string | null {
  for (const area of areas) {
    if (matrix.admin[area.key] !== "write")
      return `Admin always has Write on ${area.label}.`;
    for (const role of roles)
      if (role !== "admin" && !levelsFor(area).includes(matrix[role][area.key]))
        return `${area.label} has no ${levelLabels[matrix[role][area.key]]} level.`;
  }
  return null;
}

// Fills in any role or area a stored matrix lacks with the seeded level.
export function completeMatrix(partial: Partial<Record<Role, Partial<Record<AreaKey, Level>>>>): Matrix {
  return Object.fromEntries(
    roles.map((role) => [
      role,
      Object.fromEntries(
        areas.map((area) => {
          const stored = partial[role]?.[area.key];
          const level = role === "admin" ? "write" : stored && levelsFor(area).includes(stored) ? stored : defaultMatrix[role][area.key];
          return [area.key, level];
        }),
      ),
    ]),
  ) as Matrix;
}

export const levelOf = (matrix: Matrix, role: Role, area: AreaKey): Level =>
  role === "admin" ? "write" : (matrix[role]?.[area] ?? defaultMatrix[role][area]);

// The matrix's answer for one action, or null where the role keeps its built-in
// rule (Admin, actions outside the areas, and cells left at their seeded level).
export function matrixCan(matrix: Matrix, actor: Actor, action: Action): boolean | null {
  const area = areaByAction.get(action);
  if (!area || actor.role === "admin") return null;
  const level = levelOf(matrix, actor.role, area.key);
  if (level === defaultMatrix[actor.role][area.key]) return null;
  if (level === "none") return false;
  if (level === "read") return area.read.includes(action);
  return true;
}

export function matrixScope(matrix: Matrix, actor: Actor, record: "client" | "lead" | "event"): Scope | null {
  if (actor.role === "admin") return null;
  const key: AreaKey = record === "client" ? "clients" : record === "lead" ? "leads" : "events";
  const level = levelOf(matrix, actor.role, key);
  if (level === defaultMatrix[actor.role][key]) return null;
  if (level === "none") return "none";
  if (level === "own") {
    const built = recordScopes[actor.role][record];
    return built === "staffed" ? "staffed" : "own";
  }
  return "all";
}

let current: Matrix | null = null;
// The matrix in force (the seeded one until a stored matrix is set).
export const policyMatrix = (): Matrix => current ?? defaultMatrix;

// Makes the matrix the one `can` and the scope helpers use; null goes back to
// the built-in rules. The Worker calls it per request after loading the matrix,
// the browser once after sign-in.
export function setPolicyMatrix(matrix: Matrix | null) {
  current = matrix;
  setPolicyHooks(
    matrix
      ? {
          can: (actor, action) => matrixCan(matrix, actor, action),
          scope: (actor, record) => matrixScope(matrix, actor, record),
        }
      : null,
  );
}

// ---- Card visibility --------------------------------------------------------

// The dashboard's built-in cards, their block ids on the "dashboard.home" page
// layout, and the area each reads from. A custom card names its own source.
export const dashboardCards: { key: string; label: string; area: AreaKey }[] = [
  { key: "my-leads", label: "My Leads", area: "leads" },
  { key: "upcoming-events", label: "Upcoming Events", area: "events" },
  { key: "working-staff", label: "Working Staff", area: "events" },
  { key: "my-tasks", label: "My Tasks", area: "tasks" },
  { key: "all-tasks", label: "All Tasks", area: "tasks" },
];
export const DASHBOARD_PAGE_KEY = "dashboard.home";

export const cardShown = (visibleTo: readonly Role[] | undefined, role: Role) =>
  !visibleTo || visibleTo.includes(role);

// A card shows only if it is visible to the role and the role can read its
// source area (FLOW-269).
export const cardVisibleTo = (
  matrix: Matrix,
  role: Role,
  area: AreaKey,
  visibleTo: readonly Role[] | undefined,
) => cardShown(visibleTo, role) && levelOf(matrix, role, area) !== "none";

// The API's response and the Settings screen's draft.
export const permissionsSchema = z.object({ matrix: matrixSchema });
export type Permissions = z.infer<typeof permissionsSchema>;

// The area a custom card's list source reads from.
export const sourceArea: Record<string, AreaKey | undefined> = {
  leads: "leads",
  events: "events",
  clients: "clients",
  venues: "events",
  vendors: "vendors",
  staff: "staff_directory",
  inventory: "inventory_bar",
  proposals: "proposals",
  tasks: "tasks",
};
