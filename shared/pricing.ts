import { z } from "zod";

// Sales › Pricing (FLOW-329): the price list salespeople quote from. The Admin
// keeps it on the tab: packages, per-guest rates, minimums and fees. Prices are
// cents; a percent fee keeps hundredths of a percent in `amount` (1800 = 18%).

export const priceCategories = ["package", "per_guest_rate", "minimum", "fee"] as const;
export const priceCategorySchema = z.enum(priceCategories);
export type PriceCategory = z.infer<typeof priceCategorySchema>;
export const priceCategoryLabels: Record<PriceCategory, string> = {
  package: "Packages",
  per_guest_rate: "Per-guest rates",
  minimum: "Minimums",
  fee: "Fees",
};

// What the amount is charged per. "percent" is a share of the event total.
export const priceBases = ["per_event", "per_guest", "per_hour", "per_item", "percent"] as const;
export const priceBasisSchema = z.enum(priceBases);
export type PriceBasis = z.infer<typeof priceBasisSchema>;
export const priceBasisLabels: Record<PriceBasis, string> = {
  per_event: "per event",
  per_guest: "per guest",
  per_hour: "per hour",
  per_item: "per item",
  percent: "of the event total",
};

export const priceInputSchema = z.object({
  name: z.string().trim().min(1, "Enter a name.").max(200),
  category: priceCategorySchema,
  basis: priceBasisSchema,
  amount: z.number().int().min(0, "Enter an amount of zero or more.").max(1_000_000_000),
  description: z.string().trim().max(2000).default(""),
});
export type PriceInput = z.input<typeof priceInputSchema>;

export const priceItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  category: priceCategorySchema,
  basis: priceBasisSchema,
  amount: z.number().int(),
  description: z.string(),
  archivedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type PriceItem = z.infer<typeof priceItemSchema>;

// "$1,250.00 per event", "18% of the event total".
export function formatPrice(item: Pick<PriceItem, "amount" | "basis">): string {
  if (item.basis === "percent") {
    const percent = (item.amount / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
    return `${percent}% ${priceBasisLabels.percent}`;
  }
  const dollars = (item.amount / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return `${dollars} ${priceBasisLabels[item.basis]}`;
}

// The list in the tab's order: by category, then name.
export function groupPrices(items: readonly PriceItem[]) {
  return priceCategories
    .map((category) => ({
      category,
      items: items
        .filter((item) => item.category === category)
        .sort((a, b) => a.name.localeCompare(b.name, "en-US", { sensitivity: "base" })),
    }))
    .filter((group) => group.items.length > 0);
}
