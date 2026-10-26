import type { z } from "zod";
import type {
  correctionInputSchema,
  countInputSchema,
  countLineInputSchema,
  movementInputSchema,
  sectionInputSchema,
  transferInputSchema,
} from "../../shared/inventory";
import { inventoryItems, inventorySections } from "../db/schema";
import { ApiError } from "../hono";

// Types and helpers shared by the inventory record files (FLOW-193).
export type ItemRow = typeof inventoryItems.$inferSelect;
export type SectionRow = typeof inventorySections.$inferSelect;
export type TransferInput = z.output<typeof transferInputSchema>;
export type CountInput = z.output<typeof countInputSchema>;
export type CountLineInput = z.output<typeof countLineInputSchema>;
export type MovementInput = z.output<typeof movementInputSchema>;
export type CorrectionInput = z.output<typeof correctionInputSchema>;
export type SectionInput = z.output<typeof sectionInputSchema>;

// Four decimal places, as stored; keeps 0.1 + 0.2 from drifting.
export const round = (value: number) => Math.round(value * 10_000) / 10_000;

export const conflict = (code: string, message: string) =>
  new ApiError(409, code, message);
