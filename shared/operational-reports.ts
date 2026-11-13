import { z } from "zod";
import { id } from "./schema-primitives";

export const operationalReportSchema = z.object({
  rentals: z.array(z.object({ itemId: id, name: z.string(), reservations: z.number().int(), quantity: z.number() })),
  orders: z.array(z.object({ vendor: z.string(), month: z.string(), orders: z.number().int(), spendCents: z.number().int() })),
});
export type OperationalReport = z.infer<typeof operationalReportSchema>;
