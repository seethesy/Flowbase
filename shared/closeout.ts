import { z } from "zod";
import { id, text, timestamp } from "./schema-primitives";
import { pullGroupSchema } from "./pull-list";
import { rentalRequestStatusSchema } from "./rental-requests";

// Post-event closeout and returns (FLOW-157). One closeout per event, submitted
// once the event is over: it checks the pulled items back in, records consumables
// used and left over, marks sub-rented items returned to their vendors and moves
// the event to Finished.

const count = z.number().finite().min(0).max(1_000_000);

// What came back of one pull-list line. Equipment (rentals) is accounted for in
// full: returned + damaged + missing = the quantity pulled. A consumable line
// records only how many were used; the rest is left over and goes back to stock.
export const closeoutLineInputSchema = z.object({
  lineId: id,
  returned: count.default(0),
  damaged: count.default(0),
  missing: count.default(0),
  used: count.default(0),
});
export type CloseoutLineInput = z.input<typeof closeoutLineInputSchema>;

export const closeoutSubRentalInputSchema = z.object({
  vendorId: id,
  // Final notes for the vendor's return (condition, who dropped it off).
  notes: text(1000).default(""),
});
export type CloseoutSubRentalInput = z.input<typeof closeoutSubRentalInputSchema>;

export const closeoutInputSchema = z.object({
  lines: z.array(closeoutLineInputSchema).max(2000),
  subRentals: z.array(closeoutSubRentalInputSchema).max(100).default([]),
  notes: text(4000).default(""),
});
export type CloseoutInput = z.input<typeof closeoutInputSchema>;

export const closeoutLineSchema = z.object({
  lineId: id,
  itemId: id.nullable(),
  name: z.string(),
  group: pullGroupSchema,
  consumable: z.boolean(),
  // Null while the line has no quantity yet.
  pulled: z.number().nullable(),
  // Filled in once the event is closed out.
  returned: z.number().nullable(),
  damaged: z.number().nullable(),
  missing: z.number().nullable(),
  used: z.number().nullable(),
  leftover: z.number().nullable(),
});
export type CloseoutLine = z.infer<typeof closeoutLineSchema>;

export const closeoutSubRentalSchema = z.object({
  vendorId: id,
  vendorName: z.string(),
  status: rentalRequestStatusSchema,
  notes: z.string(),
});
export type CloseoutSubRental = z.infer<typeof closeoutSubRentalSchema>;

export const closeoutSchema = z.object({
  eventId: id,
  // True once the closeout was submitted.
  closedOut: z.boolean(),
  closedAt: timestamp.nullable(),
  closedByName: z.string().nullable(),
  notes: z.string(),
  lines: z.array(closeoutLineSchema),
  subRentals: z.array(closeoutSubRentalSchema),
  // The viewer may submit it, and the event is in a status that allows it.
  canClose: z.boolean(),
});
export type Closeout = z.infer<typeof closeoutSchema>;

// The checks both sides run on one line's counts; returns a message or null.
export function closeoutLineProblem(
  line: { consumable: boolean; pulled: number | null; name: string },
  input: { returned: number; damaged: number; missing: number; used: number },
): string | null {
  if (line.pulled === null) return `${line.name} has no quantity yet.`;
  if (line.consumable) {
    if (input.used > line.pulled)
      return `${line.name}: used ${input.used}, but only ${line.pulled} were pulled.`;
    return null;
  }
  const total = input.returned + input.damaged + input.missing;
  if (Math.abs(total - line.pulled) > 1e-9)
    return `${line.name}: returned, damaged and missing add up to ${total}, but ${line.pulled} were pulled.`;
  return null;
}
