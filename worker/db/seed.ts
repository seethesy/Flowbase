import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq, and, isNull } from "drizzle-orm";
import * as schema from "./schema";
import { roles, employmentTypes } from "../../shared/access";
import { eventStatuses } from "../../shared/core-records";
import { businessTimeToUtc } from "../../shared/time";
import * as fixtures from "../../src/data/mock/fixtures";

const devProject = "qlnjdckcrawrcgcoecpl";
const prodProject = "lfsznrmrzxiohzydetbd";
export function assertSeedDatabaseUrl(
  value: string | undefined,
  mode?: string,
) {
  if (!value)
    throw new Error("DATABASE_URL is required for the development seed.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "DATABASE_URL is not a valid development connection string.",
    );
  }
  const identity = `${url.hostname}/${decodeURIComponent(url.username)}`;
  const local = ["localhost", "127.0.0.1", "[::1]", "postgres"].includes(
    url.hostname,
  );
  const dev =
    url.hostname === `db.${devProject}.supabase.co` ||
    (url.hostname.endsWith(".pooler.supabase.com") &&
      decodeURIComponent(url.username) === `postgres.${devProject}`);
  // Postgres.js sends query parameters as startup parameters, so ?user= can
  // override the URL username and route a Supabase pooler to another project.
  const identityParameters = new Set([
    "user",
    "username",
    "database",
    "db",
    "dbname",
    "host",
    "hostaddr",
    "port",
    "path",
    "service",
    "servicefile",
    "options",
  ]);
  if (
    !/^(postgres|postgresql):$/.test(url.protocol) ||
    mode === "production" ||
    identity.includes(prodProject) ||
    [...url.searchParams.keys()].some((key) =>
      identityParameters.has(key.toLowerCase()),
    ) ||
    (!local && !dev)
  )
    throw new Error(
      "Refusing to seed: only the known development project or local/CI Postgres is allowed.",
    );
  return value;
}

