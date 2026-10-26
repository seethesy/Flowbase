import {
  barTierLabels,
  barTierSchema,
  type BarTier,
  type InventoryItem,
  type ItemKind,
} from "../../shared/inventory";
import { utcToBusinessTime } from "../../shared/time";
import { unitLabel, type Unit } from "../../shared/units";

// Display labels shared by the inventory screens (FLOW-193).
export const kindLabels: Record<ItemKind, string> = {
  rental: "Rental",
  consumable: "Consumable",
  service: "Service",
};
export const subtypeLabel = (subtype: string | null) =>
  subtype ? subtype[0].toUpperCase() + subtype.slice(1) : "";
export const quantityLabel = (quantity: number, unit: Unit) =>
  `${Number(quantity.toFixed(4))} ${unitLabel(unit)}`;
export const centsLabel = (cents: number | null) =>
  cents === null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(cents / 100);
export function purchaseLabel(consumable: InventoryItem["consumable"]) {
  if (!consumable) return "—";
  const size = consumable.eachSize
    ? `${Number(consumable.eachSize.quantity)} ${unitLabel(consumable.eachSize.unit)}`
    : "";
  if (consumable.purchaseUnit === "case")
    return `case of ${consumable.packCount ?? "?"}${size && ` × ${size}`}`;
  return `${unitLabel(consumable.purchaseUnit)}${size && ` (each ≈ ${size})`}`;
}
export const variantLabel = (item: InventoryItem) =>
  [item.group, item.tier, item.color].filter(Boolean).join(" · ");
export const dateTimeLabel = (iso: string) => {
  const { date, time } = utcToBusinessTime(new Date(iso));
  return `${date} ${time}`;
};
// A signed change, e.g. "+12" or "−3".
export const changeLabel = (quantity: number) =>
  `${quantity > 0 ? "+" : quantity < 0 ? "−" : "±"}${Number(Math.abs(quantity).toFixed(4))}`;
export const barTierLabel = (tier: string) =>
  barTierSchema.safeParse(tier).success ? barTierLabels[tier as BarTier] : tier;
