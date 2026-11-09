import { z } from "zod";
import { id, isLocalDate, localDate, text, timestamp } from "./schema-primitives";
import { addLocalDays } from "./time";

// Payments (FLOW-131, FLOW-132, Q-37): what each client owes and has paid. Payments
// are taken outside Flowbase (Square, Zelle, ACH, wire, check or cash) and recorded
// by hand. Money is integer cents. No card numbers are ever stored (design
// principle 9). Only FT+ users who may see financials read any of it (F-01-04).

export const paymentMethods = ["card", "zelle", "ach", "wire", "check", "cash"] as const;
export const paymentMethodSchema = z.enum(paymentMethods);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;
export const paymentMethodLabels: Record<PaymentMethod, string> = {
  card: "Card (Square)",
  zelle: "Zelle",
  ach: "ACH",
  wire: "Wire",
  check: "Check",
  cash: "Cash",
};

export const scheduleKinds = ["deposit", "installment", "balance"] as const;
export const scheduleKindSchema = z.enum(scheduleKinds);
export type ScheduleKind = z.infer<typeof scheduleKindSchema>;
export const scheduleKindLabels: Record<ScheduleKind, string> = {
  deposit: "Deposit",
  installment: "Installment",
  balance: "Balance",
};

// Money columns are 32-bit integers; $20 million is far above any event.
export const MAX_PAYMENT_CENTS = 2_000_000_000;
const cents = z
  .number()
  .int("Enter an amount in dollars and cents.")
  .positive("Enter an amount above $0.")
  .max(MAX_PAYMENT_CENTS, "That amount is too large.");

// A reference that holds a run of 13 to 19 digits, with or without spaces or
// hyphens between them, looks like a full card number and is refused (AC2). Check
// numbers, confirmation codes and the last four digits are all shorter.
export function looksLikeCardNumber(value: string) {
  const compact = value.replace(/(\d)[\s-]+(?=\d)/g, "$1");
  return /\d{13,19}/.test(compact);
}
export const CARD_NUMBER_MESSAGE =
  "Don't enter a card number. Use the last 4 digits or a confirmation code.";

export const paymentInputSchema = z.object({
  method: paymentMethodSchema,
  amountCents: cents,
  // New York calendar date the money was received.
  receivedOn: localDate,
  reference: text(100)
    .default("")
    .refine((value) => !looksLikeCardNumber(value), CARD_NUMBER_MESSAGE),
  note: text(500).default(""),
});
export type PaymentInput = z.input<typeof paymentInputSchema>;

export const scheduleItemInputSchema = z.object({
  kind: scheduleKindSchema,
  label: text(100).default(""),
  amountCents: cents,
  dueDate: localDate,
  // Set when the item was added from a mapped proposal line (F-11-04), so the line
  // stops being suggested.
  source: z
    .object({ proposalId: id, sourceKey: text(200).min(1) })
    .nullable()
    .default(null),
});
export type ScheduleItemInput = z.input<typeof scheduleItemInputSchema>;

export const scheduleItemSchema = z.object({
  id,
  kind: scheduleKindSchema,
  label: z.string(),
  amountCents: z.number().int(),
  dueDate: z.string(),
  paidCents: z.number().int(),
  remainingCents: z.number().int(),
  // Past its due date with money still owed (FLOW-132 AC2).
  overdue: z.boolean(),
  fromProposal: z.boolean(),
});
export type ScheduleItem = z.infer<typeof scheduleItemSchema>;

const person = z.object({ id, name: z.string() });
export const paymentSchema = z.object({
  id,
  method: paymentMethodSchema,
  amountCents: z.number().int(),
  receivedOn: z.string(),
  reference: z.string(),
  note: z.string(),
  recordedBy: person.nullable(),
  recordedAt: timestamp,
});
export type Payment = z.infer<typeof paymentSchema>;

// A line of a mapped proposal's payment schedule (F-11-04) not yet added.
// kind/label/amount/date are read from the line where it has them; the person
// confirms or fills in the rest before it is saved.
export const paymentSuggestionSchema = z.object({
  proposalId: id,
  proposalTitle: z.string(),
  sourceKey: z.string(),
  text: z.string(),
  kind: scheduleKindSchema,
  label: z.string(),
  amountCents: z.number().int().nullable(),
  dueDate: z.string().nullable(),
});
export type PaymentSuggestion = z.infer<typeof paymentSuggestionSchema>;

export const eventPaymentsSchema = z.object({
  eventId: id,
  schedule: z.array(scheduleItemSchema),
  payments: z.array(paymentSchema),
  // The scheduled amounts added up, what has been received, and what is left.
  // A negative balance means the client has paid more than the schedule asks.
  totalCents: z.number().int(),
  paidCents: z.number().int(),
  balanceCents: z.number().int(),
  overdueCount: z.number().int(),
  overdueCents: z.number().int(),
  // Today's New York date, which overdue is measured against.
  today: z.string(),
  // Days before a due date the salesperson is reminded (business settings).
  reminderDays: z.number().int(),
  suggestions: z.array(paymentSuggestionSchema),
  canEdit: z.boolean(),
});
export type EventPayments = z.infer<typeof eventPaymentsSchema>;

