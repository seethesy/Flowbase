import {
  canSeeField,
  redactFieldHistory,
  serializeFields,
} from "../../shared/visibility";
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import type {
  Vendor,
  VendorDetail,
  VendorItem,
  VendorType,
  vendorFieldsSchema,
  Weekday,
} from "../../shared/vendors";
import { fullView, listHistoryPage, writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import {
  inventoryConsumableDetails,
  inventoryItems,
  inventoryRentalDetails,
  vendorContacts,
  vendors,
} from "../db/schema";
import { forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { setArchived } from "./archive";
import { conflict } from "./inventory-common";
import { keyset, type Page, type PageRequest } from "./paging";
import { syncChildren } from "./sync";

// Vendor and distributor directory (FLOW-84). Every signed-in user reads it;
// inventory.write edits it. Contacts and the account number are FT+ only: hidden
// from part-time users, who also can't change them. No portal password is ever
// stored; the input schema refuses any field named like one.
type VendorRow = typeof vendors.$inferSelect;
type VendorInput = z.output<typeof vendorFieldsSchema>;

async function toVendors(db: DbLike, actor: Actor, rows: VendorRow[]) {
  if (!rows.length) return [];
  const contacts = canSeeField(actor, "vendor_contact")
    ? await db
        .select()
        .from(vendorContacts)
        .where(
          and(
            inArray(
              vendorContacts.vendorId,
              rows.map((row) => row.id),
            ),
            isNull(vendorContacts.archivedAt),
          ),
        )
        .orderBy(asc(vendorContacts.sortOrder))
    : [];
  return rows.map((row): Vendor =>
    serializeFields<Vendor>(actor, "vendor", {
      id: row.id,
      name: row.name,
      type: row.type,
      portalUrl: row.portalUrl,
      accountNumber: row.accountNumber,
      contacts: contacts
        .filter((contact) => contact.vendorId === row.id)
        .map(({ id, name, role, email, phone }) => ({
          id,
          name,
          role,
          email,
          phone,
        })),
      orderCutoff: row.orderCutoff,
      deliveryDays: row.deliveryDays as Weekday[],
      minimumOrderCents: row.minimumOrderCents,
      leadTimeDays: row.leadTimeDays,
      orderingInstructions: row.orderingInstructions,
      notes: row.notes,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

export async function listVendors(
  db: Db,
  actor: Actor,
  filter: { archived?: boolean; search?: string; type?: VendorType },
  page: PageRequest = {},
): Promise<Page<Vendor>> {
  const paging = keyset<VendorRow>(
    [
      { column: vendors.name, type: "text", of: (row) => row.name },
      { column: vendors.id, type: "uuid", of: (row) => row.id },
    ],
    page,
  );
  const term = filter.search ? `%${filter.search}%` : undefined;
  const rows = await db
    .select()
    .from(vendors)
    .where(
      and(
        filter.archived
          ? isNotNull(vendors.archivedAt)
          : isNull(vendors.archivedAt),
        filter.type ? eq(vendors.type, filter.type) : undefined,
        term
          ? or(ilike(vendors.name, term), ilike(vendors.notes, term))
          : undefined,
        paging.where,
      ),
    )
    .orderBy(...paging.orderBy)
    .limit(paging.limit);
  return paging.page(rows, (kept) => toVendors(db, actor, kept));
}

export async function findVendor(db: DbLike, id: string) {
  const [row] = await db.select().from(vendors).where(eq(vendors.id, id));
  if (!row) throw notFound("Vendor");
  return row;
}

// AC2: what the vendor supplies. Consumables they're the preferred vendor for and
// rentals sub-rented from them (FLOW-75), live items only, by name.
export async function vendorItems(
  db: DbLike,
  vendorId: string,
): Promise<VendorItem[]> {
  const rows = await db
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      code: inventoryItems.code,
      kind: inventoryItems.kind,
      subtype: inventoryItems.subtype,
      subRental: sql<boolean>`${inventoryRentalDetails.vendorId} is not null`,
    })
    .from(inventoryItems)
    .leftJoin(
      inventoryRentalDetails,
      and(
        eq(inventoryRentalDetails.itemId, inventoryItems.id),
        eq(inventoryRentalDetails.vendorId, vendorId),
      ),
    )
    .leftJoin(
      inventoryConsumableDetails,
      and(
        eq(inventoryConsumableDetails.itemId, inventoryItems.id),
        eq(inventoryConsumableDetails.preferredVendorId, vendorId),
      ),
    )
    .where(
      and(
        isNull(inventoryItems.archivedAt),
        or(
          isNotNull(inventoryRentalDetails.itemId),
          isNotNull(inventoryConsumableDetails.itemId),
        ),
      ),
    )
    .orderBy(asc(inventoryItems.name), asc(inventoryItems.id));
  return rows.map(({ subRental, ...item }) => ({
    ...item,
    relation: subRental ? ("sub_rental" as const) : ("supplies" as const),
  }));
}

export async function getVendor(
  db: DbLike,
  actor: Actor,
  id: string,
): Promise<VendorDetail> {
  const [vendor] = await toVendors(db, actor, [await findVendor(db, id)]);
  return { ...vendor, items: await vendorItems(db, id) };
}

// The vendor as an audit snapshot: every field, whoever is writing.
async function vendorSnapshot(db: DbLike, id: string) {
  const [vendor] = await toVendors(db, fullView, [await findVendor(db, id)]);
  return vendor;
}

// History hides contacts and the account number from part-time users, as
// toVendors does.
export async function vendorHistory(
  db: DbLike,
  actor: Actor,
  id: string,
  page: PageRequest = {},
) {
  await findVendor(db, id);
  return listHistoryPage(
    db,
    "vendor",
    id,
    (changes) => redactFieldHistory(actor, "vendor", changes),
    page,
  );
}

async function requireUniqueName(db: DbLike, name: string, exceptId?: string) {
  const [clash] = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(
      and(
        sql`lower(${vendors.name}) = lower(${name})`,
        isNull(vendors.archivedAt),
        exceptId ? sql`${vendors.id} <> ${exceptId}` : undefined,
      ),
    );
  if (clash)
    throw conflict(
      "DUPLICATE_VENDOR",
      `${clash.name} is already in the vendor directory.`,
    );
}

const vendorValues = (input: VendorInput, actor: Actor) => ({
  name: input.name,
  type: input.type,
  portalUrl: input.portalUrl,
  orderCutoff: input.orderCutoff,
  deliveryDays: input.deliveryDays,
  minimumOrderCents: input.minimumOrderCents,
  leadTimeDays: input.leadTimeDays,
  orderingInstructions: input.orderingInstructions,
  notes: input.notes,
  ...(input.accountNumber !== undefined && {
    accountNumber: input.accountNumber,
  }),
  updatedBy: actor.userId,
});

// Contacts and the account number are FT+ to see and so to change; omitted keeps
// the stored ones.
function requireContactAccess(actor: Actor, input: VendorInput) {
  if (
    (input.contacts !== undefined || input.accountNumber !== undefined) &&
    !canSeeField(actor, "vendor_contact")
  )
    throw forbidden();
}

async function syncContacts(
  tx: DbLike,
  vendorId: string,
  input: VendorInput,
) {
  if (!input.contacts) return;
  const live = await tx
    .select({ id: vendorContacts.id })
    .from(vendorContacts)
    .where(
      and(
        eq(vendorContacts.vendorId, vendorId),
        isNull(vendorContacts.archivedAt),
      ),
    );
  await syncChildren(
    live.map((contact) => contact.id),
    input.contacts,
    {
      insert: ({ name, role, email, phone }, sortOrder) =>
        tx
          .insert(vendorContacts)
          .values({ vendorId, name, role, email, phone, sortOrder }),
      update: (id, { name, role, email, phone }, sortOrder) =>
        tx
          .update(vendorContacts)
          .set({ name, role, email, phone, sortOrder })
          .where(eq(vendorContacts.id, id)),
      archive: (ids) =>
        tx
          .update(vendorContacts)
          .set({ archivedAt: new Date() })
          .where(inArray(vendorContacts.id, ids)),
    },
  );
}

async function insertVendor(tx: DbLike, actor: Actor, input: VendorInput) {
  const [row] = await tx
    .insert(vendors)
    .values({ ...vendorValues(input, actor), createdBy: actor.userId })
    .returning({ id: vendors.id });
  await syncContacts(tx, row.id, input);
  await writeAudit(tx, actor, {
    entityType: "vendor",
    entityId: row.id,
    action: "create",
    before: null,
    after: await vendorSnapshot(tx, row.id),
  });
  await emitDomainEvent(tx, { name: "vendor.created", entityId: row.id });
  return row.id;
}

export async function createVendor(
  db: Db,
  actor: Actor,
  input: VendorInput,
): Promise<VendorDetail> {
  requireContactAccess(actor, input);
  await requireUniqueName(db, input.name);
  const id = await db.transaction((tx) => insertVendor(tx, actor, input));
  return getVendor(db, actor, id);
}

// The live vendor with this name (any case), created with the given type when
// there is none. Imports call it inside their transaction, e.g. the bar import
// (F-07-12) for "Imperio".
export async function ensureVendor(
  tx: DbLike,
  actor: Actor,
  vendor: { name: string; type: VendorType },
): Promise<string> {
  const name = vendor.name.trim();
  const [found] = await tx
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(
        sql`lower(${vendors.name}) = lower(${name})`,
        isNull(vendors.archivedAt),
      ),
    );
  if (found) return found.id;
  return insertVendor(tx, actor, {
    name,
    type: vendor.type,
    portalUrl: "",
    orderCutoff: "",
    deliveryDays: [],
    minimumOrderCents: null,
    leadTimeDays: null,
    orderingInstructions: "",
    notes: "",
  });
}

export async function updateVendor(
  db: Db,
  actor: Actor,
  id: string,
  input: VendorInput,
): Promise<VendorDetail> {
  await findVendor(db, id);
  requireContactAccess(actor, input);
  await requireUniqueName(db, input.name, id);
  await db.transaction(async (tx) => {
    const before = await vendorSnapshot(tx, id);
    await tx
      .update(vendors)
      .set(vendorValues(input, actor))
      .where(eq(vendors.id, id));
    await syncContacts(tx, id, input);
    // Items keep the vendor's current name as their preferred vendor label.
    await tx
      .update(inventoryConsumableDetails)
      .set({ preferredVendor: input.name })
      .where(eq(inventoryConsumableDetails.preferredVendorId, id));
    await writeAudit(tx, actor, {
      entityType: "vendor",
      entityId: id,
      action: "update",
      before,
      after: await vendorSnapshot(tx, id),
    });
    await emitDomainEvent(tx, { name: "vendor.updated", entityId: id });
  });
  return getVendor(db, actor, id);
}

export async function setVendorArchived(
  db: Db,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<VendorDetail> {
  const current = await findVendor(db, id);
  if (!archived) await requireUniqueName(db, current.name, id);
  await setArchived(db, actor, id, archived, {
    update: (tx, values) =>
      tx.update(vendors).set(values).where(eq(vendors.id, id)),
    audit: { entityType: "vendor", snapshot: vendorSnapshot },
    event: "vendor",
  });
  return getVendor(db, actor, id);
}

// Names of live and archived vendors by id, for items that link to them.
export async function vendorNames(db: DbLike, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(inArray(vendors.id, ids));
  return new Map(rows.map((row) => [row.id, row.name]));
}

// The vendor an item links to must be live.
export async function requireLiveVendor(db: DbLike, id: string) {
  const row = await findVendor(db, id);
  if (row.archivedAt)
    throw conflict("VENDOR_ARCHIVED", `${row.name} is archived.`);
  return row;
}
