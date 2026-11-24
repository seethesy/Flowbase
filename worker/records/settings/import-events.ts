import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { Actor } from "../../../shared/access";
import {
  createsClient,
  describeEventRow,
  eventExternalKey,
  eventImportFields,
  parseEventRow,
  type EventImportRow,
} from "../../../shared/import-events";
import { businessTimeToUtc, utcToBusinessTime } from "../../../shared/time";
import { writeAudit } from "../../audit/log";
import type { DbLike } from "../../db/client";
import { eventStatusHistory, events, leads } from "../../db/schema";
import { ApiError } from "../../hono";
import { emitDomainEvent } from "../../jobs/queue";
import { insertClient } from "../sales/clients";
import { eventSnapshot, insertLeadEvent, updateLeadEventBasics } from "../events/events";
import { defineImportModule } from "./imports";
import { auditLead, leadSnapshot } from "../leads/lead-audit";
import { createLead } from "../leads/leads";
import { phoneDigits } from "../core/sync";

// The Events importer (FLOW-299), in Settings › Imports (FLOW-290). Q1 (pending
// Art's confirmation): each row becomes a lead at the row's status plus its
// event, and the client once the status is Closing or later, linked the way
// Closing links them (FLOW-112). The record an import key points at is the event,
// so re-running the file updates the same lead and event and, when nothing in
// the row changed, nothing at all (AC2).

const source = "Events import";

// What the lead holds from the row.
const leadValues = (row: EventImportRow) => ({
  name: row.contactName || row.clientName,
  email: row.email,
  phone: row.phone,
  eventDate: row.date,
  guestCount: row.guestCount,
  location: row.venue,
  eventType: row.eventType,
  eventName: row.title,
  message: row.notes,
});

async function eventOf(db: DbLike, id: string) {
  const [event] = await db.select().from(events).where(eq(events.id, id));
  if (!event) throw new ApiError(409, "IMPORT_RECORD_MISSING", "The event this row imported before is gone.");
  return event;
}
async function leadOf(db: DbLike, id: string | null) {
  const [lead] = id ? await db.select().from(leads).where(eq(leads.id, id)) : [];
  if (!lead) throw new ApiError(409, "IMPORT_RECORD_MISSING", "The lead this row imported before is gone.");
  return lead;
}

// The lead and event move straight to the row's status: the sheet is history,
// not a walk through the pipeline.
async function setStatus(tx: DbLike, actor: Actor, leadId: string, eventId: string, row: EventImportRow) {
  const lead = await leadOf(tx, leadId);
  if (lead.status !== row.status) {
    const before = await leadSnapshot(tx, leadId);
    await tx
      .update(leads)
      .set({
        status: row.status,
        lostReason: row.status === "lost" ? lead.lostReason || "Imported as Lost." : lead.lostReason,
        updatedBy: actor.userId,
      })
      .where(eq(leads.id, leadId));
    await auditLead(tx, actor, leadId, before);
    await emitDomainEvent(tx, {
      name: "lead.status_changed",
      entityId: leadId,
      data: { from: lead.status, to: row.status, imported: true },
    });
  }
  const event = await eventOf(tx, eventId);
  if (event.status !== row.status) {
    const before = await eventSnapshot(tx, eventId);
    await tx.update(events).set({ status: row.status, updatedBy: actor.userId }).where(eq(events.id, eventId));
    await tx.insert(eventStatusHistory).values({
      eventId,
      fromStatus: event.status,
      toStatus: row.status,
      reason: "Imported",
      createdBy: actor.userId,
      updatedBy: actor.userId,
    });
    await writeAudit(tx, actor, { entityType: "event", entityId: eventId, action: "update", before, after: await eventSnapshot(tx, eventId) });
    await emitDomainEvent(tx, { name: "event.updated", entityId: eventId });
  }
}

// Closing or later: the client, with the row's contact as its primary POC,
// linked to the lead and its events as Closing does. Created once.
async function ensureClient(tx: DbLike, actor: Actor, leadId: string, eventId: string, row: EventImportRow) {
  if (!createsClient(row.status)) return;
  const lead = await leadOf(tx, leadId);
  if (lead.convertedClientId) return;
  const hasContact = Boolean(row.contactName || row.email || row.phone);
  const clientId = await insertClient(
    tx,
    actor,
    "all",
    {
      name: row.clientName,
      kind: row.contactName && row.contactName !== row.clientName ? "organization" : "person",
      notes: "",
      tags: [],
      contacts: hasContact
        ? [{
            name: row.contactName || row.clientName,
            role: "primary_poc" as const,
            email: row.email || undefined,
            phone: row.phone || undefined,
            notes: "",
          }]
        : [],
      assignedSalespersonId: lead.assignedSalespersonId,
    },
    [],
  );
  const before = await leadSnapshot(tx, leadId);
  await tx
    .update(leads)
    .set({ convertedClientId: clientId, convertedEventId: eventId, updatedBy: actor.userId })
    .where(eq(leads.id, leadId));
  await auditLead(tx, actor, leadId, before);
  await tx
    .update(events)
    .set({ clientId, updatedBy: actor.userId })
    .where(and(eq(events.leadId, leadId), isNull(events.archivedAt)));
}

