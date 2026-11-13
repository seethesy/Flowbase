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

// What the expansion reads from an item. A full InventoryItem fits, and so does
// a row loaded for just this purpose (event planning, FLOW-134).
export type RequirementItem = {
  id: string;
  name: string;
  active: boolean;
  archivedAt?: string | null;
  service?: {
    includes: readonly { itemId: string; quantity: number; basis: string }[];
  } | null;
  rental?: {
    components: readonly { itemId: string; quantity: number }[];
  } | null;
};

function checkCounts(quantity: number, guests: number) {
  if (
    ![quantity, guests].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1_000_000,
    )
  )
    throw new Error("Enter a valid quantity and guest count.");
}

function findItem(items: readonly RequirementItem[], id: string) {
  const item = items.find((row) => row.id === id);
  if (!item || item.archivedAt || !item.active)
    throw new Error(`Item ${id} is unavailable.`);
  return item;
}

// Walks services and rental kits down to the items that are actually pulled,
// calling `leaf` with each one's count and the outermost rental kit it came
// through (null when it didn't come through a kit).
function walk(
  itemId: string,
  quantity: number,
  items: readonly RequirementItem[],
  guests: number,
  leaf: (id: string, count: number, kitId: string | null) => void,
) {
  checkCounts(quantity, guests);
  const expand = (id: string, count: number, path: Set<string>, kitId: string | null) => {
    const item = findItem(items, id);
    if (path.has(id)) throw new Error(`Kit cycle includes ${item.name}.`);
    const next = new Set(path).add(id);
    if (item.service) {
      for (const line of item.service.includes)
        expand(
          line.itemId,
          count * line.quantity * (line.basis === "per_guest" ? guests : 1),
          next,
          kitId,
        );
    } else if (item.rental?.components.length) {
      for (const line of item.rental.components)
        expand(line.itemId, count * line.quantity, next, kitId ?? id);
    } else leaf(id, count, kitId);
  };
  expand(itemId, quantity, new Set(), null);
}

const totalOf = (totals: Map<string, number>, key: string, count: number) => {
  const total = (totals.get(key) ?? 0) + count;
  if (!Number.isFinite(total) || total > 1_000_000)
    throw new Error("Requirement exceeds the supported quantity.");
  totals.set(key, total);
};
const rounded = (count: number) => Math.round(count * 10_000) / 10_000;

// Pure catalog calculation. Event planning persists reservations and movements
// separately; calculating requirements must never change stock.
export function itemRequirements(
  itemId: string,
  quantity: number,
  items: readonly RequirementItem[],
  guests: number,
) {
  const totals = new Map<string, number>();
  walk(itemId, quantity, items, guests, (id, count) => totalOf(totals, id, count));
  return [...totals].map(([id, count]) => ({ itemId: id, quantity: rounded(count) }));
}

// Like itemRequirements, but what comes through a rental kit stays apart and
// names the outermost kit, so a kit's parts are listed with the kit (FLOW-212).
export function kitRequirements(
  itemId: string,
  quantity: number,
  items: readonly RequirementItem[],
  guests: number,
) {
  const totals = new Map<string, number>();
  const keys = new Map<string, { itemId: string; kitId: string | null }>();
  walk(itemId, quantity, items, guests, (id, count, kitId) => {
    const key = `${kitId ?? ""}|${id}`;
    keys.set(key, { itemId: id, kitId });
    totalOf(totals, key, count);
  });
  return [...totals].map(([key, count]) => ({ ...keys.get(key)!, quantity: rounded(count) }));
}

// The rental items a service (or a rental) puts on hold: services are opened up,
// fixed and per-guest quantities applied, and a rental, kit or not, is held as
// itself (a kit's hold takes care of its parts). Consumables aren't held.
export function heldRentals(
  itemId: string,
  quantity: number,
  items: readonly (RequirementItem & { kind: string })[],
  guests: number,
) {
  checkCounts(quantity, guests);
  const totals = new Map<string, number>();
  const expand = (id: string, count: number, path: Set<string>) => {
    const item = findItem(items, id) as RequirementItem & { kind: string };
    if (path.has(id)) throw new Error(`Kit cycle includes ${item.name}.`);
    if (item.service) {
      const next = new Set(path).add(id);
      for (const line of item.service.includes)
        expand(line.itemId, count * line.quantity * (line.basis === "per_guest" ? guests : 1), next);
    } else if (item.kind === "rental") totalOf(totals, id, count);
  };
  expand(itemId, quantity, new Set());
  return [...totals].map(([id, count]) => ({ itemId: id, quantity: rounded(count) }));
}
