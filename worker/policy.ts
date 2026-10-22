import type { Actor } from "../shared/access";

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
  | "inventory.sections";

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

const rules: Record<Action, (actor: Actor) => boolean> = {
  "jobs.manage": isAdmin,
  "ingest.manage": isAdmin,
  "clients.write": sells,
  "venues.write": sells,
  "events.write": sells,
  "inventory.write": managesInventory,
  // Adding, renaming and archiving sections is Admin only (FLOW-70).
  "inventory.sections": isAdmin,
};

export const can = (actor: Actor, action: Action) =>
  isAdmin(actor) || rules[action](actor);

// Which records of a kind the actor may see. "own" = assigned to them as the
// salesperson; "staffed" = events they lead or assist; "none" = no access.
export type Scope = "all" | "own" | "staffed" | "none";

export function clientScope(actor: Actor): Scope {
  if (seesAllRecords(actor)) return "all";
  return actor.role === "salesperson" ? "own" : "none";
}

export function eventScope(actor: Actor): Scope {
  if (seesAllRecords(actor)) return "all";
  return actor.role === "salesperson" ? "own" : "staffed";
}