// The event details the lead doesn't carry to an existing event.
async function updateEventDetails(tx: DbLike, actor: Actor, eventId: string, row: EventImportRow) {
  const event = await eventOf(tx, eventId);
  const local = utcToBusinessTime(event.startsAt);
  if (event.title !== row.title || local.date !== row.date || local.time !== row.startTime)
    await updateLeadEventBasics(tx, actor, eventId, { title: row.title, date: row.date, startTime: row.startTime });
  if (event.guestCount !== row.guestCount || event.address !== row.venue || event.eventType !== row.eventType || event.internalNotes !== row.notes) {
    const before = await eventSnapshot(tx, eventId);
    await tx
      .update(events)
      .set({ guestCount: row.guestCount, address: row.venue, eventType: row.eventType, internalNotes: row.notes, updatedBy: actor.userId })
      .where(eq(events.id, eventId));
    await writeAudit(tx, actor, { entityType: "event", entityId: eventId, action: "update", before, after: await eventSnapshot(tx, eventId) });
    await emitDomainEvent(tx, { name: "event.updated", entityId: eventId });
  }
}

export const eventsImporter = defineImportModule<EventImportRow>({
  key: "events",
  label: "Events",
  // Settings › Imports is Admin only (FLOW-290).
  permission: "imports.run",
  fields: eventImportFields,
  parse: parseEventRow,
  externalKey: eventExternalKey,
  describe: describeEventRow,
  check: async (_db, _actor, row) => {
    try {
      businessTimeToUtc(row.date, row.startTime);
      return [];
    } catch {
      return [`${row.date} ${row.startTime} doesn't exist (a daylight saving change).`];
    }
  },
  // Same event name on the same day, not imported from this row before.
  findDuplicates: async (db, _actor, row) => {
    const start = businessTimeToUtc(row.date, "00:00");
    const end = new Date(start.getTime() + 36 * 3_600_000);
    const matches = await db
      .select({ id: events.id, title: events.title, startsAt: events.startsAt })
      .from(events)
      .where(
        and(
          sql`lower(${events.title}) = lower(${row.title})`,
          gte(events.startsAt, start),
          lt(events.startsAt, end),
          isNull(events.archivedAt),
        ),
      );
    return matches
      .filter((match) => utcToBusinessTime(match.startsAt).date === row.date)
      .map((match) => ({ id: match.id, label: `${match.title} on ${row.date}` }));
  },
  wouldChange: async (db, _actor, eventId, row) => {
    const [event] = await db.select().from(events).where(eq(events.id, eventId));
    if (!event?.leadId) return true;
    const [lead] = await db.select().from(leads).where(eq(leads.id, event.leadId));
    if (!lead) return true;
    const local = utcToBusinessTime(event.startsAt);
    const wanted = leadValues(row);
    return (
      event.title !== row.title ||
      local.date !== row.date ||
      local.time !== row.startTime ||
      event.status !== row.status ||
      event.guestCount !== row.guestCount ||
      event.address !== row.venue ||
      event.eventType !== row.eventType ||
      event.internalNotes !== row.notes ||
      lead.status !== row.status ||
      (createsClient(row.status) && !lead.convertedClientId) ||
      (Object.keys(wanted) as (keyof typeof wanted)[]).some((field) => lead[field] !== wanted[field])
    );
  },
  create: async (tx, actor, row, context) => {
    const { id: leadId } = await createLead(
      tx,
      {
        channel: "import",
        source,
        // Ties the lead to its row, so createLead never makes a second one.
        sourceLeadId: eventExternalKey(row),
        ...leadValues(row),
        rawPayload: { importId: context.importId, fileName: context.fileName },
      },
      { createdBy: actor.userId },
    );
    await writeAudit(tx, actor, { entityType: "lead", entityId: leadId, action: "create", before: null, after: await leadSnapshot(tx, leadId) });
    const lead = await leadOf(tx, leadId);
    const eventId = await insertLeadEvent(tx, actor, lead, { title: row.title, date: row.date, startTime: row.startTime });
    await setStatus(tx, actor, leadId, eventId, row);
    await ensureClient(tx, actor, leadId, eventId, row);
    return eventId;
  },
  update: async (tx, actor, eventId, row) => {
    const event = await eventOf(tx, eventId);
    const lead = await leadOf(tx, event.leadId);
    const wanted = leadValues(row);
    if ((Object.keys(wanted) as (keyof typeof wanted)[]).some((field) => lead[field] !== wanted[field])) {
      const before = await leadSnapshot(tx, lead.id);
      await tx
        .update(leads)
        .set({ ...wanted, phoneDigits: phoneDigits(wanted.phone), updatedBy: actor.userId })
        .where(eq(leads.id, lead.id));
      await auditLead(tx, actor, lead.id, before);
      await emitDomainEvent(tx, { name: "lead.updated", entityId: lead.id });
    }
    await updateEventDetails(tx, actor, eventId, row);
    await setStatus(tx, actor, lead.id, eventId, row);
    await ensureClient(tx, actor, lead.id, eventId, row);
  },
});
