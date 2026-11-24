import { asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../../shared/access";
import type { PriceItem, priceInputSchema } from "../../../shared/pricing";
import { writeAudit } from "../../audit/log";
import type { Db, DbLike } from "../../db/client";
import { priceListItems } from "../../db/schema";
import { notFound } from "../../hono";
import { setArchived } from "../settings/archive";

// Sales › Pricing (FLOW-329): the Admin's price list. Roles that read proposals
// read it; only the Admin (settings.manage) changes it. Each change is audited.
type PriceRow = typeof priceListItems.$inferSelect;
type PriceInput = z.output<typeof priceInputSchema>;

const toPrice = (row: PriceRow): PriceItem => ({
  id: row.id,
  name: row.name,
  category: row.category,
  basis: row.basis,
  amount: row.amount,
  description: row.description,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  updatedAt: row.updatedAt.toISOString(),
});

// The live price list. It is short (tens of rows), so it is not paged.
export async function listPrices(db: DbLike): Promise<PriceItem[]> {
  const rows = await db
    .select()
    .from(priceListItems)
    .where(isNull(priceListItems.archivedAt))
    .orderBy(asc(priceListItems.category), asc(priceListItems.name), asc(priceListItems.id));
  return rows.map(toPrice);
}

async function findPrice(db: DbLike, id: string): Promise<PriceItem> {
  const [row] = await db.select().from(priceListItems).where(eq(priceListItems.id, id));
  if (!row) throw notFound("Price");
  return toPrice(row);
}

const values = (input: PriceInput, actor: Actor) => ({
  name: input.name,
  category: input.category,
  basis: input.basis,
  amount: input.amount,
  description: input.description,
  updatedBy: actor.userId,
});

export async function createPrice(db: Db, actor: Actor, input: PriceInput): Promise<PriceItem> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(priceListItems)
      .values({ ...values(input, actor), createdBy: actor.userId })
      .returning();
    const price = toPrice(row);
    await writeAudit(tx, actor, { entityType: "price_list_item", entityId: row.id, action: "create", before: null, after: price });
    return price;
  });
}

export async function updatePrice(db: Db, actor: Actor, id: string, input: PriceInput): Promise<PriceItem> {
  return db.transaction(async (tx) => {
    const before = await findPrice(tx, id);
    const [row] = await tx.update(priceListItems).set(values(input, actor)).where(eq(priceListItems.id, id)).returning();
    const after = toPrice(row);
    await writeAudit(tx, actor, { entityType: "price_list_item", entityId: id, action: "update", before, after });
    return after;
  });
}

export async function setPriceArchived(db: Db, actor: Actor, id: string, archived: boolean): Promise<PriceItem> {
  await findPrice(db, id);
  await setArchived(db, actor, id, archived, {
    update: (tx, change) => tx.update(priceListItems).set(change).where(eq(priceListItems.id, id)),
    audit: { entityType: "price_list_item", snapshot: findPrice },
  });
  return findPrice(db, id);
}
