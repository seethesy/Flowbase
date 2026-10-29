import { z } from "zod";
import type { EventStatus } from "./core-records";
import { id, localDate, text, timestamp } from "./schema-primitives";
import { daysBetween } from "./sub-rentals";
import { addLocalDays } from "./time";

// Reservations (FLOW-76) and conflict detection (FLOW-77). A reservation is a
// hold: one rental item, a quantity and an event, over a window of calendar days
// (New York dates) that runs from the event's first day minus the item's buffer to
// its last day plus the buffer. The rules below are pure so the Worker and the
// screens share them; stock is read by the callers.

export const holdStatuses = ["tentative", "confirmed", "released"] as const;
export const holdStatusSchema = z.enum(holdStatuses);
export type HoldStatus = z.infer<typeof holdStatusSchema>;
export const holdStatusLabels: Record<HoldStatus, string> = {
  tentative: "Tentative",
  confirmed: "Confirmed",
  released: "Released",
};

// Used when an item has no buffer of its own (FLOW-72 stores one per rental).
export const DEFAULT_BUFFER_DAYS = 1;

// Inclusive calendar dates ("YYYY-MM-DD"), which compare correctly as strings.
export type HoldWindow = { start: string; end: string };

// The days an event occupies, widened by the item's buffers. A multi-day event, or
// one that runs past midnight, uses its full span (AC1).
export function holdWindow(
  event: { startDate: string; endDate: string },
  buffers: { before: number; after: number },
): HoldWindow {
  const endDate = event.endDate < event.startDate ? event.startDate : event.endDate;
  return {
    start: addLocalDays(event.startDate, -Math.max(0, buffers.before)),
    end: addLocalDays(endDate, Math.max(0, buffers.after)),
  };
}

export const windowsOverlap = (a: HoldWindow, b: HoldWindow) =>
  a.start <= b.end && b.start <= a.end;

// Every day of a window, in order.
export function windowDays(window: HoldWindow): string[] {
  const count = daysBetween(window.start, window.end);
  return Array.from({ length: Math.max(0, count) + 1 }, (_, index) =>
    addLocalDays(window.start, index),
  );
}

// A hold follows its event (FLOW-76): tentative until the event reaches Closed
// (paid and signed, FLOW-56 A2), confirmed from then on, released when it is Lost.
export function holdStatusForEvent(status: EventStatus): HoldStatus {
  if (status === "lost") return "released";
  if (status === "closed" || status === "preparation" || status === "finished")
    return "confirmed";
  return "tentative";
}

export type Hold = {
  id: string;
  eventId: string;
  itemId: string;
  quantity: number;
  status: HoldStatus;
  window: HoldWindow;
  // When the client signed the event's first DocuSign contract (FLOW-4); null
  // until then.
  bookedAt: string | null;
  // When the hold was entered; breaks ties between equal booking times.
  enteredAt: string;
};

const round = (value: number) => Math.round(value * 10_000) / 10_000;

