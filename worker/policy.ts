import { isFtPlus, type Actor } from "../shared/access";

// Stand-in for the FLOW-38 permission matrix: it covers only the actions built so
// far, and FLOW-38 replaces it with the full role map. Admin can do everything.
// Technical follows the recommendation on FLOW-38 Q1 (same record visibility as the
// Sales Manager) until that question is answered.
export type Action =
  | "jobs.manage"
  | "ingest.manage"
  | "clients.write"
  | "venues.write"
  | "events.write"
  | "inventory.write"
  | "inventory.count"
  | "inventory.sections"
  | "leads.update"
  | "leads.assign"
  | "leads.convert";

const isAdmin = (actor: Actor) => actor.role === "admin";
const seesAllRecords = (actor: Actor) =>
  actor.role === "admin" ||
  actor.role === "technical" ||
  actor.role === "sales_manager";
const sells = (actor: Actor) =>
  seesAllRecords(actor) || actor.role === "salesperson";

// Inventory items, stock counts and transfers: managers and the kitchen lead.
const managesInventory = (actor: Actor) =>
  seesAllRecords(actor) || actor.role === "kitchen_lead";

// Consumable counts (FLOW-82): Admin and the kitchen count ingredients; Admin and
// FT+ count bar stock and supplies.
const countsIngredients = (actor: Actor) =>
  actor.role === "kitchen_lead" || actor.role === "kitchen_staff";

const rules: Record<Action, (actor: Actor) => boolean> = {
  "jobs.manage": isAdmin,
  "ingest.manage": isAdmin,
  "clients.write": sells,
  "venues.write": sells,
  "events.write": sells,
  "inventory.write": managesInventory,
  // May count at least something: opens count mode.
  "inventory.count": (actor) =>
    managesInventory(actor) || countsIngredients(actor) || isFtPlus(actor),
  // Adding, renaming and archiving sections is Admin only (FLOW-70).
  "inventory.sections": isAdmin,
  "leads.update": sells,
  "leads.convert": sells,
  // Admin only (FLOW-111, Q-41a). Widening it to the Sales Manager later is this one
  // rule; the answer to FLOW-111 Q1 decides.
  "leads.assign": () => false,
};

export const can = (actor: Actor, action: Action) =>
  isAdmin(actor) || rules[action](actor);

// Who may count an item. Consumable counts need no approval and follow the kitchen
// and bar split; rental counts stay with inventory managers until approval-gated
// Master changes exist (FLOW-73).
export function canCountItem(
  actor: Actor,
  item: { kind: string; subtype: string | null },
) {
  if (isAdmin(actor)) return true;
  if (item.kind !== "consumable") return can(actor, "inventory.write");
  return item.subtype === "ingredient"
    ? countsIngredients(actor)
    : isFtPlus(actor);
}

// Which records of a kind the actor may see. "own" = assigned to them as the
// salesperson; "staffed" = events they lead or assist; "none" = no access.
export type Scope = "all" | "own" | "staffed" | "none";

export function clientScope(actor: Actor): Scope {
  if (seesAllRecords(actor)) return "all";
  return actor.role === "salesperson" ? "own" : "none";
}

// Admin and Sales Manager see every lead; a salesperson sees only the leads assigned
// to them (Q-41). Everyone else has no access to leads.
export function leadScope(actor: Actor): Scope {
  if (seesAllRecords(actor)) return "all";
  return actor.role === "salesperson" ? "own" : "none";
}

export function eventScope(actor: Actor): Scope {
  if (seesAllRecords(actor)) return "all";
  return actor.role === "salesperson" ? "own" : "staffed";
}

// Time-tracking reports (FLOW-119): Admin and Sales Manager see everyone's time;
// every other user sees only their own.
export function timeReportScope(actor: Actor): "all" | "own" {
  return actor.role === "admin" || actor.role === "sales_manager"
    ? "all"
    : "own";
}
