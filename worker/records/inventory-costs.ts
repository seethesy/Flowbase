import { desc, eq } from "drizzle-orm";
import { isFtPlus, type Actor } from "../../shared/access";
import type { CostChange } from "../../shared/inventory";
import type { Db, DbLike } from "../db/client";
import { inventoryCostHistory } from "../db/schema";
import { forbidden } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { findItem } from "./inventory-items";

// ---- Costs (FLOW-83) ----

// Logs a unit-cost change and emits inventory_item.cost_changed in the caller's
// transaction, after the new cost is stored. Recipe costing (FLOW-94) recalculates
// every recipe using the item on that event. Receiving (FLOW-88) calls this with
// source "receiving".
export async function recordCostChange(
  tx: DbLike,
  actor: Actor,
  change: {
    itemId: string;
    previousCents: number | null;
    unitCostCents: number | null;
    source: CostChange["source"];
  },
) {
  const [row] = await tx
    .insert(inventoryCostHistory)
    .values({ ...change, createdBy: actor.userId, updatedBy: actor.userId })
    .returning({ id: inventoryCostHistory.id });
  await emitDomainEvent(tx, {
    name: "inventory_item.cost_changed",
    entityId: change.itemId,
    data: {
      costChangeId: row.id,
      previousCents: change.previousCents,
      unitCostCents: change.unitCostCents,
      source: change.source,
    },
  });
}

export async function listCostHistory(
  db: Db,
  actor: Actor,
  itemId: string,
): Promise<CostChange[]> {
  if (!isFtPlus(actor)) throw forbidden();
  await findItem(db, itemId);
  const rows = await db
    .select()
    .from(inventoryCostHistory)
    .where(eq(inventoryCostHistory.itemId, itemId))
    .orderBy(desc(inventoryCostHistory.createdAt))
    .limit(500);
  return rows.map((row) => ({
    id: row.id,
    previousCents: row.previousCents,
    unitCostCents: row.unitCostCents,
    source: row.source,
    changedBy: row.createdBy,
    changedAt: row.createdAt.toISOString(),
  }));
}
