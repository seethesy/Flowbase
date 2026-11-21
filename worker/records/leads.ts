import { redactFieldHistory, serializeFields } from "../../shared/visibility";
import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import { eventInputSchema } from "../../shared/core-records";
import {
  isOpenLeadStatus,
  leadChannelSchema,
  leadIntakeSchema,
  leadManualSchema,
  leadNeedsReview,
  leadStatusLabels,
  leadStatusSchema,
  leadStatusTransitions,
  openLeadStatuses,
  type Lead,
  type LeadConversion,
  type LeadIntake,
  type LeadManualInput,
  type leadConvertSchema,
  type leadStatusChangeSchema,
  type LeadBeo,
} from "../../shared/leads";
import { listHistoryPage, writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { approvalRequests, beos, clientContacts, events, leadDuplicates, leads, proposals, users } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { can, clientScope, leadScope, mayCloseLead, type Scope } from "../policy";
import {
  checkDuplicates,
  clientSnapshot,
  duplicateClientError,
  findVisibleClient,
  insertClient,
  requireClientAccess,
} from "./clients";
import { getEvent, insertEvent, insertLeadEvent, updateLeadEventBasics } from "./events";
import { insertProposal } from "./proposals";
import { auditLead, leadSnapshot } from "./lead-audit";
import { setArchived } from "./archive";
import {
  leadMatchesFor,
  recordLeadDuplicates,
  sourceLinksFor,
} from "./lead-duplicates";
import { keyset, type Page, type PageRequest } from "./paging";
import { phoneDigits } from "./sync";
import type { LeadUpdateInput } from "../../shared/leads";

// Leads (FLOW-100 inbox, FLOW-111 triage and status, FLOW-112 conversion). Admin and
// Sales Manager see every lead; a salesperson sees only the leads assigned to them,
// and anything else answers 404 (Q-41).
type LeadRow = typeof leads.$inferSelect;

export function visibleLeads(actor: Actor): SQL | undefined {
  const scope = leadScope(actor);
  if (scope === "all") return undefined;
  if (scope === "own") return eq(leads.assignedSalespersonId, actor.userId);
  return sql`false`;
}

function requireLeadAccess(actor: Actor): Scope {
  const scope = leadScope(actor);
  if (scope === "none") throw forbidden();
  return scope;
}

function toLead(row: LeadRow, actor: Actor, withRawPayload = false): Lead {
  return serializeFields<Lead>(actor, "lead", {
    id: row.id,
    receivedAt: row.receivedAt.toISOString(),
    channel: row.channel,
    source: row.source,
    sourceLeadId: row.sourceLeadId,
    sourceLeadUrl: row.sourceLeadUrl,
    purchased: row.purchased,
    name: row.name,
    email: row.email,
    phone: row.phone,
    eventDate: row.eventDate,
    guestCount: row.guestCount,
    location: row.location,
    eventType: row.eventType,
    eventName: row.eventName,
    notes: row.notes,
    budgetCents: row.budgetCents,
    message: row.message,
    status: row.status,
    lostReason: row.lostReason,
    firstRespondedAt: row.firstRespondedAt?.toISOString() ?? null,
    firstResponseSeconds: row.firstRespondedAt
      ? Math.max(
          0,
          Math.round(
            (row.firstRespondedAt.getTime() - row.receivedAt.getTime()) / 1000,
          ),
        )
      : null,
    assignedSalespersonId: row.assignedSalespersonId,
    convertedClientId: row.convertedClientId,
    convertedEventId: row.convertedEventId,
    needsReview: leadNeedsReview(row),
    // Never in a list; on the detail only for FT+ users (F-09-01).
    ...(withRawPayload && {
      rawPayload: row.rawPayload ?? null,
    }),
    mergedIntoLeadId: row.mergedIntoLeadId,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

async function latestEventsFor(db: DbLike, ids: string[]) {
  const latest = new Map<string, { id: string; title: string; startsAt: string }>();
  if (!ids.length) return latest;
  const linked = await db.select({ id: events.id, leadId: events.leadId,
    title: events.title, startsAt: events.startsAt }).from(events)
    .where(and(inArray(events.leadId, ids), isNull(events.archivedAt)))
    .orderBy(desc(events.createdAt), desc(events.id));
  for (const event of linked) if (event.leadId && !latest.has(event.leadId))
    latest.set(event.leadId, { id: event.id, title: event.title,
      startsAt: event.startsAt.toISOString() });
  return latest;
}

type ParsedIntake = ReturnType<typeof leadIntakeSchema.parse>;

// The same source record again (FLOW-110 matching step 1, and source status
// updates): details it now carries replace the stored ones; the lead's status,
// assignment and received time stay.
function updatedFromSource(lead: ParsedIntake) {
  const given = <T>(value: T) =>
    value === "" || value === null ? undefined : value;
  return {
    sourceLeadUrl: given(lead.sourceLeadUrl),
    ...(lead.purchased && { purchased: true }),
    name: given(lead.name),
    email: given(lead.email),
    phone: given(lead.phone),
    phoneDigits: given(phoneDigits(lead.phone)),
    eventDate: given(lead.eventDate),
    guestCount: given(lead.guestCount),
    location: given(lead.location),
    eventType: given(lead.eventType),
    eventName: given(lead.eventName),
    notes: lead.notes ?? undefined,
    budgetCents: given(lead.budgetCents),
    message: given(lead.message),
    ...(lead.rawPayload !== undefined && { rawPayload: lead.rawPayload }),
  };
}

// The one way a lead enters the system. Collectors (FLOW-102), webhooks (FLOW-108),
// manual entry (FLOW-101) and import (FLOW-109) all call this. Emits lead.collected
// for the collector and lead.received for everything else, in the same transaction,
// and records the lead's possible duplicates (FLOW-110). A lead with the same source
// and source lead id as a stored one updates that lead instead (created: false) and
// emits lead.updated.
export async function createLead(
  db: DbLike,
  input: LeadIntake,
  options: { createdBy?: string; assignedSalespersonId?: string } = {},
): Promise<{ id: string; created: boolean }> {
  const lead = leadIntakeSchema.parse(input);
  return db.transaction(async (tx) => {
    if (lead.sourceLeadId) {
      const [existing] = await tx
        .select({ id: leads.id })
        .from(leads)
        .where(
          and(
            eq(leads.source, lead.source),
            eq(leads.sourceLeadId, lead.sourceLeadId),
          ),
        )
        .orderBy(leads.createdAt)
        .limit(1);
      if (existing) {
        await tx
          .update(leads)
          .set({
            ...updatedFromSource(lead),
            updatedBy: options.createdBy ?? null,
          })
          .where(eq(leads.id, existing.id));
        await emitDomainEvent(tx, {
          name: "lead.updated",
          entityId: existing.id,
          data: { channel: lead.channel, source: lead.source },
        });
        return { id: existing.id, created: false };
      }
    }
    const [row] = await tx
      .insert(leads)
      .values({
        receivedAt: lead.receivedAt ? new Date(lead.receivedAt) : new Date(),
        channel: lead.channel,
        source: lead.source,
        sourceLeadId: lead.sourceLeadId,
        sourceLeadUrl: lead.sourceLeadUrl,
        purchased: lead.purchased,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        phoneDigits: phoneDigits(lead.phone),
        eventDate: lead.eventDate,
        guestCount: lead.guestCount,
        location: lead.location,
        eventType: lead.eventType,
        eventName: lead.eventName,
        notes: lead.notes,
        budgetCents: lead.budgetCents,
        message: lead.message,
        rawPayload: lead.rawPayload ?? null,
        assignedSalespersonId: options.assignedSalespersonId ?? null,
        createdBy: options.createdBy ?? null,
        updatedBy: options.createdBy ?? null,
      })
      .returning();
    await emitDomainEvent(tx, {
      name: lead.channel === "collector" ? "lead.collected" : "lead.received",
      entityId: row.id,
      data: { channel: lead.channel, source: lead.source },
    });
    await recordLeadDuplicates(tx, row);
    return { id: row.id, created: true };
  });
}

// Manual entry (FLOW-101): channel manual, in the inbox at once. A salesperson's
// lead is assigned to them (they could not see it otherwise); Admin and the Sales
// Manager's land unassigned for triage. createLead records the possible duplicates.
export async function createManualLead(
  db: Db,
  actor: Actor,
  input: LeadManualInput,
): Promise<Lead> {
  const scope = requireLeadAccess(actor);
  const lead = leadManualSchema.parse(input);
  const id = await db.transaction(async (tx) => {
    const created = await createLead(
      tx,
      { ...lead, channel: "manual" },
      {
        createdBy: actor.userId,
        assignedSalespersonId: scope === "own" ? actor.userId : undefined,
      },
    );
    await writeAudit(tx, actor, {
      entityType: "lead",
      entityId: created.id,
      action: "create",
      before: null,
      after: await leadSnapshot(tx, created.id),
    });
    return created.id;
  });
  return getLead(db, actor, id);
}

export type LeadFilter = {
  status?: string;
  source?: string;
  channel?: string;
  // A user id, or "unassigned".
  assigned?: string;
  // Missing an event date or any contact method.
  needsReview?: boolean;
  // The triage queue: open leads with no salesperson yet.
  triage?: boolean;
  search?: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listLeads(
  db: DbLike,
  actor: Actor,
  filter: LeadFilter,
  page: PageRequest = {},
): Promise<Page<Lead>> {
  requireLeadAccess(actor);
  const none: Page<Lead> = { rows: [], next: null };
  const status = filter.status ? leadStatusSchema.safeParse(filter.status) : undefined;
  if (status && !status.success) return none;
  const channel = filter.channel
    ? leadChannelSchema.safeParse(filter.channel)
    : undefined;
  if (channel && !channel.success) return none;
  if (
    filter.assigned &&
    filter.assigned !== "unassigned" &&
    !uuidPattern.test(filter.assigned)
  )
    return none;
  const paging = keyset<LeadRow>(
    [
      { column: leads.receivedAt, type: "timestamp", desc: true, of: (row) => row.receivedAt },
      { column: leads.id, type: "uuid", desc: true, of: (row) => row.id },
    ],
    page,
  );
  const search = filter.search ? `%${filter.search}%` : undefined;
  const rows = await db
    .select()
    .from(leads)
    .where(
      and(
        visibleLeads(actor),
        isNull(leads.archivedAt),
        status?.success ? eq(leads.status, status.data) : undefined,
        filter.source ? eq(leads.source, filter.source) : undefined,
        channel?.success ? eq(leads.channel, channel.data) : undefined,
        filter.assigned === "unassigned"
          ? isNull(leads.assignedSalespersonId)
          : filter.assigned
            ? eq(leads.assignedSalespersonId, filter.assigned)
            : undefined,
        filter.needsReview
          ? or(
              isNull(leads.eventDate),
              and(eq(leads.email, ""), eq(leads.phone, "")),
            )
          : undefined,
        filter.triage
          ? and(
              isNull(leads.assignedSalespersonId),
              inArray(leads.status, [...openLeadStatuses]),
            )
          : undefined,
        search
          ? or(
              ilike(leads.name, search),
              ilike(leads.email, search),
              ilike(leads.phone, search),
            )
          : undefined,
        paging.where,
      ),
    )
    .orderBy(...paging.orderBy)
    .limit(paging.limit);
  const latest = await latestEventsFor(db, rows.map((row) => row.id));
  const ids = rows.map((row) => row.id);
  const proposalRows = ids.length ? await db.select({ id: proposals.id,
    eventId: proposals.eventId, title: proposals.title, leadId: events.leadId })
    .from(proposals).innerJoin(events, eq(events.id, proposals.eventId))
    .where(and(inArray(events.leadId, ids), isNull(proposals.archivedAt)))
    .orderBy(desc(proposals.createdAt), desc(proposals.id)) : [];
  const latestProposal = new Map<string, { id: string; eventId: string; title: string }>();
  for (const proposal of proposalRows) if (proposal.leadId && !latestProposal.has(proposal.leadId))
    latestProposal.set(proposal.leadId, proposal);
  const latestBeo = await latestBeosForLeads(db, ids);
  const duplicateRows = ids.length ? await db.select({ leadId: leadDuplicates.leadId,
    matchedLeadId: leadDuplicates.matchedLeadId }).from(leadDuplicates)
    .where(and(eq(leadDuplicates.status, "open"),
      or(inArray(leadDuplicates.leadId, ids), inArray(leadDuplicates.matchedLeadId, ids)))) : [];
  const duplicateIds = new Set(duplicateRows.flatMap((row) => [row.leadId, row.matchedLeadId].filter((id): id is string => Boolean(id))));
  return paging.page(rows, (kept) => kept.map((row) => ({ ...toLead(row, actor),
    latestEvent: latest.get(row.id) ?? null,
    latestProposal: latestProposal.get(row.id) ?? null,
    latestBeo: latestBeo.get(row.id) ?? null,
    possibleDuplicate: duplicateIds.has(row.id) })));
}

// A lead the actor may see; otherwise 404, never 403.
export async function findVisibleLead(db: DbLike, actor: Actor, id: string) {
  requireLeadAccess(actor);
  const [row] = await db
    .select()
    .from(leads)
    .where(
      and(eq(leads.id, id), isNull(leads.archivedAt), visibleLeads(actor)),
    );
  if (!row) throw notFound("Lead");
  return row;
}

// Locks the lead, then checks visibility on the current row (FLOW-199): a
// reassignment that commits first is seen, so the previous salesperson's change
// answers 404 and writes nothing; one that comes second waits for this change.
async function lockVisibleLead(tx: DbLike, actor: Actor, id: string) {
  requireLeadAccess(actor);
  await tx
    .select({ id: leads.id })
    .from(leads)
    .where(eq(leads.id, id))
    .for("update");
  return findVisibleLead(tx, actor, id);
}

// Archive and restore a lead (FLOW-260 bulk delete and its Undo). The lead is
// locked and checked against the actor's visibility, archived or not; a lead at
// Closing or Closed already has a client record and is never archived here.
export async function setLeadArchived(db: Db, actor: Actor, id: string, archived: boolean) {
  requireLeadAccess(actor);
  await setArchived(db, actor, id, archived, {
    lock: async (tx) => {
      const [row] = await tx
        .select()
        .from(leads)
        .where(and(eq(leads.id, id), visibleLeads(actor)))
        .for("update");
      if (!row) throw notFound("Lead");
      if (archived && (row.status === "closing" || row.status === "closed"))
        throw new ApiError(409, "LEAD_CONVERTED", "already has a client record");
    },
    update: (tx, values) => tx.update(leads).set(values).where(eq(leads.id, id)),
    audit: { entityType: "lead", snapshot: leadSnapshot },
    event: "lead",
  });
}

// The detail adds every source link and the possible duplicates the actor may see.
export async function getLead(
  db: DbLike,
  actor: Actor,
  id: string,
): Promise<Lead> {
  const row = await findVisibleLead(db, actor, id);
  const { duplicates, assignedElsewhere } = await leadMatchesFor(
    db,
    actor,
    row,
  );
  return {
    ...toLead(row, actor, true),
    latestEvent: (await latestEventsFor(db, [id])).get(id) ?? null,
    sourceLinks: await sourceLinksFor(db, row),
    duplicates,
    assignedElsewhere,
  };
}

// Lead history (FLOW-185), for anyone who can see the lead. Contact details are
// hidden from those who can't see them; raw payloads are never in the history.
export async function leadHistory(
  db: DbLike,
  actor: Actor,
  id: string,
  page: PageRequest = {},
) {
  await findVisibleLead(db, actor, id);
  return listHistoryPage(
    db,
    "lead",
    id,
    (changes) => redactFieldHistory(actor, "lead", changes),
    page,
  );
}

function requireAssign(actor: Actor) {
  if (!can(actor, "leads.assign")) throw forbidden();
}

const requireOpen = (row: LeadRow) => {
  if (!isOpenLeadStatus(row.status))
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      `A ${leadStatusLabels[row.status].toLowerCase()} lead can't be assigned.`,
    );
};

// Assigns a salesperson to the leads, all or nothing. Admin only (FLOW-111). Each
// lead whose salesperson changes emits lead.assigned, which is how the salesperson
// is notified.
export async function bulkAssignLeads(
  db: Db,
  actor: Actor,
  leadIds: string[],
  salespersonId: string,
): Promise<Lead[]> {
  requireAssign(actor);
  const [owner] = await db.select({ id: users.id }).from(users).where(and(
    eq(users.id, salespersonId), inArray(users.role, ["salesperson", "sales_manager", "admin"]),
    eq(users.status, "active"), isNull(users.archivedAt),
  ));
  if (!owner) throw new ApiError(400, "INVALID_OWNER", "Choose an active Salesperson, Sales Manager or Admin.");
  const ids = [...new Set(leadIds)];
  const updated = await db.transaction(async (tx) => {
    // Locked in id order (FLOW-199), so a conversion that commits first is seen
    // and refused as no longer open, and one that comes second waits.
    const rows = await tx
      .select()
      .from(leads)
      .where(and(inArray(leads.id, ids), isNull(leads.archivedAt)))
      .orderBy(asc(leads.id))
      .for("update");
    if (rows.length !== ids.length) throw notFound("Lead");
    rows.forEach(requireOpen);
    const changing = rows.filter(
      (row) => row.assignedSalespersonId !== salespersonId,
    );
    const before = new Map<string, Record<string, unknown>>();
    for (const row of changing)
      before.set(row.id, await leadSnapshot(tx, row.id));
    if (changing.length)
      await tx
        .update(leads)
        .set({ assignedSalespersonId: salespersonId, updatedBy: actor.userId })
        .where(
          inArray(
            leads.id,
            changing.map((row) => row.id),
          ),
        );
    for (const row of changing) {
      await auditLead(tx, actor, row.id, before.get(row.id)!);
      await emitDomainEvent(tx, {
        name: "lead.assigned",
        entityId: row.id,
        data: {
          assignedSalespersonId: salespersonId,
          previousSalespersonId: row.assignedSalespersonId,
        },
      });
    }
    return ids;
  });
  const rows = await db
    .select()
    .from(leads)
    .where(inArray(leads.id, updated))
    .orderBy(desc(leads.receivedAt));
  return rows.map((row) => toLead(row, actor));
}

export async function listLeadOwners(db: DbLike) {
  return db.select({ id: users.id, name: users.name, role: users.role }).from(users)
    .where(and(inArray(users.role, ["salesperson", "sales_manager", "admin"]),
      eq(users.status, "active"), isNull(users.archivedAt)))
    .orderBy(asc(users.name));
}

export async function assignLead(
  db: Db,
  actor: Actor,
  id: string,
  salespersonId: string,
): Promise<Lead> {
  await bulkAssignLeads(db, actor, [id], salespersonId);
  return getLead(db, actor, id);
}

export async function createLeadEvent(
  db: Db, actor: Actor, id: string,
  input: { title: string; date: string; startTime: string },
) {
  const eventId = await db.transaction(async (tx) => {
    const lead = await lockVisibleLead(tx, actor, id);
    if (lead.status === "lost")
      throw new ApiError(409, "INVALID_TRANSITION", "Reopen this lead before creating an event.");
    return insertLeadEvent(tx, actor, lead, input);
  });
  return getEvent(db, actor, eventId);
}

export async function updateLead(db: Db, actor: Actor, id: string, input: LeadUpdateInput) {
  await db.transaction(async (tx) => {
    await lockVisibleLead(tx, actor, id);
    const before = await leadSnapshot(tx, id);
    const { eventTime, ...leadInput } = input;
    if (input.eventName !== undefined || input.eventDate !== undefined || eventTime !== undefined) {
      const [linked] = await tx.select({ id: events.id }).from(events)
        .where(and(eq(events.leadId, id), isNull(events.archivedAt)))
        .orderBy(desc(events.createdAt)).limit(1);
      if (linked) await updateLeadEventBasics(tx, actor, linked.id, {
        ...(input.eventName !== undefined && { title: input.eventName }),
        ...(input.eventDate !== undefined && { date: input.eventDate }),
        ...(eventTime !== undefined && { startTime: eventTime }),
      });
    }
    await tx.update(leads).set({ ...leadInput,
      ...(input.phone !== undefined && { phoneDigits: phoneDigits(input.phone) }),
      updatedBy: actor.userId,
    }).where(eq(leads.id, id));
    await auditLead(tx, actor, id, before);
    await emitDomainEvent(tx, { name: "lead.updated", entityId: id });
  });
  return getLead(db, actor, id);
}

export async function listLeadEvents(db: Db, actor: Actor, id: string) {
  await findVisibleLead(db, actor, id);
  const rows = await db.select({ id: events.id }).from(events)
    .where(and(eq(events.leadId, id), isNull(events.archivedAt)))
    .orderBy(desc(events.createdAt), desc(events.id));
  return Promise.all(rows.map((row) => getEvent(db, actor, row.id)));
}

// FLOW-264: the BEO of each of the lead's events, newest first (the lead page's
// "BEO: v3 (Approved)" links). The lead must be visible.
export async function listLeadBeos(db: Db, actor: Actor, id: string): Promise<LeadBeo[]> {
  await findVisibleLead(db, actor, id);
  const rows = await beoRowsForLeads(db, [id]);
  return withVersions(db, rows);
}

type BeoRow = { id: string; eventId: string; leadId: string | null; status: LeadBeo["status"] };
async function beoRowsForLeads(db: DbLike, leadIds: string[]): Promise<BeoRow[]> {
  if (!leadIds.length) return [];
  return db
    .select({ id: beos.id, eventId: beos.eventId, leadId: events.leadId, status: beos.status })
    .from(beos)
    .innerJoin(events, eq(events.id, beos.eventId))
    .where(and(inArray(events.leadId, leadIds), isNull(beos.archivedAt), isNull(events.archivedAt)))
    .orderBy(desc(beos.updatedAt), desc(beos.id));
}
async function withVersions(db: DbLike, rows: BeoRow[]): Promise<LeadBeo[]> {
  if (!rows.length) return [];
  const approved = await db
    .select({ subjectId: approvalRequests.subjectId, count: sql<number>`count(*)::int` })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.subjectType, "beo"),
        eq(approvalRequests.status, "approved"),
        inArray(approvalRequests.subjectId, rows.map((row) => row.id)),
      ),
    )
    .groupBy(approvalRequests.subjectId);
  const counts = new Map(approved.map((row) => [row.subjectId, Number(row.count)]));
  return rows.map((row) => {
    const times = counts.get(row.id) ?? 0;
    return { id: row.id, eventId: row.eventId, status: row.status, version: Math.max(1, row.status === "approved" ? times : times + 1) };
  });
}
async function latestBeosForLeads(db: DbLike, leadIds: string[]): Promise<Map<string, LeadBeo>> {
  const rows = await beoRowsForLeads(db, leadIds);
  const latest = new Map<string, BeoRow>();
  for (const row of rows) if (row.leadId && !latest.has(row.leadId)) latest.set(row.leadId, row);
  const versioned = await withVersions(db, [...latest.values()]);
  const byId = new Map(versioned.map((beo) => [beo.id, beo]));
  return new Map([...latest].map(([leadId, row]) => [leadId, byId.get(row.id)!]));
}

// Status moves: new -> contacted -> qualified, or lost (with a reason) from any open
// status. The first move to contacted stamps the first-response time. "Converted" is
// reached only through convertLead.
export async function changeLeadStatus(
  db: Db,
  actor: Actor,
  id: string,
  change: z.output<typeof leadStatusChangeSchema>,
): Promise<Lead> {
  await db.transaction(async (tx) => {
    // Authorized and checked against the current, locked lead (FLOW-199).
    const current = await lockVisibleLead(tx, actor, id);
    if (change.status === "closing")
      throw new ApiError(409, "CLOSING_ACTION_REQUIRED", "Confirm Closing to create or link the client.");
    if (change.status === "closed" && !mayCloseLead(actor, current.assignedSalespersonId))
      throw forbidden();
    if (!leadStatusTransitions[current.status].includes(change.status))
      throw new ApiError(
        409,
        "INVALID_TRANSITION",
        `A ${leadStatusLabels[current.status].toLowerCase()} lead can't be marked ${leadStatusLabels[change.status].toLowerCase()}.`,
      );
    const before = await leadSnapshot(tx, id);
    const changed = await tx
      .update(leads)
      .set({
        status: change.status,
        lostReason: change.status === "lost" ? change.reason : current.lostReason,
        firstRespondedAt:
          change.status !== "inquiry" && change.status !== "lost" && !current.firstRespondedAt
            ? new Date()
            : current.firstRespondedAt,
        updatedBy: actor.userId,
      })
      // Guards against two people changing the same lead at once.
      .where(and(eq(leads.id, id), eq(leads.status, current.status)))
      .returning({ id: leads.id });
    if (!changed.length) throw staleLead();
    await auditLead(tx, actor, id, before);
    await emitDomainEvent(tx, {
      name: "lead.status_changed",
      entityId: id,
      data: {
        from: current.status,
        to: change.status,
        ...(change.status === "lost" && { reason: change.reason }),
      },
    });
  });
  return getLead(db, actor, id);
}

const staleLead = () =>
  new ApiError(
    409,
    "STALE_LEAD",
    "This lead just changed. Reload and try again.",
  );

const clip = (value: string, max: number) => value.slice(0, max);

// Converts a qualified lead into a client (new or linked), a contact, an inquiry
// event and its first proposal (FLOW-163), all pre-filled from the lead, in ONE
// transaction: any failure leaves nothing behind (FLOW-112).
export async function convertLead(
  db: Db,
  actor: Actor,
  id: string,
  input: z.output<typeof leadConvertSchema>,
): Promise<LeadConversion> {
  const clients = clientScope(actor);
  requireClientAccess(actor);

  const result = await db.transaction(async (tx) => {
    // Every check runs on the current, locked lead (FLOW-199): a reassignment or
    // another conversion that commits first stops this one before it creates a
    // client, contact, event, proposal or outbox row.
    const lead = await lockVisibleLead(tx, actor, id);
    if (lead.status === "closing" || lead.status === "closed")
      throw new ApiError(
        409,
        "INVALID_TRANSITION",
        "This lead was already converted.",
      );
    if (lead.status === "lost")
      throw new ApiError(
        409,
        "INVALID_TRANSITION",
        "A lost lead cannot move to Closing.",
      );
    const date = input.event.date ?? lead.eventDate;
    const before = await leadSnapshot(tx, id);
    const hasContact = Boolean(lead.name || lead.email || lead.phone);
    const contact = {
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
    };
    let clientId: string;
    let clientName: string;
    let pocContactId: string | null = null;

    if (input.client.mode === "create") {
      clientName = input.client.name.trim() || lead.name;
      if (!clientName)
        throw new ApiError(400, "INVALID_REQUEST", "Enter a client name.");
      const contacts = hasContact
        ? [
            {
              name: contact.name || clientName,
              role: "primary_poc" as const,
              email: contact.email || undefined,
              phone: contact.phone || undefined,
              notes: "",
            },
          ]
        : [];
      const { visible, hidden } = await checkDuplicates(
        tx,
        actor,
        clients,
        contacts,
      );
      if (visible.length && !input.client.allowDuplicate)
        throw duplicateClientError(visible);
      clientId = await insertClient(
        tx,
        actor,
        clients,
        {
          name: clientName,
          kind: input.client.kind,
          notes: "",
          tags: [],
          contacts,
          assignedSalespersonId: lead.assignedSalespersonId,
        },
        hidden,
      );
      const [primary] = await tx
        .select({ id: clientContacts.id })
        .from(clientContacts)
        .where(eq(clientContacts.clientId, clientId));
      pocContactId = primary?.id ?? null;
    } else {
      // Locked for share: the client can't be reassigned before this commits.
      const client = await findVisibleClient(
        tx,
        actor,
        input.client.clientId,
        "share",
      ).catch(() => {
        throw new ApiError(
          400,
          "INVALID_REQUEST",
          "Choose a client you can see.",
        );
      });
      clientId = client.id;
      clientName = client.name;
      if (hasContact) {
        const existing = await tx
          .select()
          .from(clientContacts)
          .where(
            and(
              eq(clientContacts.clientId, clientId),
              isNull(clientContacts.archivedAt),
            ),
          );
        const email = lead.email.toLowerCase();
        const digits = phoneDigits(lead.phone);
        const match = existing.find(
          (row) =>
            (email !== "" && row.email.toLowerCase() === email) ||
            (digits.length >= 7 && row.phoneDigits === digits),
        );
        if (match) pocContactId = match.id;
        else {
          const clientBefore = await clientSnapshot(tx, clientId);
          const [added] = await tx
            .insert(clientContacts)
            .values({
              clientId,
              name: contact.name || clientName,
              role: existing.length === 0 ? "primary_poc" : "event_coordinator",
              email: lead.email,
              phone: lead.phone,
              phoneDigits: digits,
              notes: "",
              sortOrder: existing.length,
            })
            .returning({ id: clientContacts.id });
          pocContactId = added.id;
          // The added contact shows in the client's history (FLOW-185 AC3).
          await writeAudit(tx, actor, {
            entityType: "client",
            entityId: clientId,
            action: "update",
            before: clientBefore,
            after: await clientSnapshot(tx, clientId),
          });
          await emitDomainEvent(tx, {
            name: "client.updated",
            entityId: clientId,
          });
        }
      }
    }

    const title = clip(
      input.event.title.trim() || `${clientName} — ${lead.eventType || "Event"}`,
      200,
    );
    const [existingEvent] = input.event.existingEventId
      ? await tx.select().from(events).where(and(eq(events.id, input.event.existingEventId), eq(events.leadId, id), isNull(events.archivedAt)))
      : await tx.select().from(events).where(and(eq(events.leadId, id), isNull(events.archivedAt))).orderBy(desc(events.createdAt)).limit(1);
    if (input.event.existingEventId && !existingEvent)
      throw new ApiError(400, "INVALID_REQUEST", "Choose an event linked to this lead.");
    if (!existingEvent && (!date || !input.event.startTime))
      throw new ApiError(400, "INVALID_REQUEST", "Enter an event date and start time.");
    const eventId = existingEvent ? existingEvent.id : await insertEvent(
      tx,
      actor,
      eventInputSchema.parse({
        title,
        date: date!,
        startTime: input.event.startTime!,
        clientId,
        pocContactId,
        address: clip(lead.location, 500),
        eventType: lead.eventType,
        guestCount: lead.guestCount,
        assignedSalespersonId: lead.assignedSalespersonId ?? undefined,
        internalNotes: clip(lead.message, 5000),
        status: "inquiry",
      }),
    );
    await tx.update(events).set({ clientId, updatedBy: actor.userId })
      .where(and(eq(events.leadId, id), isNull(events.archivedAt)));
    await tx.update(events).set({ clientId, leadId: id, updatedBy: actor.userId }).where(eq(events.id, eventId));
    const linkedEventIds = (await tx.select({ id: events.id }).from(events)
      .where(and(eq(events.leadId, id), isNull(events.archivedAt)))).map((row) => row.id);
    // The proposal starts in Client communication with the event's title and
    // salesperson, before the lead is marked converted.
    const [event] = await tx
      .select({ salespersonId: events.assignedSalespersonId, title: events.title })
      .from(events)
      .where(eq(events.id, eventId));
    const [existingProposal] = await tx.select({ id: proposals.id }).from(proposals)
      .where(and(eq(proposals.eventId, eventId), isNull(proposals.archivedAt)))
      .orderBy(desc(proposals.createdAt)).limit(1);
    const proposalId = existingProposal?.id ?? await insertProposal(tx, actor, {
      eventId, clientId, title: event.title,
      assignedSalespersonId: event.salespersonId, notes: "",
    });
    if (linkedEventIds.length) await tx.update(proposals).set({ clientId, updatedBy: actor.userId })
      .where(and(inArray(proposals.eventId, linkedEventIds), isNull(proposals.clientId)));

    const converted = await tx
      .update(leads)
      .set({
        status: "closing",
        convertedClientId: clientId,
        convertedEventId: eventId,
        updatedBy: actor.userId,
      })
      .where(and(eq(leads.id, id), eq(leads.status, lead.status)))
      .returning({ id: leads.id });
    if (!converted.length) throw staleLead();
    await auditLead(tx, actor, id, before);
    await emitDomainEvent(tx, {
      name: "lead.converted",
      entityId: id,
      data: { clientId, eventId, proposalId },
    });
    return { clientId, clientName, eventId, title: event.title, proposalId };
  });

  return {
    lead: await getLead(db, actor, id),
    client: { id: result.clientId, name: result.clientName },
    event: { id: result.eventId, title: result.title },
    proposal: { id: result.proposalId, title: result.title },
  };
}
