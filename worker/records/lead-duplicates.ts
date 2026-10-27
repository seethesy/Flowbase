import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type {
  LeadDuplicate,
  LeadDuplicateReason,
  LeadMatch,
  LeadSourceLink,
  LeadSummary,
} from "../../shared/leads";
import type { Db, DbLike } from "../db/client";
import { clientContacts, clients, leadDuplicates, leads } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { writeAudit } from "../audit/log";
import { can, clientScope, leadScope } from "../policy";
import { auditLead, leadSnapshot } from "./lead-audit";
import { keyset, type Page, type PageRequest } from "./paging";

// Lead duplicate detection and merge (FLOW-110). A new lead is matched against
// earlier leads and clients by email or phone, then by name and event date (the
// same source lead id is handled in createLead: it updates the existing lead). A
// match is stored as an open duplicate until someone merges the leads or dismisses
// it. A match the caller can't see is never described to them: a salesperson only
// sees no indication that another salesperson's records exist (FLOW-38).
type LeadRow = typeof leads.$inferSelect;
type DuplicateRow = typeof leadDuplicates.$inferSelect;
type ClientRef = { id: string; name: string; assignedSalespersonId: string | null };

// pg_trgm similarity of two names: "Maya Ortiz" and "Maya Ortíz" match, "Maya
// Ortiz" and "Maya Chen" don't.
const NAME_SIMILARITY = 0.6;
const MAX_MATCHES = 20;

export const toLeadSummary = (row: LeadRow): LeadSummary => ({
  id: row.id,
  name: row.name,
  source: row.source,
  channel: row.channel,
  status: row.status,
  receivedAt: row.receivedAt.toISOString(),
  eventDate: row.eventDate,
  assignedSalespersonId: row.assignedSalespersonId,
});

const leadVisibleTo = (actor: Actor, row: Pick<LeadRow, "assignedSalespersonId">) => {
  const scope = leadScope(actor);
  return scope === "all" || (scope === "own" && row.assignedSalespersonId === actor.userId);
};
const clientVisibleTo = (actor: Actor, row: Pick<ClientRef, "assignedSalespersonId">) => {
  const scope = clientScope(actor);
  return scope === "all" || (scope === "own" && row.assignedSalespersonId === actor.userId);
};
// Finds and stores the new lead's possible duplicates, inside createLead's
// transaction. Emits lead.duplicates_found when there are any.
export async function recordLeadDuplicates(tx: DbLike, lead: LeadRow) {
  const email = lead.email.trim().toLowerCase();
  const digits = lead.phoneDigits.length >= 7 ? lead.phoneDigits : "";
  const tests: { reason: LeadDuplicateReason; condition: SQL }[] = [];
  if (email) tests.push({ reason: "email", condition: sql`lower(${leads.email}) = ${email}` });
  if (digits) tests.push({ reason: "phone", condition: sql`${leads.phoneDigits} = ${digits}` });
  if (lead.name.trim() && lead.eventDate)
    tests.push({
      reason: "name_event_date",
      condition: sql`(${leads.eventDate} = ${lead.eventDate}
        and similarity(${leads.name}, ${lead.name}) >= ${NAME_SIMILARITY})`,
    });
  if (!tests.length) return;
  const reason = sql<LeadDuplicateReason>`case ${sql.join(
    tests.map((test) => sql`when ${test.condition} then ${test.reason}`),
    sql` `,
  )} end`;
  const leadMatches = await tx
    .select({ id: leads.id, reason })
    .from(leads)
    .where(
      and(
        ne(leads.id, lead.id),
        isNull(leads.archivedAt),
        or(...tests.map((test) => test.condition)),
      ),
    )
    .orderBy(desc(leads.receivedAt))
    .limit(MAX_MATCHES);

  const contactTests = [
    email ? sql`lower(${clientContacts.email}) = ${email}` : undefined,
    digits ? sql`${clientContacts.phoneDigits} = ${digits}` : undefined,
  ].filter((test): test is SQL => Boolean(test));
  const clientMatches = contactTests.length
    ? await tx
        .selectDistinct({
          id: clients.id,
          reason: sql<LeadDuplicateReason>`case when ${
            email ? sql`lower(${clientContacts.email}) = ${email}` : sql`false`
          } then 'email' else 'phone' end`,
        })
        .from(clientContacts)
        .innerJoin(clients, eq(clientContacts.clientId, clients.id))
        .where(
          and(
            isNull(clientContacts.archivedAt),
            isNull(clients.archivedAt),
            or(...contactTests),
          ),
        )
        .limit(MAX_MATCHES)
    : [];
  const byClient = new Map(clientMatches.map((match) => [match.id, match]));
  // A client matching on both email and phone is one duplicate (email first).
  for (const match of clientMatches)
    if (match.reason === "email") byClient.set(match.id, match);

  const rows = [
    ...leadMatches.map((match) => ({
      leadId: lead.id,
      matchedLeadId: match.id,
      reason: match.reason,
    })),
    ...[...byClient.values()].map((match) => ({
      leadId: lead.id,
      matchedClientId: match.id,
      reason: match.reason,
    })),
  ];
  if (!rows.length) return;
  await tx.insert(leadDuplicates).values(rows).onConflictDoNothing();
  await emitDomainEvent(tx, {
    name: "lead.duplicates_found",
    entityId: lead.id,
    data: {
      matchedLeadIds: leadMatches.map((match) => match.id),
      matchedClientIds: [...byClient.keys()],
    },
  });
}

