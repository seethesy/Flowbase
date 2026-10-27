import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { Db } from "../../worker/db/client";
import * as s from "../../worker/db/schema";
import { seedUsers } from "../../worker/db/seed";
import { assertTestDatabaseUrl } from "../db/test-database";
import type { Client, FlowEvent } from "../../shared/core-records";
import type { InventoryItem, Section } from "../../shared/inventory";
import type { Lead, LeadDuplicateReason } from "../../shared/leads";
import { addLocalDays, businessTimeToUtc } from "../../shared/time";
import { defaultListValues, listKeys } from "../../shared/settings";

export async function browserDb<T>(run: (db: Db) => Promise<T>) {
  const client = postgres(assertTestDatabaseUrl(process.env.DATABASE_URL), {
    max: 1,
  });
  try {
    return await run(drizzle(client, { schema: s }));
  } finally {
    await client.end();
  }
}

export async function resetBrowserDatabase(sections: Section[]) {
  const client = postgres(assertTestDatabaseUrl(process.env.DATABASE_URL), {
    max: 1,
  });
  try {
    // Serial tests reset data only; committed migrations run once per suite.
    const tables = await client<
      { tablename: string }[]
    >`select tablename from pg_tables where schemaname = 'public'`;
    await client.unsafe(
      `truncate ${tables.map((t) => `public."${t.tablename.replaceAll('"', '""')}"`).join(", ")} cascade`,
    );
    const db = drizzle(client, { schema: s });
    await db
      .insert(s.users)
      .values(
        seedUsers.map((u, i) => ({
          ...u,
          name: i === 0 ? "Test Admin" : u.name,
        })),
      );
    // The truncate also clears the lists migration 0021 seeds (FLOW-45).
    await db.insert(s.listValues).values(
      listKeys.flatMap((listKey) =>
        defaultListValues[listKey].map((label, sortOrder) => ({
          listKey,
          label,
          sortOrder,
        })),
      ),
    );
    await db
      .insert(s.inventorySections)
      .values(
        sections.map((row, sortOrder) => ({
          id: row.id,
          name: row.name,
          kind: row.kind,
          sortOrder,
        })),
      );
  } finally {
    await client.end();
  }
}

export async function seedRecords(
  seed: { clients?: Client[]; events?: FlowEvent[] } = {},
) {
  await browserDb(async (db) => {
    for (const row of seed.clients ?? []) {
      await db
        .insert(s.clients)
        .values({
          id: row.id,
          name: row.name,
          kind: row.kind,
          assignedSalespersonId: row.assignedSalespersonId,
          notes: row.notes,
          tags: row.tags,
        });
      for (const [sortOrder, contact] of row.contacts.entries())
        await db.insert(s.clientContacts).values({
          ...contact,
          clientId: row.id,
          phoneDigits: (contact.phone ?? "").replace(/\D/g, ""),
          sortOrder,
          email: contact.email ?? "",
          phone: contact.phone ?? "",
        });
    }
    for (const row of seed.events ?? []) {
      // Use the same wall-clock conversion as production. No retained event API mock.
      const startsAt = businessTimeToUtc(row.date, row.startTime);
      const endDate =
        row.endTime && row.endTime < row.startTime
          ? addLocalDays(row.date, 1)
          : row.date;
      const endsAt = row.endTime
        ? businessTimeToUtc(endDate, row.endTime)
        : null;
      await db
        .insert(s.events)
        .values({
          id: row.id,
          title: row.title,
          startsAt,
          endsAt,
          clientId: row.client.id,
          pocContactId: row.pocContactId,
          address: row.address,
          eventType: row.eventType,
          serviceType: row.serviceType,
          foodServiceStyle: row.foodServiceStyle,
          guestCount: row.guestCount,
          servingsCount: row.servingsCount,
          assignedSalespersonId: row.assignedSalespersonId,
          productionLeadId: row.productionLeadId,
          assistantLeadIds: row.assistantLeadIds,
          dressCode: row.dressCode,
          transportationNotes: row.transportationNotes,
          internalNotes: row.internalNotes,
          status: row.status,
        });
      for (const [sortOrder, area] of row.areas.entries())
        await db
          .insert(s.eventAreas)
          .values({ ...area, eventId: row.id, sortOrder });
    }
  });
}

export async function seedInventory(seed: { items?: InventoryItem[] } = {}) {
  await browserDb(async (db) => {
    for (const row of seed.items ?? []) {
      await db
        .insert(s.inventoryItems)
        .values({
          id: row.id,
          kind: row.kind,
          subtype: row.subtype,
          code: row.code,
          name: row.name,
          category: row.category,
          description: row.description,
          unit: row.unit,
          group: row.group,
          color: row.color,
          tier: row.tier,
          active: row.active,
          ratioQuantity: row.ratio?.quantity,
          ratioBasis: row.ratio?.basis,
        });
      if (row.rental)
        await db
          .insert(s.inventoryRentalDetails)
          .values({ itemId: row.id, ...row.rental });
      if (row.service)
        await db
          .insert(s.inventoryServiceDetails)
          .values({ itemId: row.id, ...row.service });
      if (row.consumable) {
        const c = row.consumable;
        await db
          .insert(s.inventoryConsumableDetails)
          .values({
            itemId: row.id,
            purchaseUnit: c.purchaseUnit,
            packCount: c.packCount,
            eachSizeQuantity: c.eachSize?.quantity,
            eachSizeUnit: c.eachSize?.unit,
            recipeUnit: c.recipeUnit,
            unitCostCents: c.unitCostCents,
            preferredVendor: c.preferredVendor,
            parLevel: c.parLevel,
            allergens: c.allergens,
            storageSectionId: c.storageSectionId,
            storageOrder: c.storageOrder,
          });
      }
      if (row.bar)
        await db
          .insert(s.inventoryBarDetails)
          .values({ itemId: row.id, ...row.bar });
      // Legacy fixtures model opening balances separately from the movement
      // history under test. The shared development seed writes both ledger/cache.
      for (const level of row.stock)
        await db
          .insert(s.inventoryStock)
          .values({
            itemId: row.id,
            sectionId: level.sectionId,
            quantity: level.quantity,
            color: level.color ?? "",
          });
    }
  });
}

export async function seedLeads(
  rows: Lead[],
  pairs: {
    leadId: string;
    matchedLeadId: string;
    reason: LeadDuplicateReason;
  }[] = [],
) {
  await browserDb(async (db) => {
    for (const row of rows)
      await db.insert(s.leads).values({
        id: row.id,
        receivedAt: new Date(row.receivedAt),
        channel: row.channel,
        source: row.source,
        sourceLeadId: row.sourceLeadId,
        sourceLeadUrl: row.sourceLeadUrl,
        purchased: row.purchased,
        name: row.name,
        email: row.email,
        phone: row.phone,
        phoneDigits: row.phone.replace(/\D/g, ""),
        eventDate: row.eventDate,
        guestCount: row.guestCount,
        location: row.location,
        eventType: row.eventType,
        budgetCents: row.budgetCents,
        message: row.message,
        status: row.status,
        lostReason: row.lostReason,
        firstRespondedAt: row.firstRespondedAt
          ? new Date(row.firstRespondedAt)
          : null,
        assignedSalespersonId: row.assignedSalespersonId,
        convertedClientId: row.convertedClientId,
        convertedEventId: row.convertedEventId,
        rawPayload: row.rawPayload,
      });
    if (pairs.length) await db.insert(s.leadDuplicates).values(pairs);
  });
}
