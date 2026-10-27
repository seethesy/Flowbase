import type { InventoryItem } from "./inventory";
import { isLocalDate } from "./schema-primitives";

// Vendor (sub-rental) items (FLOW-75): rentals the business rents from a vendor
// and re-rents to clients. They're available on request, not owned stock, so they
// never cause an inventory conflict; reservations (FLOW-76) and conflict
// detection (FLOW-77) use these rules.

// The rental section that holds sub-rented items (FLOW-70).
export const VENDOR_SECTION = "Vendor";

type RentalItem = Pick<InventoryItem, "kind" | "rental">;
export const isSubRental = (item: RentalItem) =>
  item.kind === "rental" && Boolean(item.rental?.vendorId);

// Stock the business owns: everything outside the Vendor section.
export const ownedQuantity = (item: Pick<InventoryItem, "stock">) =>
  Math.round(
    item.stock
      .filter((level) => level.sectionName !== VENDOR_SECTION)
      .reduce((sum, level) => sum + level.quantity, 0) * 10_000,
  ) / 10_000;

// What's left of the item's owned stock after the given reservations, or
// "on_request" for a sub-rental. Reservations of other items, including vendor
// items, never reduce it (AC1).
export function ownedAvailability(
  item: RentalItem & Pick<InventoryItem, "id" | "stock">,
  reservations: readonly { itemId: string; quantity: number }[],
): number | "on_request" {
  if (isSubRental(item)) return "on_request";
  const reserved = reservations
    .filter((line) => line.itemId === item.id)
    .reduce((sum, line) => sum + line.quantity, 0);
  return Math.round((ownedQuantity(item) - reserved) * 10_000) / 10_000;
}

// Whole days from one calendar date to another ("YYYY-MM-DD").
export function daysBetween(from: string, to: string) {
  if (!isLocalDate(from) || !isLocalDate(to)) throw new Error("Enter a date.");
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
      86_400_000,
  );
}

export type LeadTimeWarning = {
  leadTimeDays: number;
  daysUntilEvent: number;
  message: string;
};
// AC2: a sub-rental needed sooner than its vendor's lead time is flagged. Dates
// are the business's calendar dates (America/New_York). An event already past
// has nothing to warn about.
export function leadTimeWarning(
  item: RentalItem,
  eventDate: string,
  today: string,
): LeadTimeWarning | null {
  const leadTimeDays = item.rental?.leadTimeDays ?? null;
  if (!isSubRental(item) || leadTimeDays === null) return null;
  const daysUntilEvent = daysBetween(today, eventDate);
  if (daysUntilEvent < 0 || daysUntilEvent >= leadTimeDays) return null;
  const vendor = item.rental?.vendorName ?? "The vendor";
  const notice = leadTimeDays === 1 ? "1 day's" : `${leadTimeDays} days'`;
  const away =
    daysUntilEvent === 0
      ? "today"
      : `${daysUntilEvent} day${daysUntilEvent === 1 ? "" : "s"} away`;
  return {
    leadTimeDays,
    daysUntilEvent,
    message: `${vendor} needs ${notice} notice; the event is ${away}.`,
  };
}