async function leadsById(db: DbLike, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = unique.length
    ? await db.select().from(leads).where(inArray(leads.id, unique))
    : [];
  return new Map(rows.map((row) => [row.id, row]));
}

async function clientsById(db: DbLike, ids: string[]) {
  const unique = [...new Set(ids)];
  const rows: ClientRef[] = unique.length
    ? await db
        .select({
          id: clients.id,
          name: clients.name,
          assignedSalespersonId: clients.assignedSalespersonId,
        })
        .from(clients)
        .where(and(inArray(clients.id, unique), isNull(clients.archivedAt)))
    : [];
  return new Map(rows.map((row) => [row.id, row]));
}

// The lead's open duplicates as the actor may see them, for the lead detail.
export async function leadMatchesFor(
  db: DbLike,
  actor: Actor,
  lead: LeadRow,
): Promise<{ duplicates: LeadMatch[]; assignedElsewhere: boolean }> {
  const rows = await db
    .select()
    .from(leadDuplicates)
    .where(
      and(
        eq(leadDuplicates.status, "open"),
        or(eq(leadDuplicates.leadId, lead.id), eq(leadDuplicates.matchedLeadId, lead.id)),
      ),
    )
    .orderBy(asc(leadDuplicates.createdAt));
  const otherId = (row: DuplicateRow) =>
    row.leadId === lead.id ? row.matchedLeadId : row.leadId;
  const others = await leadsById(
    db,
    rows.map(otherId).filter((id): id is string => Boolean(id)),
  );
  const matchedClients = await clientsById(
    db,
    rows.map((row) => row.matchedClientId).filter((id): id is string => Boolean(id)),
  );
  const duplicates: LeadMatch[] = [];
  for (const row of rows) {
    const other = otherId(row);
    if (other) {
      const match = others.get(other);
      if (!match || match.archivedAt) continue;
      if (leadVisibleTo(actor, match))
        duplicates.push({
          duplicateId: row.id,
          reason: row.reason,
          lead: toLeadSummary(match),
          client: null,
        });
    } else if (row.matchedClientId) {
      const match = matchedClients.get(row.matchedClientId);
      if (!match) continue;
      if (clientVisibleTo(actor, match))
        duplicates.push({
          duplicateId: row.id,
          reason: row.reason,
          lead: null,
          client: { id: match.id, name: match.name },
        });
    }
  }
  return { duplicates, assignedElsewhere: false };
}

// Every source record behind the lead: its own, then each lead merged into it.
export async function sourceLinksFor(db: DbLike, lead: LeadRow): Promise<LeadSourceLink[]> {
  const merged = await db
    .select()
    .from(leads)
    .where(eq(leads.mergedIntoLeadId, lead.id))
    .orderBy(asc(leads.receivedAt));
  return [lead, ...merged].map((row) => ({
    leadId: row.id,
    channel: row.channel,
    source: row.source,
    sourceLeadId: row.sourceLeadId,
    sourceLeadUrl: row.sourceLeadUrl,
    receivedAt: row.receivedAt.toISOString(),
    mergedAt: row.mergedAt?.toISOString() ?? null,
    mergedBy: row.mergedBy,
  }));
}

