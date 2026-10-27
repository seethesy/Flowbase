import { isFtPlus, type Actor, type Role } from "./access";

// ADR-07: the API and browser share this map. Database queries enforce row
// ownership separately; an action never grants access to another owner's row.
const common = [
  "auth.read",
  "venues.read",
  "events.read",
  "inventory.read",
  "recipes.read",
  "search.read",
  "attachments.read",
  "time.record",
  "time.read",
  // Staff directory (FLOW-40): everyone reads it and edits their own phone number
  // and SMS consent; record modules limit the fields. users.manage edits everything.
  "staff.read",
  "staff.update_self",
  // Business settings and lists (FLOW-45): forms read them; Admin changes them.
  "settings.read",
] as const;
const sales = [
  "clients.read",
  "clients.write",
  "venues.write",
  "events.write",
  "leads.read",
  "leads.update",
  "leads.convert",
  "leads.merge",
  "bookings.record",
  "addendums.record",
  "payments.record",
  "rentals.write",
  "inventory.rentals.move",
  "inventory.count",
  "inventory.move",
] as const;
const inventory = [
  "inventory.write",
  "inventory.count",
  "inventory.move",
] as const;
const kitchen = [
  "inventory.ingredients.count",
  "inventory.rentals.move",
  "inventory.count",
  "inventory.move",
] as const;
const adminOnly = [
  "users.manage",
  "settings.manage",
  "jobs.manage",
  "ingest.manage",
  "inventory.sections",
  "leads.assign",
  "rentals.approve",
  "proposals.approve",
  "order_lists.approve",
] as const;
export const actions = [
  ...new Set([
    ...common,
    ...sales,
    ...inventory,
    ...kitchen,
    ...adminOnly,
    "events.status",
    "beos.approve",
    "rentals.apply_directly",
    "inventory.consumables.count",
    "recipes.write",
    "attachments.write",
  ] as const),
];
export type Action = (typeof actions)[number];
type Rule = (actor: Actor) => boolean;
const allow: Rule = () => true;
const grants = (
  ...allowed: (readonly Action[])[]
): Partial<Record<Action, Rule>> =>
  Object.fromEntries(allowed.flat().map((action) => [action, allow]));

export const permissionMap: Record<Role, Partial<Record<Action, Rule>>> = {
  admin: grants(actions),
  technical: {
    ...grants(common, sales, inventory, [
      "recipes.write",
      "attachments.write",
      "inventory.consumables.count",
    ]),
  },
  sales_manager: {
    ...grants(common, sales, inventory, [
      "recipes.write",
      "attachments.write",
      "beos.approve",
      "rentals.apply_directly",
      "inventory.consumables.count",
    ]),
  },
  salesperson: {
    ...grants(common, sales, ["events.status", "attachments.write"]),
    "inventory.consumables.count": isFtPlus,
    // Recipes: the kitchen and full-time staff edit them (Ash, 2026-10-27).
    "recipes.write": isFtPlus,
  },
  kitchen_lead: {
    ...grants(common, inventory, kitchen, [
      "recipes.write",
      "attachments.write",
    ]),
    "inventory.consumables.count": isFtPlus,
  },
  kitchen_staff: {
    ...grants(common, kitchen, ["recipes.write"]),
    "inventory.consumables.count": isFtPlus,
  },
  staff: {
    ...grants(common),
    "recipes.write": isFtPlus,
    "inventory.count": isFtPlus,
    "inventory.move": isFtPlus,
    "inventory.rentals.move": isFtPlus,
    "inventory.consumables.count": isFtPlus,
  },
};
export const can = (actor: Actor, action: Action): boolean =>
  permissionMap[actor.role]?.[action]?.(actor) ?? false;

type StockItem = { kind: string; subtype: string | null };
export function canCountItem(actor: Actor, item: StockItem) {
  if (actor.role === "admin") return true;
  if (item.kind === "rental") return can(actor, "inventory.rentals.move");
  if (item.kind !== "consumable") return can(actor, "inventory.write");
  return can(
    actor,
    item.subtype === "ingredient"
      ? "inventory.ingredients.count"
      : "inventory.consumables.count",
  );
}
export const canMoveItem = (actor: Actor, item: StockItem) =>
  can(
    actor,
    item.kind === "rental" ? "inventory.rentals.move" : "inventory.write",
  );

export type Scope = "all" | "own" | "staffed" | "none";
const recordScopes: Record<Role, { client: Scope; lead: Scope; event: Scope }> =
  {
    admin: { client: "all", lead: "all", event: "all" },
    technical: { client: "all", lead: "all", event: "all" },
    sales_manager: { client: "all", lead: "all", event: "all" },
    salesperson: { client: "own", lead: "own", event: "own" },
    kitchen_lead: { client: "none", lead: "none", event: "staffed" },
    kitchen_staff: { client: "none", lead: "none", event: "staffed" },
    staff: { client: "none", lead: "none", event: "staffed" },
  };
export const clientScope = (actor: Actor): Scope =>
  recordScopes[actor.role].client;
// Admin, Technical and Sales Manager see all leads; salespeople see their own.
export const leadScope = (actor: Actor): Scope => recordScopes[actor.role].lead;
export const eventScope = (actor: Actor): Scope =>
  recordScopes[actor.role].event;
export const timeReportScope = (actor: Actor): "all" | "own" =>
  actor.role === "admin" || actor.role === "sales_manager" ? "all" : "own";
export const mayOverrideStatus = (
  actor: Actor,
  event: { assignedSalespersonId: string | null },
) =>
  can(actor, "events.status") &&
  (actor.role === "admin" || event.assignedSalespersonId === actor.userId);

// Files inherit their parent resource's write permission in both the API and UI.
export const attachmentWriteActions = {
  client: "clients.write",
  venue: "venues.write",
  event: "events.write",
  inventory_item: "inventory.write",
  recipe: "recipes.write",
} as const satisfies Record<string, Action>;
