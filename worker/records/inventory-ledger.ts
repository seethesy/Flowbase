import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  barCountStep,
  countDifference,
  fitsCountStep,
  movementDirection,
  sectionKindFor,
  type InventoryItem,
  type MovementType,
  type StockMovement,
} from "../../shared/inventory";
import type { Db, DbLike } from "../db/client";
import {
  events,
  inventorySections,
  inventoryStock,
  stockMovements,
} from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { canCountItem, canMoveItem } from "../policy";
import {
  conflict,
  type CorrectionInput,
  type CountInput,
  type ItemRow,
  type MovementInput,
  round,
  type TransferInput,
} from "./inventory-common";
import { findItem, getItem } from "./inventory-items";
import { requireStockSection } from "./inventory-sections";

// ---- Stock ledger (FLOW-71) ----

export type Movement = {
  type: MovementType;
  // One signed change per section; a transfer has two.
  changes: { sectionId: string; quantity: number }[];
  reason: string;
  correctsId?: string | null;
  link?: { type: "event" | "order" | "import"; id: string } | null;
};

// The only way stock changes: appends the movements and updates every section's
// cached on-hand in the caller's transaction, so the cache always equals the sum of
// movements. Services never have stock (FLOW-69 AC2), and no section may go below
// zero. Returns the new movement ids, in the order of the changes.
export async function recordMovement(
  tx: DbLike,
  actor: Actor,
  item: Pick<ItemRow, "id" | "kind" | "archivedAt">,
  movement: Movement,
): Promise<string[]> {
  const sectionKind = sectionKindFor(item.kind);
  if (!sectionKind)
    throw conflict(
      "SERVICE_HAS_NO_STOCK",
      "Service items don't have stock, so they can't be moved or counted.",
    );
  if (item.archivedAt)
    throw conflict(
      "ITEM_ARCHIVED",
      "Restore the item before changing its stock.",
    );
  const sections = await Promise.all(
    movement.changes.map((change) =>
      requireStockSection(tx, change.sectionId, sectionKind),
    ),
  );
  const sectionIds = movement.changes.map((change) => change.sectionId);
  await tx
    .insert(inventoryStock)
    .values(sectionIds.map((sectionId) => ({ itemId: item.id, sectionId })))
    .onConflictDoNothing();
  const levels = await tx
    .select()
    .from(inventoryStock)
    .where(
      and(
        eq(inventoryStock.itemId, item.id),
        inArray(inventoryStock.sectionId, sectionIds),
      ),
    )
    .for("update");
  for (const [index, change] of movement.changes.entries()) {
    const level = levels.find((row) => row.sectionId === change.sectionId);
    const next = round((level?.quantity ?? 0) + change.quantity);
    if (next < 0)
      throw conflict(
        "INSUFFICIENT_STOCK",
        `${sections[index].name} only has ${level?.quantity ?? 0}.`,
      );
    await tx
      .update(inventoryStock)
      .set({ quantity: next, updatedBy: actor.userId })
      .where(
        and(
          eq(inventoryStock.itemId, item.id),
          eq(inventoryStock.sectionId, change.sectionId),
        ),
      );
  }
  const transferId = movement.type === "transfer" ? crypto.randomUUID() : null;
  const rows = await tx
    .insert(stockMovements)
    .values(
      movement.changes.map((change) => ({
        itemId: item.id,
        sectionId: change.sectionId,
        type: movement.type,
        quantity: round(change.quantity),
        reason: movement.reason,
        transferId,
        correctsId: movement.correctsId ?? null,
        linkType: movement.link?.type ?? null,
        linkId: movement.link?.id ?? null,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })),
    )
    .returning({ id: stockMovements.id });
  const ids = rows.map((row) => row.id);
  await emitDomainEvent(tx, {
    name: "stock.moved",
    entityId: item.id,
    data: { movementIds: ids, type: movement.type },
  });
  return ids;
}

export async function listMovements(
  db: Db,
  itemId: string,
): Promise<StockMovement[]> {
  await findItem(db, itemId);
  const rows = await db
    .select({ movement: stockMovements, sectionName: inventorySections.name })
    .from(stockMovements)
    .innerJoin(
      inventorySections,
      eq(stockMovements.sectionId, inventorySections.id),
    )
    .where(eq(stockMovements.itemId, itemId))
    .orderBy(desc(stockMovements.createdAt), asc(stockMovements.quantity))
    .limit(1000);
  return rows.map(({ movement: m, sectionName }) => ({
    id: m.id,
    itemId: m.itemId,
    sectionId: m.sectionId,
    sectionName,
    type: m.type,
    quantity: m.quantity,
    reason: m.reason,
    transferId: m.transferId,
    correctsId: m.correctsId,
    correctedBy: rows
      .filter((other) => other.movement.correctsId === m.id)
      .sort(
        (a, b) =>
          a.movement.createdAt.getTime() - b.movement.createdAt.getTime(),
      )
      .map((other) => other.movement.id),
    link: m.linkType && m.linkId ? { type: m.linkType, id: m.linkId } : null,
    createdBy: m.createdBy,
    createdAt: m.createdAt.toISOString(),
  }));
}

