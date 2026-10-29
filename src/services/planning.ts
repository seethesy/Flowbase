import { z } from "zod";
import {
  itemAllocationSchema,
  requirementSchema,
  type RequirementsInput,
} from "../../shared/allocation";
import {
  availabilitySchema,
  conflictSchema,
  reservationSchema,
  type ConflictState,
  type ResolveInput,
} from "../../shared/reservations";
import { at, query, request } from "./core";

// Equipment holds (FLOW-76), conflicts (FLOW-77) and consumable requirements and
// allocations (FLOW-85).
export const planningApi = {
  holds: (eventId: string) =>
    request(reservationSchema.array(), at("events", eventId, "reservations")),
  placeHold: (eventId: string, input: { itemId: string; quantity: number }) =>
    request(reservationSchema, at("events", eventId, "reservations"), "POST", input),
  updateHold: (holdId: string, quantity: number) =>
    request(reservationSchema, at("reservations", holdId), "PATCH", { quantity }),
  removeHold: (holdId: string) =>
    request(z.unknown(), at("reservations", holdId), "DELETE"),
  eventConflicts: (eventId: string, state?: ConflictState) =>
    request(conflictSchema.array(), `${at("events", eventId, "conflicts")}${query({ state })}`),
  itemConflicts: (itemId: string, state?: ConflictState) =>
    request(
      conflictSchema.array(),
      `${at("inventory/items", itemId, "conflicts")}${query({ state })}`,
    ),
  resolve: (conflictId: string, input: ResolveInput) =>
    request(conflictSchema, at("reservation-conflicts", conflictId, "resolve"), "POST", input),
  availability: (itemId: string, from: string, to: string) =>
    request(
      availabilitySchema,
      `${at("inventory/items", itemId, "availability")}${query({ from, to })}`,
    ),
  requirements: (eventId: string) =>
    request(requirementSchema.array(), at("events", eventId, "requirements")),
  setRequirements: (eventId: string, input: RequirementsInput) =>
    request(requirementSchema.array(), at("events", eventId, "requirements"), "PUT", input),
  allocations: (itemId: string) =>
    request(itemAllocationSchema.array(), at("inventory/items", itemId, "allocations")),
};