// The duplicates queue: open duplicates whose records the actor can all see.
// Admin and the Sales Manager see every one, including cross-owner duplicates; a
// salesperson sees only duplicates among their own leads and clients.
// A page holds the open pairs the caller may resolve; pairs they can't see are
// skipped, so a page can be shorter than the limit while more remain.
export async function listLeadDuplicates(
  db: DbLike,
  actor: Actor,
  page: PageRequest = {},
): Promise<Page<LeadDuplicate>> {
  if (leadScope(actor) === "none") throw forbidden();
  type Row = typeof leadDuplicates.$inferSelect;
  const paging = keyset<Row>(
    [
      { column: leadDuplicates.createdAt, type: "timestamp", desc: true, of: (row) => row.createdAt },
      { column: leadDuplicates.id, type: "uuid", desc: true, of: (row) => row.id },
    ],
    page,
  );
  const rows = await db
    .select()
    .from(leadDuplicates)
    .where(and(eq(leadDuplicates.status, "open"), paging.where))
    .orderBy(...paging.orderBy)
    .limit(paging.limit);
  return paging.page(rows, (kept) => visibleDuplicates(db, actor, kept));
}

async function visibleDuplicates(
  db: DbLike,
  actor: Actor,
  rows: (typeof leadDuplicates.$inferSelect)[],
): Promise<LeadDuplicate[]> {
  const byId = await leadsById(
    db,
    rows.flatMap((row) => [row.leadId, ...(row.matchedLeadId ? [row.matchedLeadId] : [])]),
  );
  const matchedClients = await clientsById(
    db,
    rows.map((row) => row.matchedClientId).filter((id): id is string => Boolean(id)),
  );
  const result: LeadDuplicate[] = [];
  for (const row of rows) {
    const lead = byId.get(row.leadId);
    if (!lead || lead.archivedAt || !leadVisibleTo(actor, lead)) continue;
    const other = row.matchedLeadId ? byId.get(row.matchedLeadId) : undefined;
    const client = row.matchedClientId ? matchedClients.get(row.matchedClientId) : undefined;
    const match = other ?? client;
    if (!match) continue;
    if (other && (other.archivedAt || !leadVisibleTo(actor, other))) continue;
    if (client && !clientVisibleTo(actor, client)) continue;
    result.push({
      id: row.id,
      reason: row.reason,
      lead: toLeadSummary(lead),
      matchedLead: other ? toLeadSummary(other) : null,
      matchedClient: client ? { id: client.id, name: client.name } : null,
      crossOwner:
        lead.assignedSalespersonId !== null &&
        match.assignedSalespersonId !== null &&
        lead.assignedSalespersonId !== match.assignedSalespersonId,
      createdAt: row.createdAt.toISOString(),
    });
  }
  return result;
}

// An open duplicate whose records the actor can see and may resolve; otherwise
// 404, so a duplicate the actor can't see is never confirmed to exist.
async function resolvableDuplicate(db: DbLike, actor: Actor, id: string) {
  if (!can(actor, "leads.merge")) throw forbidden();
  const [row] = await db.select().from(leadDuplicates).where(eq(leadDuplicates.id, id));
  if (!row || row.status !== "open") throw notFound("Duplicate");
  const byId = await leadsById(
    db,
    [row.leadId, row.matchedLeadId].filter((leadId): leadId is string => Boolean(leadId)),
  );
  const pair = [...byId.values()];
  if (pair.some((lead) => lead.archivedAt || !leadVisibleTo(actor, lead)))
    throw notFound("Duplicate");
  if (row.matchedClientId) {
    const client = (await clientsById(db, [row.matchedClientId])).get(row.matchedClientId);
    if (!client || !clientVisibleTo(actor, client)) throw notFound("Duplicate");
  }
  return { row, byId };
}

// The dismissal shows in the history of the lead the duplicate was found for
// (FLOW-185), naming the duplicate record rather than what it matched.
export async function dismissLeadDuplicate(db: Db, actor: Actor, id: string) {
  const { row } = await resolvableDuplicate(db, actor, id);
  await db.transaction(async (tx) => {
    const dismissed = await tx
      .update(leadDuplicates)
      .set({ status: "dismissed", resolvedAt: new Date(), resolvedBy: actor.userId, updatedBy: actor.userId })
      .where(and(eq(leadDuplicates.id, row.id), eq(leadDuplicates.status, "open")))
      .returning({ id: leadDuplicates.id });
    if (dismissed.length)
      await writeAudit(tx, actor, {
        entityType: "lead",
        entityId: row.leadId,
        action: "update",
        before: { dismissedDuplicateId: null },
        after: { dismissedDuplicateId: row.id },
      });
  });
}

// The fields a merge copies to the kept lead when it has none of its own.
const fillable = [
  "name",
  "email",
  "phone",
  "phoneDigits",
  "eventDate",
  "guestCount",
  "location",
  "eventType",
  "budgetCents",
  "message",
] as const;
const isBlank = (value: unknown) => value === null || value === "";

