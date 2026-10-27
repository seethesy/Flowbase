import {
  canSeeField,
  serializeFields,
  redactFieldHistory,
} from "../../shared/visibility";
import { and, asc, eq, ilike, inArray, isNotNull, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import type { Venue, venueInputSchema } from "../../shared/core-records";
import { fullView, listHistory, writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { venueAreas, venueContacts, venues } from "../db/schema";
import { forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { setArchived } from "./archive";
import { syncChildren } from "./sync";

// Venues (FLOW-54) are shared reference data every signed-in user can read. Venue
// contacts are FT+ only: hidden from part-time users, who also can't change them.
type VenueRow = typeof venues.$inferSelect;
type VenueInput = z.output<typeof venueInputSchema>;

async function toVenues(db: DbLike, actor: Actor, rows: VenueRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const areas = await db
    .select()
    .from(venueAreas)
    .where(and(inArray(venueAreas.venueId, ids), isNull(venueAreas.archivedAt)))
    .orderBy(asc(venueAreas.sortOrder));
  const contacts = canSeeField(actor, "venue_contact")
    ? await db
        .select()
        .from(venueContacts)
        .where(
          and(
            inArray(venueContacts.venueId, ids),
            isNull(venueContacts.archivedAt),
          ),
        )
        .orderBy(asc(venueContacts.sortOrder))
    : undefined;
  return rows.map((row): Venue =>
    serializeFields<Venue>(actor, "venue", {
      id: row.id,
      name: row.name,
      address: row.address,
      jurisdiction: row.jurisdiction,
      loadInNotes: row.loadInNotes,
      parkingNotes: row.parkingNotes,
      areas: areas
        .filter((area) => area.venueId === row.id)
        .map(({ id, name }) => ({ id, name })),
      contacts:
        contacts
          ?.filter((contact) => contact.venueId === row.id)
          .map(({ id, name, role, email, phone }) => ({
            id,
            name,
            role,
            email,
            phone,
          })) ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

export async function listVenues(
  db: Db,
  actor: Actor,
  filter: { archived?: boolean; search?: string },
): Promise<Venue[]> {
  const rows = await db
    .select()
    .from(venues)
    .where(
      and(
        filter.archived
          ? isNotNull(venues.archivedAt)
          : isNull(venues.archivedAt),
        filter.search ? ilike(venues.name, `%${filter.search}%`) : undefined,
      ),
    )
    .orderBy(asc(venues.name))
    .limit(500);
  return toVenues(db, actor, rows);
}

export async function findVenue(db: DbLike, id: string) {
  const [row] = await db.select().from(venues).where(eq(venues.id, id));
  if (!row) throw notFound("Venue");
  return row;
}

export async function getVenue(db: Db, actor: Actor, id: string) {
  const [venue] = await toVenues(db, actor, [await findVenue(db, id)]);
  return venue;
}

// The venue as an audit snapshot (FLOW-41): every field, whoever is writing.
async function venueSnapshot(db: DbLike, id: string) {
  const [venue] = await toVenues(db, fullView, [await findVenue(db, id)]);
  return venue;
}

// History hides venue contacts from part-time users, as toVenues does.
export async function venueHistory(db: DbLike, actor: Actor, id: string) {
  await findVenue(db, id);
  return listHistory(db, "venue", id, (changes) =>
    redactFieldHistory(actor, "venue", changes),
  );
}

// The venue's live areas, in order; events copy them when the venue is picked.
export function venueAreaNames(db: DbLike, venueId: string) {
  return db
    .select({ name: venueAreas.name })
    .from(venueAreas)
    .where(and(eq(venueAreas.venueId, venueId), isNull(venueAreas.archivedAt)))
    .orderBy(asc(venueAreas.sortOrder));
}

async function syncVenueChildren(
  tx: DbLike,
  actor: Actor,
  venueId: string,
  input: VenueInput,
) {
  const liveAreas = await liveAreaIds(tx, venueId);
  await syncChildren(
    liveAreas.map((area) => area.id),
    input.areas,
    {
      insert: (area, sortOrder) =>
        tx.insert(venueAreas).values({ venueId, name: area.name, sortOrder }),
      update: (id, area, sortOrder) =>
        tx
          .update(venueAreas)
          .set({ name: area.name, sortOrder })
          .where(eq(venueAreas.id, id)),
      archive: (ids) =>
        tx
          .update(venueAreas)
          .set({ archivedAt: new Date() })
          .where(inArray(venueAreas.id, ids)),
    },
  );
  if (!input.contacts) return;
  if (!canSeeField(actor, "venue_contact")) throw forbidden();
  const liveContacts = await tx
    .select({ id: venueContacts.id })
    .from(venueContacts)
    .where(
      and(eq(venueContacts.venueId, venueId), isNull(venueContacts.archivedAt)),
    );
  await syncChildren(
    liveContacts.map((contact) => contact.id),
    input.contacts,
    {
      insert: ({ name, role, email, phone }, sortOrder) =>
        tx
          .insert(venueContacts)
          .values({ venueId, name, role, email, phone, sortOrder }),
      update: (id, { name, role, email, phone }, sortOrder) =>
        tx
          .update(venueContacts)
          .set({ name, role, email, phone, sortOrder })
          .where(eq(venueContacts.id, id)),
      archive: (ids) =>
        tx
          .update(venueContacts)
          .set({ archivedAt: new Date() })
          .where(inArray(venueContacts.id, ids)),
    },
  );
}

const liveAreaIds = (db: DbLike, venueId: string) =>
  db
    .select({ id: venueAreas.id })
    .from(venueAreas)
    .where(and(eq(venueAreas.venueId, venueId), isNull(venueAreas.archivedAt)));

const venueValues = (input: VenueInput, actor: Actor) => ({
  name: input.name,
  address: input.address,
  jurisdiction: input.jurisdiction,
  loadInNotes: input.loadInNotes,
  parkingNotes: input.parkingNotes,
  updatedBy: actor.userId,
});

export async function createVenue(
  db: Db,
  actor: Actor,
  input: VenueInput,
): Promise<Venue> {
  if (input.contacts?.length && !canSeeField(actor, "venue_contact"))
    throw forbidden();
  const id = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(venues)
      .values({ ...venueValues(input, actor), createdBy: actor.userId })
      .returning({ id: venues.id });
    await syncVenueChildren(tx, actor, row.id, input);
    await writeAudit(tx, actor, {
      entityType: "venue",
      entityId: row.id,
      action: "create",
      before: null,
      after: await venueSnapshot(tx, row.id),
    });
    await emitDomainEvent(tx, { name: "venue.created", entityId: row.id });
    return row.id;
  });
  return getVenue(db, actor, id);
}

export async function updateVenue(
  db: Db,
  actor: Actor,
  id: string,
  input: VenueInput,
): Promise<Venue> {
  await findVenue(db, id);
  await db.transaction(async (tx) => {
    const before = await venueSnapshot(tx, id);
    await tx
      .update(venues)
      .set(venueValues(input, actor))
      .where(eq(venues.id, id));
    await syncVenueChildren(tx, actor, id, input);
    await writeAudit(tx, actor, {
      entityType: "venue",
      entityId: id,
      action: "update",
      before,
      after: await venueSnapshot(tx, id),
    });
    await emitDomainEvent(tx, { name: "venue.updated", entityId: id });
  });
  return getVenue(db, actor, id);
}

// Venue archive and restore emit venue.archived / venue.restored (FLOW-192 R09).
export async function setVenueArchived(
  db: Db,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<Venue> {
  await findVenue(db, id);
  await setArchived(db, actor, id, archived, {
    update: (tx, values) =>
      tx.update(venues).set(values).where(eq(venues.id, id)),
    audit: { entityType: "venue", snapshot: venueSnapshot },
    event: "venue",
  });
  return getVenue(db, actor, id);
}
