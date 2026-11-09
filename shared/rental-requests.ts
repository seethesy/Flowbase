import { z } from "zod";
import { id, localDate, text } from "./schema-primitives";

export const rentalRequestStatuses = ["draft", "sent", "confirmed", "received", "returned"] as const;
export const rentalRequestStatusSchema = z.enum(rentalRequestStatuses);
export const rentalRequestSettingsSchema = z.object({
  vendorId: id,
  status: rentalRequestStatusSchema,
  method: z.enum(["delivery", "pickup"]),
  details: text(1000),
});
export type RentalRequestSettings = z.infer<typeof rentalRequestSettingsSchema>;
export const rentalRequestUpdateSchema = rentalRequestSettingsSchema.omit({ vendorId: true });

export const rentalRequestSchema = rentalRequestSettingsSchema.extend({
  vendorName: z.string(),
  eventTitle: z.string(),
  eventDate: localDate,
  lines: z.array(z.object({
    itemId: id,
    name: z.string(),
    quantity: z.number(),
    from: localDate,
    through: localDate,
  })),
});
export type RentalRequest = z.infer<typeof rentalRequestSchema>;

export function groupRentalRequests(
  lines: readonly { vendorId: string; vendorName: string; itemId: string; name: string;
    quantity: number; from: string; through: string }[],
) {
  const groups = new Map<string, { vendorId: string; vendorName: string;
    lines: { itemId: string; name: string; quantity: number; from: string; through: string }[] }>();
  for (const line of lines) {
    let group = groups.get(line.vendorId);
    if (!group) {
      group = { vendorId: line.vendorId, vendorName: line.vendorName, lines: [] };
      groups.set(line.vendorId, group);
    }
    group.lines.push({ itemId: line.itemId, name: line.name, quantity: line.quantity,
      from: line.from, through: line.through });
  }
  return [...groups.values()];
}

export function rentalRequestText(request: RentalRequest) {
  return [
    `Rental request: ${request.vendorName}`,
    `Event: ${request.eventTitle} — ${request.eventDate}`,
    `${request.method === "delivery" ? "Delivery" : "Pickup"}: ${request.details || "Details to confirm"}`,
    ...request.lines.map((line) => `${line.quantity} × ${line.name} (${line.from}–${line.through})`),
  ].join("\n");
}
