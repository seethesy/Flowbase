import { redactFieldHistory, serializeFields } from "../../shared/visibility";
import {
  and,
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
  leadNeedsReview,
  leadStatusLabels,
  leadStatusSchema,
  leadStatusTransitions,
  openLeadStatuses,
  type Lead,
  type LeadConversion,
  type LeadIntake,
  type leadConvertSchema,
  type leadStatusChangeSchema,
} from "../../shared/leads";
import { listHistory, writeAudit } from "../audit/log";
import type { Db, DbLike } from "../db/client";
import { clientContacts, leads } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { can, clientScope, leadScope, type Scope } from "../policy";
import {
  checkDuplicates,
  clientSnapshot,
  duplicateClientError,
  findVisibleClient,
  insertClient,
  requireClientAccess,
} from "./clients";
import { insertEvent } from "./events";
import { auditLead, leadSnapshot } from "./lead-audit";
import {
  leadMatchesFor,
  recordLeadDuplicates,
  sourceLinksFor,
} from "./lead-duplicates";
import { keyset, type Page, type PageRequest } from "./paging";
import { phoneDigits } from "./sync";

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
  return paging.page(rows, (kept) => kept.map((row) => toLead(row, actor)));
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
    sourceLinks: await sourceLinksFor(db, row),
    duplicates,
    assignedElsewhere,
  };
}

// Lead history (FLOW-185), for anyone who can see the lead. Contact details are
// hidden from those who can't see them; raw payloads are never in the history.
export async function leadHistory(db: DbLike, actor: Actor, id: string) {
  await findVisibleLead(db, actor, id);
  return listHistory(db, "lead", id, (changes) =>
    redactFieldHistory(actor, "lead", changes),
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
  const ids = [...new Set(leadIds)];
  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(leads)
      .where(and(inArray(leads.id, ids), isNull(leads.archivedAt)));
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

export async function assignLead(
  db: Db,
  actor: Actor,
  id: string,
  salespersonId: string,
): Promise<Lead> {
  await bulkAssignLeads(db, actor, [id], salespersonId);
  return getLead(db, actor, id);
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
  const current = await findVisibleLead(db, actor, id);
  if (!leadStatusTransitions[current.status].includes(change.status))
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      `A ${leadStatusLabels[current.status].toLowerCase()} lead can't be marked ${leadStatusLabels[change.status].toLowerCase()}.`,
    );
  await db.transaction(async (tx) => {
    const before = await leadSnapshot(tx, id);
    const changed = await tx
      .update(leads)
      .set({
        status: change.status,
        lostReason: change.status === "lost" ? change.reason : current.lostReason,
        firstRespondedAt:
          change.status === "contacted" && !current.firstRespondedAt
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

// Converts a qualified lead into a client (new or linked), a contact and an inquiry
// event, all pre-filled from the lead, in ONE transaction: any failure leaves
// nothing behind (FLOW-112). The proposal step waits for the proposals table.
export async function convertLead(
  db: Db,
  actor: Actor,
  id: string,
  input: z.output<typeof leadConvertSchema>,
): Promise<LeadConversion> {
  const lead = await findVisibleLead(db, actor, id);
  if (lead.status === "converted")
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      "This lead was already converted.",
    );
  if (lead.status !== "qualified")
    throw new ApiError(
      409,
      "INVALID_TRANSITION",
      "Only a qualified lead can be converted.",
    );
  const date = input.event.date ?? lead.eventDate;
  if (!date) throw new ApiError(400, "INVALID_REQUEST", "Enter the event date.");
  const clients = clientScope(actor);
  requireClientAccess(actor);

  const result = await db.transaction(async (tx) => {
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
      const client = await findVisibleClient(
        tx,
        actor,
        input.client.clientId,
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
    const eventId = await insertEvent(
      tx,
      actor,
      eventInputSchema.parse({
        title,
        date,
        startTime: input.event.startTime,
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

    const converted = await tx
      .update(leads)
      .set({
        status: "converted",
        convertedClientId: clientId,
        convertedEventId: eventId,
        updatedBy: actor.userId,
      })
      .where(and(eq(leads.id, id), eq(leads.status, "qualified")))
      .returning({ id: leads.id });
    if (!converted.length) throw staleLead();
    await auditLead(tx, actor, id, before);
    await emitDomainEvent(tx, {
      name: "lead.converted",
      entityId: id,
      data: { clientId, eventId },
    });
    return { clientId, clientName, eventId, title };
  });

  return {
    lead: await getLead(db, actor, id),
    client: { id: result.clientId, name: result.clientName },
    event: { id: result.eventId, title: result.title },
  };
}