// FLOW-70 AC2: one transfer, both sections updated.
export async function transferStock(
  db: Db,
  actor: Actor,
  itemId: string,
  input: TransferInput,
): Promise<InventoryItem> {
  const item = await findItem(db, itemId);
  if (!canMoveItem(actor, item)) throw forbidden();
  await db.transaction((tx) =>
    recordMovement(tx, actor, item, {
      type: "transfer",
      changes: [
        { sectionId: input.fromSectionId, quantity: -input.quantity },
        { sectionId: input.toSectionId, quantity: input.quantity },
      ],
      reason: input.reason,
    }),
  );
  return getItem(db, actor, itemId);
}

// Records a counted quantity as a count movement for the difference (FLOW-82 AC1:
// counting 12 where the section holds 15 writes -3). A count that matches still
// writes a zero movement, so the ledger shows when it was counted.
export async function recordCount(
  tx: DbLike,
  actor: Actor,
  item: ItemRow,
  sectionId: string,
  counted: number,
  reason: string,
) {
  if (!canCountItem(actor, item)) throw forbidden();
  const step =
    item.kind === "consumable" && item.subtype === "bar"
      ? barCountStep(item.category)
      : null;
  if (!fitsCountStep(counted, step))
    throw new ApiError(
      400,
      "COUNT_STEP",
      step === 0.5
        ? "Count beer and wine to the nearest 0.5."
        : "Count liquor to the nearest 0.25.",
    );
  const [level] = await tx
    .select({ quantity: inventoryStock.quantity })
    .from(inventoryStock)
    .where(
      and(
        eq(inventoryStock.itemId, item.id),
        eq(inventoryStock.sectionId, sectionId),
      ),
    )
    .for("update");
  const difference = countDifference(counted, level?.quantity ?? 0);
  const [movementId] = await recordMovement(tx, actor, item, {
    type: "count",
    changes: [{ sectionId, quantity: difference }],
    reason,
  });
  return { movementId, difference };
}

export async function countStock(
  db: Db,
  actor: Actor,
  itemId: string,
  input: CountInput,
): Promise<InventoryItem> {
  const item = await findItem(db, itemId);
  await db.transaction((tx) =>
    recordCount(tx, actor, item, input.sectionId, input.quantity, input.reason),
  );
  return getItem(db, actor, itemId);
}

// Receipts, adjustments, damage or loss, usage, pulls and returns entered by hand.
export async function addMovement(
  db: Db,
  actor: Actor,
  itemId: string,
  input: MovementInput,
): Promise<InventoryItem> {
  const item = await findItem(db, itemId);
  if (!canMoveItem(actor, item)) throw forbidden();
  if (input.eventId) {
    const [event] = await db
      .select({ id: events.id })
      .from(events)
      .where(eq(events.id, input.eventId));
    if (!event) throw notFound("Event");
  }
  const direction = movementDirection[input.type];
  await db.transaction((tx) =>
    recordMovement(tx, actor, item, {
      type: input.type,
      changes: [
        {
          sectionId: input.sectionId,
          quantity:
            direction === 0 ? input.quantity : direction * input.quantity,
        },
      ],
      reason: input.reason,
      link: input.eventId ? { type: "event", id: input.eventId } : null,
    }),
  );
  return getItem(db, actor, itemId);
}

// FLOW-71 AC3: a correction is a new movement of the difference, linked to the
// original, which stays untouched. Corrections always point at the original, and
// a transfer is corrected by transferring back.
export async function correctMovement(
  db: Db,
  actor: Actor,
  movementId: string,
  input: CorrectionInput,
): Promise<StockMovement[]> {
  const [original] = await db
    .select()
    .from(stockMovements)
    .where(eq(stockMovements.id, movementId));
  if (!original) throw notFound("Movement");
  if (original.correctsId)
    throw conflict(
      "CORRECTS_A_CORRECTION",
      "Correct the original movement instead.",
    );
  if (original.type === "transfer")
    throw conflict(
      "TRANSFER_CORRECTION",
      "A transfer can't be corrected. Transfer the stock back instead.",
    );
  const direction = movementDirection[original.type];
  if (direction * input.quantity < 0)
    throw conflict(
      "WRONG_DIRECTION",
      direction > 0
        ? "This movement adds stock; enter what it should have added."
        : "This movement removes stock; enter what it should have removed as a negative number.",
    );
  const item = await findItem(db, original.itemId);
  if (!canMoveItem(actor, item)) throw forbidden();
  await db.transaction(async (tx) => {
    const [{ total }] = await tx
      .select({
        total: sql<string>`coalesce(sum(${stockMovements.quantity}), 0)`,
      })
      .from(stockMovements)
      .where(
        or(
          eq(stockMovements.id, original.id),
          eq(stockMovements.correctsId, original.id),
        ),
      );
    const difference = round(input.quantity - Number(total));
    if (difference === 0)
      throw conflict(
        "NO_CHANGE",
        "That's already what the movement adds up to.",
      );
    await recordMovement(tx, actor, item, {
      type: original.type,
      changes: [{ sectionId: original.sectionId, quantity: difference }],
      reason: input.reason,
      correctsId: original.id,
      link:
        original.linkType && original.linkId
          ? { type: original.linkType, id: original.linkId }
          : null,
    });
  });
  return listMovements(db, original.itemId);
}