// Merges two duplicate leads into the one the actor keeps. The other lead is
// archived with a link to the kept one, and keeps its source record and raw
// payload; the kept lead lists both source links (sourceLinksFor) and takes any
// details only the other one had. Records who merged and when.
export async function mergeLeadDuplicate(
  db: Db,
  actor: Actor,
  id: string,
  keepLeadId: string,
): Promise<string> {
  const { row, byId } = await resolvableDuplicate(db, actor, id);
  if (!row.matchedLeadId)
    throw new ApiError(409, "INVALID_REQUEST", "A client match can't be merged; link it when converting.");
  const keep = byId.get(keepLeadId);
  const otherId = keepLeadId === row.leadId ? row.matchedLeadId : row.leadId;
  const other = byId.get(otherId);
  if (!keep || !other)
    throw new ApiError(400, "INVALID_REQUEST", "Keep one of the two leads.");
  if (other.status === "converted")
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      keep.status === "converted"
        ? "Both leads were converted; they can't be merged."
        : "Keep the converted lead.",
    );
  const now = new Date();
  await db.transaction(async (tx) => {
    const keptBefore = await leadSnapshot(tx, keep.id);
    const otherBefore = await leadSnapshot(tx, other.id);
    const archived = await tx
      .update(leads)
      .set({
        archivedAt: now,
        mergedIntoLeadId: keep.id,
        mergedAt: now,
        mergedBy: actor.userId,
        updatedBy: actor.userId,
      })
      .where(and(eq(leads.id, other.id), isNull(leads.archivedAt)))
      .returning({ id: leads.id });
    if (!archived.length)
      throw new ApiError(409, "STALE_LEAD", "This lead just changed. Reload and try again.");
    const filled: Partial<typeof leads.$inferInsert> = {};
    for (const field of fillable)
      if (isBlank(keep[field]) && !isBlank(other[field]))
        Object.assign(filled, { [field]: other[field] });
    await tx
      .update(leads)
      .set({ ...filled, updatedBy: actor.userId })
      .where(eq(leads.id, keep.id));
    // Leads merged earlier into the archived one now belong to the kept one.
    await tx
      .update(leads)
      .set({ mergedIntoLeadId: keep.id })
      .where(eq(leads.mergedIntoLeadId, other.id));
    const resolved = { resolvedAt: now, resolvedBy: actor.userId, updatedBy: actor.userId };
    await tx
      .update(leadDuplicates)
      .set({ status: "merged", ...resolved })
      .where(eq(leadDuplicates.id, row.id));
    // The archived lead's other open duplicates move to the kept lead, unless the
    // kept lead already has the same one.
    const moving = await tx
      .select()
      .from(leadDuplicates)
      .where(
        and(
          eq(leadDuplicates.status, "open"),
          or(eq(leadDuplicates.leadId, other.id), eq(leadDuplicates.matchedLeadId, other.id)),
        ),
      );
    const kept = await tx
      .select()
      .from(leadDuplicates)
      .where(
        and(
          eq(leadDuplicates.status, "open"),
          or(eq(leadDuplicates.leadId, keep.id), eq(leadDuplicates.matchedLeadId, keep.id)),
        ),
      );
    const key = (a: string, b: string) => [a, b].sort().join(":");
    const existing = new Set(
      kept.map((dup) => key(dup.leadId, dup.matchedLeadId ?? `client:${dup.matchedClientId}`)),
    );
    for (const dup of moving) {
      const leadId = dup.leadId === other.id ? keep.id : dup.leadId;
      const matchedLeadId = dup.matchedLeadId === other.id ? keep.id : dup.matchedLeadId;
      const pair = key(leadId, matchedLeadId ?? `client:${dup.matchedClientId}`);
      if (matchedLeadId === leadId || existing.has(pair)) {
        await tx
          .update(leadDuplicates)
          .set({ status: "merged", ...resolved })
          .where(eq(leadDuplicates.id, dup.id));
        continue;
      }
      existing.add(pair);
      await tx
        .update(leadDuplicates)
        .set({ leadId, matchedLeadId, updatedBy: actor.userId })
        .where(eq(leadDuplicates.id, dup.id));
    }
    // One row on each lead: the kept lead lists the merged one and any details it
    // took; the merged lead is archived with a link to the kept one (FLOW-185).
    await auditLead(tx, actor, keep.id, keptBefore);
    await auditLead(tx, actor, other.id, otherBefore, "archive");
    await emitDomainEvent(tx, {
      name: "lead.merged",
      entityId: keep.id,
      data: { mergedLeadId: other.id, duplicateId: row.id },
    });
  });
  return keep.id;
}