export type ScheduleLike = { id: string; amountCents: number; dueDate: string };
export type AllocatedItem<T extends ScheduleLike> = T & {
  paidCents: number;
  remainingCents: number;
  overdue: boolean;
};

// Applies what has been received to the schedule, oldest due date first, so the
// deposit is covered before the balance. Payments aren't tied to one item: a
// client who pays $5,000 against a $1,500 deposit and a $3,500 balance has paid
// both. An item with money still owed and a due date before `today` is overdue
// (FLOW-132 AC2). `items` must already be in due-date order.
export function allocatePayments<T extends ScheduleLike>(
  items: T[],
  receivedCents: number,
  today: string,
): AllocatedItem<T>[] {
  let left = Math.max(receivedCents, 0);
  return items.map((item) => {
    const paidCents = Math.min(left, item.amountCents);
    left -= paidCents;
    const remainingCents = item.amountCents - paidCents;
    return {
      ...item,
      paidCents,
      remainingCents,
      overdue: remainingCents > 0 && item.dueDate < today,
    };
  });
}

export const byDueDate = <T extends { dueDate: string }>(a: T, b: T) =>
  a.dueDate.localeCompare(b.dueDate);

export function paymentTotals(
  items: ScheduleLike[],
  receivedCents: number,
  today: string,
) {
  const allocated = allocatePayments(
    [...items].sort(byDueDate),
    receivedCents,
    today,
  );
  const totalCents = items.reduce((sum, item) => sum + item.amountCents, 0);
  const overdue = allocated.filter((item) => item.overdue);
  return {
    allocated,
    totalCents,
    paidCents: receivedCents,
    balanceCents: totalCents - receivedCents,
    overdueCount: overdue.length,
    overdueCents: overdue.reduce((sum, item) => sum + item.remainingCents, 0),
  };
}

// Items to remind the salesperson about on `today`: money still owed, due from
// today up to `reminderDays` days ahead (FLOW-132 AC1). With the default of 3, an
// item due in 3 days is reminded today; one first seen at 1 day out still is.
export function dueForReminder<T extends AllocatedItem<ScheduleLike>>(
  items: T[],
  today: string,
  reminderDays: number,
): T[] {
  const until = addLocalDays(today, reminderDays);
  return items.filter(
    (item) =>
      item.remainingCents > 0 && item.dueDate >= today && item.dueDate <= until,
  );
}

const months = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];
const pad = (value: number) => String(value).padStart(2, "0");
const validDate = (year: number, month: number, day: number) => {
  const value = `${year}-${pad(month)}-${pad(day)}`;
  return isLocalDate(value) ? value : null;
};

// Reads what a mapped proposal's payment line says, e.g. "Deposit $1,500.00 due
// 11/20/2026". Anything it can't read stays null for the person to fill in. A
// convenience only: the schedule is saved from the confirmed form (no AI, ADR-16).
export function parsePaymentLine(line: string): {
  kind: ScheduleKind;
  label: string;
  amountCents: number | null;
  dueDate: string | null;
} {
  const trimmed = line.trim();
  const amount = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/.exec(trimmed);
  const parsed = amount ? Math.round(Number(amount[1].replaceAll(",", "")) * 100) : null;
  const amountCents =
    parsed !== null && parsed > 0 && parsed <= MAX_PAYMENT_CENTS ? parsed : null;
  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(trimmed);
  const us = /\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/.exec(trimmed);
  const named = new RegExp(
    String.raw`\b(${months.join("|")})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b`,
    "i",
  ).exec(trimmed);
  const dueDate = iso
    ? validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    : us
      ? validDate(
          us[3].length === 2 ? 2000 + Number(us[3]) : Number(us[3]),
          Number(us[1]),
          Number(us[2]),
        )
      : named
        ? validDate(
            Number(named[3]),
            months.indexOf(named[1].toLowerCase()) + 1,
            Number(named[2]),
          )
        : null;
  const kind: ScheduleKind = /deposit|retainer/i.test(trimmed)
    ? "deposit"
    : /balance|final/i.test(trimmed)
      ? "balance"
      : "installment";
  return { kind, label: trimmed.slice(0, 100), amountCents, dueDate };
}

export const formatCents = (value: number) =>
  `${value < 0 ? "-" : ""}$${(Math.abs(value) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// "$1,500" or "1500.50" typed in a form as cents; null when it isn't an amount.
export function dollarsToCents(value: string): number | null {
  const cleaned = value.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
