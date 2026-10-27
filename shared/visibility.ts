import { isFtPlus, type Actor } from "./access";
import { clientScope, leadScope } from "./policy";

export const fieldGroups = [
  "client_contact",
  "venue_contact",
  "lead_contact",
  "internal_cost",
  "financials",
  "staff_contact",
] as const;
export type FieldGroup = (typeof fieldGroups)[number];
export type ViewContext = {
  assignedSalespersonId?: string | null;
  // The staff member a staff_contact value belongs to (FLOW-40).
  subjectUserId?: string | null;
  view?: "internal" | "internal_recipe" | "client_recipe" | "beo";
};
const fieldRules: Record<
  FieldGroup,
  (actor: Actor, context: ViewContext) => boolean
> = {
  client_contact: isFtPlus,
  venue_contact: isFtPlus,
  lead_contact: (actor) => leadScope(actor) !== "none",
  internal_cost: (actor) =>
    isFtPlus(actor) ||
    actor.role === "kitchen_lead" ||
    actor.role === "kitchen_staff",
  financials: (actor, context) =>
    ["admin", "technical", "sales_manager"].includes(actor.role) ||
    (actor.role === "salesperson" &&
      context.assignedSalespersonId === actor.userId),
  // A staff member's phone number: FT+ and the person themselves (FLOW-40 AC3).
  staff_contact: (actor, context) =>
    isFtPlus(actor) ||
    (Boolean(context.subjectUserId) && context.subjectUserId === actor.userId),
};
export function canSeeField(
  actor: Actor,
  group: FieldGroup,
  context: ViewContext = {},
): boolean {
  if (
    context.view === "beo" &&
    (group === "internal_cost" || group === "financials")
  )
    return false;
  if (context.view === "client_recipe" && group === "internal_cost")
    return false;
  // FLOW-96: recipe costs are FT+ only, even for part-time kitchen roles.
  if (context.view === "internal_recipe" && group === "internal_cost")
    return isFtPlus(actor);
  return fieldRules[group](actor, context);
}

// These paths describe the existing API shapes. Nested values and historical
// before/after snapshots pass through the very same projection.
type Rule =
  | FieldGroup
  | "lead_payload"
  | "duplicate_match"
  | "pricing"
  | "staff_notes"
  | "rental_cost"
  | { [key: string]: Rule };
const contact: Rule = { email: "client_contact", phone: "client_contact" };
const shapes = {
  client_contact: contact,
  client: { contacts: contact, possibleDuplicateOf: "duplicate_match" },
  venue: { contacts: "venue_contact" },
  lead: {
    email: "lead_contact",
    phone: "lead_contact",
    rawPayload: "lead_payload",
  },
  inventory_item: {
    consumable: { unitCostCents: "internal_cost" },
    rental: {
      priceCents: "pricing",
      internalCostCents: "rental_cost",
      replacementCostCents: "rental_cost",
    },
    service: { priceCents: "pricing", addons: { priceCents: "pricing" } },
  },
  staff_member: { mobile: "staff_contact", notes: "staff_notes" },
} satisfies Record<string, Rule>;
export type VisibilityShape = keyof typeof shapes;
function visible(actor: Actor, rule: string, context: ViewContext): boolean {
  if (rule === "rental_cost") return canSeeRentalCosts(actor, context);
  if (rule === "lead_payload")
    return canSeeField(actor, "client_contact", context);
  if (rule === "duplicate_match") return clientScope(actor) === "all";
  // Catalog selling prices are public to staff; BEOs omit all pricing.
  if (rule === "pricing") return context.view !== "beo";
  // Notes about a staff member: FT+ only; being the person doesn't grant them.
  if (rule === "staff_notes") return isFtPlus(actor);
  return canSeeField(actor, rule as FieldGroup, context);
}
export const canSeeRentalCosts = (actor: Actor, context: ViewContext = {}) =>
  actor.role !== "staff" &&
  actor.role !== "kitchen_staff" &&
  canSeeField(actor, "internal_cost", context);
function project(
  actor: Actor,
  value: unknown,
  rule: Rule,
  context: ViewContext,
): unknown {
  if (typeof rule === "string")
    return visible(actor, rule, context) ? value : null;
  if (Array.isArray(value))
    return value.map((item) => project(actor, item, rule, context));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = { ...value };
  for (const [key, child] of Object.entries(rule)) {
    if (key in result)
      result[key] = project(actor, result[key], child, context);
  }
  return result;
}
export function serializeFields<T>(
  actor: Actor,
  shape: VisibilityShape,
  value: T,
  context: ViewContext = {},
): T {
  const result = project(actor, value, shapes[shape], context) as T;
  if (
    shape === "inventory_item" &&
    result &&
    typeof result === "object" &&
    "consumable" in result &&
    result.consumable
  ) {
    Object.assign(result.consumable, {
      costHidden: !canSeeField(actor, "internal_cost", context),
    });
  }
  return result;
}
export function redactFieldHistory(
  actor: Actor,
  shape: VisibilityShape,
  changes: Record<string, { before: unknown; after: unknown }>,
  context: ViewContext = {},
) {
  const rules: Record<string, Rule> = shapes[shape];
  return Object.fromEntries(
    Object.entries(changes).flatMap(([key, change]) => {
      const rule = rules[key];
      if (!rule) return [[key, change]];
      const masked = {
        before: project(actor, change.before, rule, context),
        after: project(actor, change.after, rule, context),
      };
      return JSON.stringify(masked.before) === JSON.stringify(masked.after)
        ? []
        : [[key, masked]];
    }),
  );
}

// Document builders pass named groups through the same rules as API records.
// BEO context suppresses every cost, total and payment even for Admin.
export function serializeFieldGroups<
  T extends Partial<Record<FieldGroup, unknown>>,
>(actor: Actor, groups: T, context: ViewContext = {}): T {
  return Object.fromEntries(
    Object.entries(groups).map(([group, value]) => [
      group,
      canSeeField(actor, group as FieldGroup, context) ? value : null,
    ]),
  ) as T;
}
