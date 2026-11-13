import { isFtPlus, type Actor, type Role } from "./access";
import type { BeoContact, BeoContent } from "./beo";

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
  // Tasks (FLOW-58): everyone creates tasks and works the ones they can see;
  // taskScope limits which ones. Assigning others needs tasks.delegate.
  "tasks.read",
  "tasks.write",
  // Their own notifications and email preferences (FLOW-43).
  "notifications.read",
  "sops.read",
  // Approval requests (FLOW-44): anyone may have made one or be its approver;
  // the engine checks who may see, decide or withdraw each request.
  "approvals.read",
  "approvals.write",
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
  // Proposals (FLOW-122/123): on the events the user can open.
  "proposals.read",
  "proposals.write",
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
    // Naming an event's Production Leads (FLOW-140 Q-40): Admin and Sales Manager.
    "events.production_leads",
    // Assigning tasks to other people (FLOW-58, from FLOW-60): Admin, Sales
    // Manager, Kitchen Lead and any FT+ user.
    "tasks.delegate",
    // The dashboard's "Needs delegation" section (FLOW-61) and task templates
    // (FLOW-62): Admin, Technical, Sales Manager and Kitchen Lead.
    "tasks.triage",
    "tasks.templates",
    "beos.approve",
    "rentals.apply_directly",
    // Master inventory changes (FLOW-73/74): FT+ staff submit rental and service
    // item edits as a batch; rentals.apply_directly applies them without approval.
    "inventory.changes.request",
    // Order lists (FLOW-86): Admin and Kitchen Lead build, edit and submit them;
    // order_lists.approve decides them.
    "order_lists.write",
    "inventory.consumables.count",
    "recipes.write",
    "attachments.write",
    "sops.write",
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
      "inventory.changes.request",
      "tasks.delegate",
      "tasks.triage",
      "tasks.templates",
    ]),
  },
  sales_manager: {
    ...grants(common, sales, inventory, [
      "recipes.write",
      "attachments.write",
      "sops.write",
      "beos.approve",
      "events.production_leads",
      "rentals.apply_directly",
      "inventory.consumables.count",
      "inventory.changes.request",
      "tasks.delegate",
      "tasks.triage",
      "tasks.templates",
    ]),
  },
  salesperson: {
    ...grants(common, sales, ["events.status", "attachments.write"]),
    "inventory.consumables.count": isFtPlus,
    "inventory.changes.request": isFtPlus,
    // Recipes: the kitchen and full-time staff edit them (Ash, 2026-10-27).
    "recipes.write": isFtPlus,
    "tasks.delegate": isFtPlus,
  },
  kitchen_lead: {
    ...grants(common, inventory, kitchen, [
      "recipes.write",
      "attachments.write",
      "sops.write",
      "tasks.delegate",
      "tasks.triage",
      "tasks.templates",
      "order_lists.write",
    ]),
    "inventory.consumables.count": isFtPlus,
    "inventory.changes.request": isFtPlus,
  },
  kitchen_staff: {
    ...grants(common, kitchen, ["recipes.write"]),
    "inventory.consumables.count": isFtPlus,
    "inventory.changes.request": isFtPlus,
    "tasks.delegate": isFtPlus,
  },
  staff: {
    ...grants(common),
    "recipes.write": isFtPlus,
    "inventory.count": isFtPlus,
    "inventory.move": isFtPlus,
    "inventory.rentals.move": isFtPlus,
    "inventory.consumables.count": isFtPlus,
    "inventory.changes.request": isFtPlus,
    "tasks.delegate": isFtPlus,
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
// Tasks (FLOW-58): FT+ see every task (the communal list, FLOW-59); everyone
// else sees the tasks they are assigned to, oversee or created.
export const taskScope = (actor: Actor): "all" | "own" =>
  isFtPlus(actor) ? "all" : "own";
// Changing a task's details, assignees or overseer: its creator, its overseer, or
// anyone who may delegate. Assignees who can't still update status, checklist and
// comments.
// Approval requests (FLOW-44): people see the requests they made and those their
// role approves; Admin sees all. Only the approver role or Admin decides one (AC3).
export const approvalScope = (actor: Actor): "all" | "own_and_role" =>
  actor.role === "admin" ? "all" : "own_and_role";
export const mayDecideApproval = (actor: Actor, approverRole: Role) =>
  actor.role === "admin" || actor.role === approverRole;
export const mayManageTask = (
  actor: Actor,
  task: { createdBy: string | null; overseerId: string | null },
) =>
  can(actor, "tasks.delegate") ||
  task.createdBy === actor.userId ||
  task.overseerId === actor.userId;
export const mayOverrideStatus = (
  actor: Actor,
  event: { assignedSalespersonId: string | null },
) =>
  can(actor, "events.status") &&
  (actor.role === "admin" || event.assignedSalespersonId === actor.userId);

// "Start planning" (FLOW-133): Admin, the Sales Manager or the event's salesperson.
export const mayStartPlanning = (
  actor: Actor,
  event: { assignedSalespersonId: string | null },
) =>
  can(actor, "events.write") &&
  (actor.role === "admin" ||
    actor.role === "sales_manager" ||
    event.assignedSalespersonId === actor.userId);

// The kitchen menu (FLOW-137): managers who edit events, and the Kitchen Lead, who
// plans the quantities (Q-47).
export const mayEditKitchenMenu = (actor: Actor) =>
  can(actor, "events.write") || actor.role === "kitchen_lead";

// Production leads can see their event's full list; operational managers can
// see all lists and respond to readiness checks.
export const mayViewAllProduction = (actor: Actor) =>
  actor.role === "admin" || actor.role === "sales_manager" || actor.role === "technical";
export const mayRespondToReadiness = (actor: Actor, productionLeadId: string | null) =>
  mayViewAllProduction(actor) || productionLeadId === actor.userId;

// Files inherit their parent resource's write permission in both the API and UI.
export const attachmentWriteActions = {
  client: "clients.write",
  venue: "venues.write",
  event: "events.write",
  inventory_item: "inventory.write",
  recipe: "recipes.write",
  task: "tasks.write",
  sop: "sops.write",
  beo_area: "events.write",
} as const satisfies Record<string, Action>;

// The BEO as one reader may see it (FLOW-148). The single projection every BEO
// surface uses: the calendar detail, print and offline copies must call this and
// never re-derive what a role sees. Client and venue phones and emails are for
// full-time staff and up; everyone else sees names and roles only. Nothing here
// ever returns a price, cost or payment: the content has no such field, and the
// projection rebuilds the content from named fields so a field added later is
// hidden until someone adds it here on purpose.
export function projectBeo(actor: Actor, content: BeoContent): BeoContent {
  const seesContacts = isFtPlus(actor);
  const contact = (c: BeoContact): BeoContact => ({
    name: c.name,
    role: c.role,
    phone: seesContacts ? c.phone : "",
    email: seesContacts ? c.email : "",
  });
  return {
    header: { ...content.header },
    event: {
      title: content.event.title,
      client: content.event.client,
      pointOfContact: content.event.pointOfContact ? contact(content.event.pointOfContact) : null,
      venue: content.event.venue,
      address: content.event.address,
      venueContacts: content.event.venueContacts.map(contact),
      clientContacts: content.event.clientContacts.map(contact),
      contactHidden: !seesContacts,
    },
    summary: { ...content.summary },
    foodSetup: content.foodSetup,
    staff: content.staff,
    timeline: content.timeline,
    equipment: content.equipment,
    runOfShow: content.runOfShow,
    layout: { ...content.layout },
    setupCleanup: { ...content.setupCleanup },
    notes: { ...content.notes },
  };
}