// Booking order (FLOW-76, Q-44): the earlier booked_at keeps contested items. A
// hold with no booked_at ranks after every booked one. Equal booked_at values go
// to whichever hold was entered first; the id makes the order total.
type Rankable = { id: string; bookedAt: string | null; enteredAt: string };
export function bookingOrder(a: Rankable, b: Rankable): number {
  const booked = (hold: Rankable) =>
    hold.bookedAt === null ? Number.POSITIVE_INFINITY : Date.parse(hold.bookedAt);
  const byBooking = booked(a) === booked(b) ? 0 : booked(a) < booked(b) ? -1 : 1;
  if (byBooking) return byBooking;
  const byEntry = Date.parse(a.enteredAt) - Date.parse(b.enteredAt);
  if (byEntry) return byEntry < 0 ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// The most of an item in use on any single day of the window by the given holds.
// Holds that never overlap each other don't add up.
function peakUsage(
  window: HoldWindow,
  used: readonly { window: HoldWindow; quantity: number }[],
): number {
  const overlapping = used.filter((hold) => windowsOverlap(window, hold.window));
  if (!overlapping.length) return 0;
  let peak = 0;
  for (const day of windowDays(window)) {
    const total = overlapping
      .filter((hold) => hold.window.start <= day && day <= hold.window.end)
      .reduce((sum, hold) => sum + hold.quantity, 0);
    peak = Math.max(peak, total);
  }
  return round(peak);
}

export type Availability = {
  owned: number;
  // Owned minus the confirmed holds that overlap the window. Not clamped: a
  // negative figure means the confirmed holds already exceed what is owned.
  available: number;
  // The same, also counting tentative holds.
  availableWithTentative: number;
};

// Availability(item, window) = owned quantity − overlapping confirmed
// reservations, plus a second figure that includes tentative holds. Where the
// overlapping holds don't all overlap each other, the busiest day counts. A
// sub-rental is available on request instead (shared/sub-rentals.ts).
export function availability(
  owned: number,
  window: HoldWindow,
  holds: readonly Hold[],
): Availability {
  const live = holds.filter((hold) => hold.status !== "released");
  const confirmed = live.filter((hold) => hold.status === "confirmed");
  return {
    owned: round(owned),
    available: round(owned - peakUsage(window, confirmed)),
    availableWithTentative: round(owned - peakUsage(window, live)),
  };
}

// conflict: overcommitment involving a confirmed hold. warning: overcommitment
// among tentative holds only (FLOW-77).
export const issueKinds = ["conflict", "warning"] as const;
export const issueKindSchema = z.enum(issueKinds);
export type IssueKind = z.infer<typeof issueKindSchema>;

export type HoldAllocation = {
  holdId: string;
  eventId: string;
  itemId: string;
  status: HoldStatus;
  quantity: number;
  // What the hold actually gets once earlier-booked holds have taken their share.
  allocated: number;
  shortfall: number;
  // The later-booked hold carries the issue. Null when nothing is short.
  kind: IssueKind | null;
};

// Shares an item's owned stock between its holds in booking order: confirmed
// holds first, then tentative ones, each in booking order. A hold gets what is
// left on its busiest day after the holds ahead of it (AC3: 100 plates, A books
// 80 first and B 60 later → A gets 80, B gets 20 and is 40 short). A short
// confirmed hold, or a short tentative one that confirmed holds alone would also
// leave short, is a conflict; a tentative hold that is short only because of
// other tentative holds is a warning.
export function allocateHolds(
  owned: number,
  holds: readonly Hold[],
): HoldAllocation[] {
  const live = holds.filter((hold) => hold.status !== "released");
  const ordered = [
    ...live.filter((hold) => hold.status === "confirmed").sort(bookingOrder),
    ...live.filter((hold) => hold.status === "tentative").sort(bookingOrder),
  ];
  const placed: { window: HoldWindow; quantity: number }[] = [];
  const placedConfirmed: { window: HoldWindow; quantity: number }[] = [];
  return ordered.map((hold) => {
    const room = Math.max(0, owned - peakUsage(hold.window, placed));
    const allocated = round(Math.min(hold.quantity, room));
    placed.push({ window: hold.window, quantity: allocated });
    if (hold.status === "confirmed")
      placedConfirmed.push({ window: hold.window, quantity: allocated });
    const shortfall = round(hold.quantity - allocated);
    let kind: IssueKind | null = null;
    if (shortfall > 0) {
      const roomWithoutTentative = Math.max(
        0,
        owned - peakUsage(hold.window, placedConfirmed),
      );
      kind =
        hold.status === "confirmed" || roomWithoutTentative < hold.quantity
          ? "conflict"
          : "warning";
    }
    return {
      holdId: hold.id,
      eventId: hold.eventId,
      itemId: hold.itemId,
      status: hold.status,
      quantity: hold.quantity,
      allocated,
      shortfall,
      kind,
    };
  });
}

// What changed about a hold's situation; notifications repeat only when it does
// (FLOW-77 AC1).
export const issueSignature = (
  allocation: Pick<HoldAllocation, "kind" | "quantity" | "allocated" | "shortfall">,
) =>
  `${allocation.kind}:${allocation.quantity}:${allocation.allocated}:${allocation.shortfall}`;

// --- API shapes -------------------------------------------------------------

const quantityField = z
  .number()
  .positive("Enter a quantity above zero.")
  .max(1_000_000);

// POST /api/events/<id>/reservations: holds the quantity for the event, replacing
// the quantity of its existing hold on that item.
export const reservationInputSchema = z.object({
  itemId: id,
  quantity: quantityField,
});
export type ReservationInput = z.input<typeof reservationInputSchema>;
// PATCH /api/reservations/<id>
export const reservationUpdateSchema = z.object({ quantity: quantityField });

export const reservationSchema = z.object({
  id,
  eventId: id,
  // null when the viewer can't open the event.
  eventTitle: z.string().nullable(),
  eventDate: localDate.nullable(),
  itemId: id,
  itemName: z.string(),
  quantity: z.number(),
  status: holdStatusSchema,
  windowStart: localDate,
  windowEnd: localDate,
  bookedAt: timestamp.nullable(),
  allocated: z.number(),
  shortfall: z.number(),
  issue: issueKindSchema.nullable(),
});
export type Reservation = z.infer<typeof reservationSchema>;

export const availabilitySchema = z.object({
  itemId: id,
  from: localDate,
  to: localDate,
  // A vendor item is available on request, so it never runs short.
  onRequest: z.boolean(),
  owned: z.number(),
  available: z.number().nullable(),
  availableWithTentative: z.number().nullable(),
  holds: z.array(reservationSchema),
});
export type ItemAvailability = z.infer<typeof availabilitySchema>;

// --- Conflicts ---------------------------------------------------------------

export const conflictStates = ["open", "accepted", "resolved"] as const;
export const conflictStateSchema = z.enum(conflictStates);
export type ConflictState = z.infer<typeof conflictStateSchema>;
export const conflictStateLabels: Record<ConflictState, string> = {
  open: "Open",
  accepted: "Risk accepted",
  resolved: "Resolved",
};

export const resolutionMethods = [
  "substitute",
  "sub_rent",
  "adjust",
  "accept_risk",
  // The situation cleared by itself: stock arrived, another hold was released, …
  "cleared",
] as const;
export const resolutionMethodSchema = z.enum(resolutionMethods);
export type ResolutionMethod = z.infer<typeof resolutionMethodSchema>;
export const resolutionMethodLabels: Record<ResolutionMethod, string> = {
  substitute: "Substituted another item",
  sub_rent: "Sub-rented from a vendor",
  adjust: "Adjusted the quantity",
  accept_risk: "Accepted the risk",
  cleared: "Cleared on its own",
};

export const conflictResolutionSchema = z.object({
  method: resolutionMethodSchema,
  // The item the shortfall moved to (substitute, sub_rent).
  itemId: id.nullable().default(null),
  itemName: z.string().nullable().default(null),
  // How much moved, or the new quantity (adjust).
  quantity: z.number().nullable().default(null),
  note: z.string().default(""),
});
export type ConflictResolution = z.infer<typeof conflictResolutionSchema>;

export const conflictSchema = z.object({
  id,
  reservationId: id,
  itemId: id,
  itemName: z.string(),
  eventId: id,
  eventTitle: z.string().nullable(),
  eventDate: localDate.nullable(),
  kind: issueKindSchema,
  state: conflictStateSchema,
  quantity: z.number(),
  allocated: z.number(),
  shortfall: z.number(),
  openedAt: timestamp,
  resolution: conflictResolutionSchema.nullable(),
  resolvedBy: id.nullable(),
  resolvedAt: timestamp.nullable(),
});
export type Conflict = z.infer<typeof conflictSchema>;

// POST /api/conflicts/<id>/resolve (FLOW-77): the four ways out.
export const resolveInputSchema = z.discriminatedUnion("method", [
  // Moves the short quantity to another rental item.
  z.object({
    method: z.literal("substitute"),
    itemId: id,
    note: text(1000).default(""),
  }),
  // Moves it to a vendor item (FLOW-75), which is available on request.
  z.object({
    method: z.literal("sub_rent"),
    itemId: id,
    note: text(1000).default(""),
  }),
  // Lowers the held quantity to a new figure below the current one.
  z.object({
    method: z.literal("adjust"),
    quantity: z.number().positive("Enter a quantity above zero.").max(1_000_000),
    note: text(1000).default(""),
  }),
  z.object({
    method: z.literal("accept_risk"),
    note: text(1000).min(1, "Say why the risk is accepted."),
  }),
]);
export type ResolveInput = z.input<typeof resolveInputSchema>;
