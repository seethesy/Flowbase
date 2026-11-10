import { z } from "zod";
import { id, text, timestamp } from "./schema-primitives";

export const truckStatuses = ["available", "loading", "en_route", "at_event", "returning", "maintenance"] as const;
export const truckStatusSchema = z.enum(truckStatuses);
export const truckInputSchema = z.object({ name: text(100).min(1) });
export const truckAssignmentInputSchema = z.object({
  truckId: id,
  departsAt: timestamp,
  returnsAt: timestamp,
  driverId: id.nullable(),
  loaderIds: z.array(id).max(20),
  acknowledgeConflict: z.boolean().default(false),
}).refine((value) => Date.parse(value.returnsAt) > Date.parse(value.departsAt), {
  path: ["returnsAt"], message: "Return must be after departure.",
});
export type TruckAssignmentInput = z.infer<typeof truckAssignmentInputSchema>;
export const truckSchema = z.object({ id, name: z.string(), status: truckStatusSchema });
export const truckAssignmentSchema = z.object({
  id, truckId: id, truckName: z.string(), eventId: id, eventTitle: z.string(),
  departsAt: timestamp, returnsAt: timestamp, driverId: id.nullable(), driverName: z.string().nullable(),
  loaderIds: z.array(id), conflictAcknowledgedAt: timestamp.nullable(),
  conflictMessage: z.string().nullable(),
});
export const truckLogSchema = z.object({
  trucks: z.array(truckSchema), assignments: z.array(truckAssignmentSchema),
  missingDriverWarning: z.string().nullable(), canEdit: z.boolean(),
});
export type TruckLog = z.infer<typeof truckLogSchema>;
export const truckLineInputSchema = z.object({ truckId: id.nullable() });

export function busyWindowsOverlap(a: { departsAt: Date; returnsAt: Date }, b: { departsAt: Date; returnsAt: Date }) {
  return a.departsAt < b.returnsAt && b.departsAt < a.returnsAt;
}
export function truckConflictMessage(truck: string, event: string, time: string, other: string) {
  return `You are attempting to assign ${truck} to ${event} at ${time}. Possible conflict: ${truck} is already assigned to ${other}`;
}
