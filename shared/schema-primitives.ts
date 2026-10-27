import { z } from "zod";

// Zod primitives every schema shares (FLOW-191), so a rule means the same thing on
// every record and route. Messages are the ones the forms already show.
export const id = z.string().uuid();
export const text = (max: number) => z.string().trim().max(max);
export const timestamp = z.string().datetime();

// A real calendar date as "YYYY-MM-DD": 2026-02-31 is rejected, not rolled over.
export const isLocalDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
export const localDate = z.string().refine(isLocalDate, "Enter a date.");

// Empty is allowed; .min(1) or a required check belongs to the schema using it.
export const email = text(254).refine(
  (value) => value === "" || /^\S+@\S+\.\S+$/.test(value),
  "Enter a valid email address.",
);