// Stable, namespaced IDs make every insert repeatable without overwriting edits.
export const seedId = (group: number, index: number) =>
  `f026${String(group).padStart(4, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
export const seedUsers = roles.flatMap((role, r) =>
  employmentTypes.map((employmentType, e) => ({
    id: seedId(1, r * 2 + e + 1),
    authId: seedId(2, r * 2 + e + 1),
    email: `seed.${role}.${employmentType}@flowbase.example`,
    name:
      fixtures.employees[(r * 2 + e) % fixtures.employees.length].name +
      ` (${role}, ${employmentType})`,
    role,
    employmentType,
    mobile: `202555${String(100 + r * 2 + e).padStart(4, "0")}`,
    status: "active" as const,
    activatedAt: new Date("2026-10-20T12:00:00Z"),
  })),
);

export async function seedDatabase(value: string | undefined, mode?: string) {
  const url = assertSeedDatabaseUrl(value, mode);
  const client = postgres(url, { max: 1, onnotice: () => undefined });
  const db = drizzle(client, { schema });
  try {
    await db.transaction(async (tx) => {
      // Serialize concurrent seed runs as well as making each run atomic.
      await tx.execute("select pg_advisory_xact_lock(26183)");
      await tx.insert(schema.users).values(seedUsers).onConflictDoNothing();
      const salesperson = seedUsers.find((u) => u.role === "salesperson")!.id;
      const staff = seedUsers.find((u) => u.role === "staff")!.id;
      // Assistants need a full-time primary Production Lead (FLOW-140).
      const productionLead = seedUsers.find(
        (u) => u.role === "kitchen_lead" && u.employmentType === "full_time",
      )!.id;
      for (const [i, row] of fixtures.clients.entries()) {
        await tx
          .insert(schema.clients)
          .values({
            id: seedId(3, i + 1),
            name: row.name,
            kind: "organization",
            assignedSalespersonId: salesperson,
          })
          .onConflictDoNothing();
      }
      for (const [i, row] of fixtures.contacts.entries()) {
        const parent = fixtures.clients.findIndex((c) => c.id === row.clientId);
        await tx
          .insert(schema.clientContacts)
          .values({
            id: seedId(4, i + 1),
            clientId: seedId(3, parent + 1),
            name: row.name,
            email: row.email,
            phone: fixtures.clients[parent].phone,
            phoneDigits: fixtures.clients[parent].phone.replace(/\D/g, ""),
            role: i < 35 ? "primary_poc" : "event_coordinator",
            sortOrder: i,
          })
          .onConflictDoNothing();
      }
      await tx
        .insert(schema.venues)
        .values({
          id: seedId(5, 1),
          name: "The Glasshouse",
          address: "100 Garden Way, Arlington, VA",
          jurisdiction: "VA",
        })
        .onConflictDoNothing();
      await tx
        .insert(schema.venueAreas)
        .values({ id: seedId(6, 1), venueId: seedId(5, 1), name: "Garden" })
        .onConflictDoNothing();
      // Prototype proposals, vendors and purchase orders still have no durable
      // tables. Their demo endpoints retain the original fixtures until those modules land.
      for (const [i, row] of fixtures.events.entries()) {
        await tx
          .insert(schema.events)
          .values({
            id: seedId(7, i + 1),
            title: row.name,
            startsAt: businessTimeToUtc(row.date, "18:00"),
            clientId: seedId(3, i + 1),
            venueId: seedId(5, 1),
            assignedSalespersonId: salesperson,
            productionLeadId: productionLead,
            assistantLeadIds: [staff],
            guestCount: row.guests,
            status: eventStatuses[i % eventStatuses.length],
          })
          .onConflictDoNothing();
      }
      const sections = await tx
        .select()
        .from(schema.inventorySections)
        .where(isNull(schema.inventorySections.archivedAt));
      const rentalSections = sections.filter((s) =>
        ["Warehouse", "Jamie's", "Cafe", "Vendor"].includes(s.name),
      );
      const storage = sections.find((s) => s.name === "Kitchen – Refrigerated");
      if (rentalSections.length !== 4 || !storage)
        throw new Error(
          "Migrate the database before seeding its default sections.",
        );
      for (const [i, row] of fixtures.inventory.entries()) {
        const rental = row.category === "Tableware";
        const id = seedId(8, i + 1);
        const unit =
          ({ pcs: "each", bottles: "each", L: "l" } as Record<string, string>)[
            row.unit
          ] ?? row.unit;
        await tx
          .insert(schema.inventoryItems)
          .values({
            id,
            kind: rental ? "rental" : "consumable",
            subtype: rental
              ? "tableware"
              : row.category === "Supplies"
                ? "supply"
                : "ingredient",
            code: row.id,
            name: row.name,
            category: row.category,
            unit,
          })
          .onConflictDoNothing();
        if (rental)
          await tx
            .insert(schema.inventoryRentalDetails)
            .values({
              id: seedId(9, i + 1),
              itemId: id,
              priceCents: Math.round(row.cost * 100),
            })
            .onConflictDoNothing();
        else
          await tx
            .insert(schema.inventoryConsumableDetails)
            .values({
              id: seedId(10, i + 1),
              itemId: id,
              purchaseUnit: unit,
              unitCostCents: Math.round(row.cost * 100),
              preferredVendor: row.vendor,
              parLevel: row.reorder,
              storageSectionId: storage.id,
            })
            .onConflictDoNothing();
        for (const [j, section] of (rental
          ? rentalSections
          : [storage]
        ).entries()) {
          const movementId = seedId(11 + j, i + 1);
          const quantity = rental
            ? Math.floor(row.onHand / rentalSections.length) +
              (j < row.onHand % rentalSections.length ? 1 : 0)
            : row.onHand;
          // The stock cache and its opening ledger entry must agree, including on re-runs.
          const inserted = await tx
            .insert(schema.stockMovements)
            .values({
              id: movementId,
              itemId: id,
              sectionId: section.id,
              type: "receive",
              quantity,
              reason: "Development opening stock",
            })
            .onConflictDoNothing()
            .returning();
          if (inserted.length) {
            const [existing] = await tx
              .select()
              .from(schema.inventoryStock)
              .where(
                and(
                  eq(schema.inventoryStock.itemId, id),
                  eq(schema.inventoryStock.sectionId, section.id),
                ),
              );
            if (existing)
              throw new Error(
                "Seed stock exists without its opening movement; refusing to overwrite it.",
              );
            await tx.insert(schema.inventoryStock).values({
              id: seedId(15 + j, i + 1),
              itemId: id,
              sectionId: section.id,
              quantity,
            });
          }
        }
      }
      await tx
        .insert(schema.leads)
        .values({
          id: seedId(20, 1),
          name: "Seed wedding inquiry",
          channel: "manual",
          source: "Referral",
          email: "wedding@flowbase.example",
          eventDate: "2026-12-05",
          assignedSalespersonId: salesperson,
          status: "new",
        })
        .onConflictDoNothing();
    });
  } finally {
    await client.end();
  }
}
