import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type {
  InventoryItem,
  StockCount,
  StockCountSummary,
} from "../../shared/inventory";
import type { Db, DbLike } from "../db/client";
import {
  inventoryConsumableDetails,
  inventoryItems,
  inventorySections,
  inventoryStock,
  stockCountLines,
  stockCounts,
  stockMovements,
} from "../db/schema";
import { notFound } from "../hono";
import { canCountItem } from "../policy";
import { conflict, type CountLineInput, round } from "./inventory-common";
import { findItem, toItems } from "./inventory-items";
import { recordCount } from "./inventory-ledger";
import { requireStockSection } from "./inventory-sections";
import { keyset, type Page, type PageRequest } from "./paging";

// ---- Count mode (FLOW-82) ----

type CountRow = typeof stockCounts.$inferSelect;

async function countedItems(db: DbLike, countIds: string[]) {
  if (!countIds.length) return new Map<string, number>();
  const rows = await db
    .select({
      countId: stockCountLines.countId,
      total: sql<number>`count(*)::int`,
    })
    .from(stockCountLines)
    .where(inArray(stockCountLines.countId, countIds))
    .groupBy(stockCountLines.countId);
  return new Map(rows.map((row) => [row.countId, row.total]));
}

async function toCountSummaries(
  db: DbLike,
  rows: { count: CountRow; sectionName: string }[],
): Promise<StockCountSummary[]> {
  const counted = await countedItems(
    db,
    rows.map(({ count }) => count.id),
  );
  return rows.map(({ count, sectionName }) => ({
    id: count.id,
    sectionId: count.sectionId,
    sectionName,
    status: count.status,
    countedItems: counted.get(count.id) ?? 0,
    startedBy: count.createdBy,
    startedAt: count.createdAt.toISOString(),
    completedAt: count.completedAt?.toISOString() ?? null,
  }));
}

const countQuery = (db: DbLike) =>
  db
    .select({ count: stockCounts, sectionName: inventorySections.name })
    .from(stockCounts)
    .innerJoin(
      inventorySections,
      eq(stockCounts.sectionId, inventorySections.id),
    );

export async function listCounts(
  db: Db,
  filter: { status?: CountRow["status"] },
  page: PageRequest = {},
): Promise<Page<StockCountSummary>> {
  type Row = { count: CountRow; sectionName: string };
  const paging = keyset<Row>(
    [
      { column: stockCounts.createdAt, type: "timestamp", desc: true, of: (row) => row.count.createdAt },
      { column: stockCounts.id, type: "uuid", desc: true, of: (row) => row.count.id },
    ],
    page,
  );
  const rows = await countQuery(db)
    .where(
      and(
        filter.status ? eq(stockCounts.status, filter.status) : undefined,
        paging.where,
      ),
    )
    .orderBy(...paging.orderBy)
    .limit(paging.limit);
  return paging.page(rows, (kept) => toCountSummaries(db, kept));
}

// Everything count mode shows: the section's consumables (kept there, holding
// stock there, or already counted) in storage order, with what the section holds
// and any count already saved, so a partial count resumes where it left off.
export async function getCount(
  db: DbLike,
  actor: Actor,
  id: string,
): Promise<StockCount> {
  const [row] = await countQuery(db).where(eq(stockCounts.id, id));
  if (!row) throw notFound("Count");
  const { count } = row;
  const [[summary], held, kept, lines] = await Promise.all([
    toCountSummaries(db, [row]),
    db
      .select({ itemId: inventoryStock.itemId })
      .from(inventoryStock)
      .where(
        and(
          eq(inventoryStock.sectionId, count.sectionId),
          ne(inventoryStock.quantity, 0),
        ),
      ),
    db
      .select({ itemId: inventoryConsumableDetails.itemId })
      .from(inventoryConsumableDetails)
      .where(eq(inventoryConsumableDetails.storageSectionId, count.sectionId)),
    db
      .select()
      .from(stockCountLines)
      .where(eq(stockCountLines.countId, count.id)),
  ]);
  const ids = [
    ...new Set([...held, ...kept, ...lines].map((line) => line.itemId)),
  ];
  const items = ids.length
    ? await toItems(
        db,
        actor,
        await db
          .select()
          .from(inventoryItems)
          .where(
            and(
              inArray(inventoryItems.id, ids),
              eq(inventoryItems.kind, "consumable"),
              isNull(inventoryItems.archivedAt),
            ),
          ),
      )
    : [];
  const movementIds = lines.map((line) => line.movementId);
  const differences = movementIds.length
    ? await db
        .select({ id: stockMovements.id, quantity: stockMovements.quantity })
        .from(stockMovements)
        .where(inArray(stockMovements.id, movementIds))
    : [];
  const order = (item: InventoryItem) =>
    item.consumable?.storageOrder ?? Number.MAX_SAFE_INTEGER;
  return {
    ...summary,
    lines: items
      .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
      .map((item) => {
        const line = lines.find((other) => other.itemId === item.id);
        return {
          itemId: item.id,
          name: item.name,
          code: item.code,
          subtype: item.subtype,
          category: item.category,
          unit: item.unit,
          storageOrder: item.consumable?.storageOrder ?? null,
          parLevel: item.consumable?.parLevel ?? null,
          belowPar: item.belowPar,
          systemQuantity:
            item.stock.find((level) => level.sectionId === count.sectionId)
              ?.quantity ?? 0,
          canCount: canCountItem(actor, item),
          counted: line
            ? {
                quantity: line.quantity,
                difference:
                  differences.find((other) => other.id === line.movementId)
                    ?.quantity ?? 0,
                reason: line.reason,
                countedBy: line.updatedBy,
                countedAt: line.updatedAt.toISOString(),
              }
            : null,
        };
      }),
  };
}

