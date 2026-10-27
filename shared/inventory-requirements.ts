import type { InventoryItem } from "./inventory";
import type { BusinessDefaults } from "./settings";

export function effectiveRatio(
  item: Pick<InventoryItem, "ratio" | "category">,
  defaults: Pick<BusinessDefaults, "ratioDefaults">,
) {
  return (
    item.ratio ??
    defaults.ratioDefaults.find(
      (row) =>
        row.category.trim().toLowerCase() ===
        item.category.trim().toLowerCase(),
    ) ??
    null
  );
}

// Pure catalog calculation. Event planning persists reservations and movements
// separately; calculating requirements must never change stock.
export function itemRequirements(
  itemId: string,
  quantity: number,
  items: readonly InventoryItem[],
  guests: number,
) {
  if (
    ![quantity, guests].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1_000_000,
    )
  )
    throw new Error("Enter a valid quantity and guest count.");
  const totals = new Map<string, number>();
  const expand = (id: string, count: number, path: Set<string>) => {
    const item = items.find((row) => row.id === id);
    if (!item || item.archivedAt || !item.active)
      throw new Error(`Item ${id} is unavailable.`);
    if (path.has(id)) throw new Error(`Kit cycle includes ${item.name}.`);
    const next = new Set(path).add(id);
    if (item.service) {
      for (const line of item.service.includes)
        expand(
          line.itemId,
          count * line.quantity * (line.basis === "per_guest" ? guests : 1),
          next,
        );
    } else if (item.rental?.components.length) {
      for (const line of item.rental.components)
        expand(line.itemId, count * line.quantity, next);
    } else {
      const total = (totals.get(id) ?? 0) + count;
      if (!Number.isFinite(total) || total > 1_000_000)
        throw new Error("Requirement exceeds the supported quantity.");
      totals.set(id, total);
    }
  };
  expand(itemId, quantity, new Set());
  return [...totals].map(([id, count]) => ({
    itemId: id,
    quantity: Math.round(count * 10_000) / 10_000,
  }));
}
