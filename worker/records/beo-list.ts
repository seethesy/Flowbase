import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import { beoListStatus, type BeoListQuery, type BeoListRow } from "../../shared/beo-list";
import { businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import type { DbLike } from "../db/client";
import { approvalRequests, attachments, beos, events, users } from "../db/schema";
import { visibleEvents } from "./events";

// The BEOs tab (FLOW-265): the BEO of every event the viewer may open
// (visibleEvents), newest event last for Upcoming and first for Past. Upcoming
// starts today in New York time. Status and owner filter the rows; Final is
// derived (approved BEO, Finished event), so status is matched after the query.

// A guard against an unbounded response; far more than a season of events.
const MAX_ROWS = 500;

export async function listBeos(
  db: DbLike,
  actor: Actor,
  query: BeoListQuery,
  now = new Date(),
): Promise<BeoListRow[]> {
  const today = businessTimeToUtc(utcToBusinessTime(now).date, "00:00");
  const rows = await db
    .select({
      id: beos.id,
      status: beos.status,
      updatedAt: beos.updatedAt,
      updatedBy: beos.updatedBy,
      eventId: events.id,
      eventTitle: events.title,
      eventStatus: events.status,
      startsAt: events.startsAt,
      guestCount: events.guestCount,
      ownerId: events.assignedSalespersonId,
    })
    .from(beos)
    .innerJoin(events, eq(events.id, beos.eventId))
    .where(
      and(
        isNull(beos.archivedAt),
        isNull(events.archivedAt),
        visibleEvents(actor),
        query.when === "upcoming" ? gte(events.startsAt, today) : undefined,
        query.when === "past" ? lt(events.startsAt, today) : undefined,
        query.owner ? eq(events.assignedSalespersonId, query.owner) : undefined,
      ),
    )
    .orderBy(query.when === "past" ? desc(events.startsAt) : asc(events.startsAt), asc(beos.id))
    .limit(MAX_ROWS);
  const shown = rows.filter(
    (row) => !query.status || beoListStatus(row.status, row.eventStatus) === query.status,
  );
  if (!shown.length) return [];

  const userIds = [
    ...new Set(shown.flatMap((row) => [row.ownerId, row.updatedBy]).filter((id): id is string => Boolean(id))),
  ];
  const people = userIds.length
    ? await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(inArray(users.id, userIds))
    : [];
  // A user without a name shows as their email, as on the roster.
  const names = new Map(people.map((person) => [person.id, person.name || person.email]));
  const person = (id: string | null) => (id && names.has(id) ? { id, name: names.get(id)! } : null);

  const approved = await db
    .select({ subjectId: approvalRequests.subjectId, count: sql<number>`count(*)::int` })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.subjectType, "beo"),
        eq(approvalRequests.status, "approved"),
        inArray(approvalRequests.subjectId, shown.map((row) => row.id)),
      ),
    )
    .groupBy(approvalRequests.subjectId);
  const counts = new Map(approved.map((row) => [row.subjectId, Number(row.count)]));

  // Approved BEO PDFs are one Documents document per event (document id = event
  // id), a version per approval (FLOW-263). The newest ready version is linked.
  const pdfs = await db
    .select({
      documentId: attachments.documentId,
      displayName: attachments.displayName,
      fileName: attachments.fileName,
      versionNumber: attachments.versionNumber,
    })
    .from(attachments)
    .where(
      and(
        eq(attachments.docType, "beo"),
        eq(attachments.status, "ready"),
        isNull(attachments.archivedAt),
        inArray(attachments.documentId, shown.map((row) => row.eventId)),
      ),
    )
    .orderBy(desc(attachments.versionNumber));
  const pdfByEvent = new Map<string, { documentId: string; name: string }>();
  for (const pdf of pdfs)
    if (pdf.documentId && !pdfByEvent.has(pdf.documentId))
      pdfByEvent.set(pdf.documentId, { documentId: pdf.documentId, name: pdf.displayName ?? pdf.fileName });

  return shown.map((row) => {
    const times = counts.get(row.id) ?? 0;
    return {
      id: row.id,
      eventId: row.eventId,
      eventTitle: row.eventTitle,
      eventStatus: row.eventStatus,
      eventStartsAt: row.startsAt.toISOString(),
      version: Math.max(1, row.status === "approved" ? times : times + 1),
      status: beoListStatus(row.status, row.eventStatus),
      guestCount: row.guestCount,
      owner: person(row.ownerId),
      lastEditedBy: person(row.updatedBy),
      updatedAt: row.updatedAt.toISOString(),
      pdf: pdfByEvent.get(row.eventId) ?? null,
    };
  });
}