// Starts a count of a storage section, or returns the one already open there so it
// can be resumed.
export async function startCount(
  db: Db,
  actor: Actor,
  sectionId: string,
): Promise<{ count: StockCount; created: boolean }> {
  await requireStockSection(db, sectionId, "consumable");
  const [open] = await db
    .select({ id: stockCounts.id })
    .from(stockCounts)
    .where(
      and(eq(stockCounts.sectionId, sectionId), eq(stockCounts.status, "open")),
    );
  if (open)
    return { count: await getCount(db, actor, open.id), created: false };
  const [row] = await db
    .insert(stockCounts)
    .values({ sectionId, createdBy: actor.userId, updatedBy: actor.userId })
    .onConflictDoNothing()
    .returning({ id: stockCounts.id });
  // Someone else started one at the same moment: resume theirs.
  if (!row) return startCount(db, actor, sectionId);
  return { count: await getCount(db, actor, row.id), created: true };
}

async function findOpenCount(db: DbLike, id: string) {
  const [count] = await db
    .select()
    .from(stockCounts)
    .where(eq(stockCounts.id, id));
  if (!count) throw notFound("Count");
  if (count.status !== "open")
    throw conflict("COUNT_COMPLETED", "This count is already complete.");
  return count;
}

// Saves one item's counted quantity: a count movement for the difference, and the
// count's line for the item (a recount replaces the line and writes another
// movement).
export async function recordCountLine(
  db: Db,
  actor: Actor,
  countId: string,
  input: CountLineInput,
): Promise<StockCount> {
  const count = await findOpenCount(db, countId);
  const item = await findItem(db, input.itemId);
  if (item.kind !== "consumable")
    throw conflict(
      "NOT_CONSUMABLE",
      "Count mode is for consumables. Count rentals from the item page.",
    );
  await db.transaction(async (tx) => {
    const [lockedCount] = await tx.select().from(stockCounts)
      .where(eq(stockCounts.id, countId)).for("update");
    if (!lockedCount || lockedCount.status !== "open")
      throw conflict("COUNT_COMPLETED", "This count is already complete.");
    const { movementId } = await recordCount(
      tx,
      actor,
      item,
      lockedCount.sectionId,
      input.quantity,
      input.reason,
    );
    const values = {
      quantity: round(input.quantity),
      reason: input.reason,
      movementId,
      updatedBy: actor.userId,
    };
    await tx
      .insert(stockCountLines)
      .values({ countId, itemId: item.id, createdBy: actor.userId, ...values })
      .onConflictDoUpdate({
        target: [stockCountLines.countId, stockCountLines.itemId],
        set: { ...values, updatedAt: new Date() },
      });
  });
  return getCount(db, actor, countId);
}

export async function completeCount(
  db: Db,
  actor: Actor,
  countId: string,
): Promise<StockCount> {
  await findOpenCount(db, countId);
  await db
    .update(stockCounts)
    .set({
      status: "completed",
      completedAt: new Date(),
      updatedBy: actor.userId,
    })
    .where(and(eq(stockCounts.id, countId), eq(stockCounts.status, "open")));
  return getCount(db, actor, countId);
}
