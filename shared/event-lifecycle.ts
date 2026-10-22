import type { Actor } from "./access";
import type { EventStatus } from "./core-records";

// Event lifecycle (FLOW-56, Epic FLOW-4):
// inquiry → proposing → tentative → booked → planning → in_progress → completed →
// closed | cancelled. Shared by the API, which enforces it, and the app, which
// offers only the moves the user may make.

// The people on an event that a rule can refer to.
export type EventPeople = {
  assignedSalespersonId: string | null;
  productionLeadId: string | null;
};
type Rule = (actor: Actor, event: EventPeople) => boolean;

const managers: Rule = (actor) =>
  actor.role === "sales_manager" || actor.role === "technical";
const sales: Rule = (actor, event) =>
  managers(actor, event) ||
  (actor.role === "salesperson" &&
    event.assignedSalespersonId === actor.userId);
const production: Rule = (actor, event) =>
  sales(actor, event) || event.productionLeadId === actor.userId;
const closing: Rule = (actor) => actor.role === "sales_manager";

// Every allowed move and who besides Admin may make it. Anything missing is invalid.
export const eventTransitions: Record<
  EventStatus,
  Partial<Record<EventStatus, Rule>>
> = {
  inquiry: { proposing: sales, cancelled: sales },
  proposing: { tentative: sales, cancelled: sales },
  tentative: { booked: sales, cancelled: sales },
  booked: { planning: sales, cancelled: sales },
  planning: { in_progress: production, cancelled: sales },
  in_progress: { completed: production, cancelled: sales },
  completed: { closed: closing },
  closed: {},
  cancelled: {},
};

// Statuses an event may start in when it's created.
export const initialEventStatuses: EventStatus[] = [
  "inquiry",
  "tentative",
  "booked",
];

// Moves that must say why.
export const reasonRequired: EventStatus[] = ["cancelled"];

export const isAllowedTransition = (from: EventStatus, to: EventStatus) =>
  Boolean(eventTransitions[from][to]);

export const mayTransition = (
  actor: Actor,
  event: EventPeople & { status: EventStatus },
  to: EventStatus,
) => {
  const rule = eventTransitions[event.status][to];
  if (!rule) return false;
  return actor.role === "admin" || rule(actor, event);
};

// The statuses this actor may move the event to, in lifecycle order.
export const nextStatuses = (
  actor: Actor,
  event: EventPeople & { status: EventStatus },
) =>
  (Object.keys(eventTransitions[event.status]) as EventStatus[]).filter((to) =>
    mayTransition(actor, event, to),
  );
