import type { Actor } from "./access";
import { eventStatusSchema, type EventStatus } from "./core-records";

// Event lifecycle (FLOW-56):
// inquiry → pitching → P creation → initial P sent → negotiation → closing →
// closed → preparation → finished | lost.
// The system moves an event along the forward chain automatically (A1); those
// moves are the only ones it may make. A person may override to any other status
// at any time, and only Admin or the event's salesperson may do that (A2).

const chain = eventStatusSchema.options.filter((status) => status !== "lost");

// Automatic moves: the next status in the chain, or Lost from any status before
// Finished. Finished and Lost are final for the system.
export function automaticNextStatuses(from: EventStatus): EventStatus[] {
  if (from === "finished" || from === "lost") return [];
  return [chain[chain.indexOf(from) + 1], "lost"];
}

export const isAutomaticTransition = (from: EventStatus, to: EventStatus) =>
  automaticNextStatuses(from).includes(to);

// Manual overrides: Admin on any event, a salesperson on an event assigned to them.
export const mayOverrideStatus = (
  actor: Actor,
  event: { assignedSalespersonId: string | null },
) =>
  actor.role === "admin" ||
  (actor.role === "salesperson" &&
    event.assignedSalespersonId === actor.userId);
