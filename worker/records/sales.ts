import { and, asc, eq, inArray, isNull, max, or, type SQL } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { SalesRow } from "../../shared/sales";
import type { DbLike } from "../db/client";
import { auditLog, clients, communications, events, leads, payments, tasks, paymentScheduleItems, proposalMappings, proposals, proposalVersionMappings, proposalVersions, users, salesViews } from "../db/schema";
import { forbidden, notFound, ApiError } from "../hono";
import { visibleClients } from "./clients";
import { visibleLeads } from "./leads";
import { visibleEvents } from "./events";
import { clientScope } from "../policy";
import { salesFilterSchema, type SalesFilter } from "../../shared/sales";
import { utcToBusinessTime } from "../../shared/time";

const authorized = (actor: Actor) => {
  if (clientScope(actor) !== "all" && clientScope(actor) !== "own") throw forbidden();
};
const sumBy = <T>(rows: T[], id: (row: T) => string, cents: (row: T) => number) => {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(id(row), (totals.get(id(row)) ?? 0) + cents(row));
  return totals;
};

// Query each owned root before loading children. This also scopes every export and
// aggregate because both consume this same dataset, never an unscoped browser cache.
export async function salesDataset(db: DbLike, actor: Actor) {
  authorized(actor);
  const [clientRows, eventRows, leadRows, people] = await Promise.all([
    db.select().from(clients).where(and(visibleClients(actor), isNull(clients.archivedAt))),
    db.select().from(events).where(and(visibleEvents(actor), isNull(events.archivedAt))),
    db.select().from(leads).where(and(visibleLeads(actor), isNull(leads.archivedAt))),
    db.select({ id: users.id, name: users.name }).from(users),
  ]);
  const eventIds = eventRows.map((row) => row.id);
  const [proposalRows, scheduleRows, paymentRows] = await Promise.all([
    eventIds.length ? db.select().from(proposals).where(and(inArray(proposals.eventId, eventIds), isNull(proposals.archivedAt), clientScope(actor) === "own" ? eq(proposals.assignedSalespersonId, actor.userId) : undefined)) : [],
    eventIds.length ? db.select().from(paymentScheduleItems).where(and(inArray(paymentScheduleItems.eventId, eventIds), isNull(paymentScheduleItems.archivedAt))) : [],
    eventIds.length ? db.select().from(payments).where(and(inArray(payments.eventId, eventIds), isNull(payments.archivedAt))) : [],
  ]);
  const proposalIds = proposalRows.map((row) => row.id);
  const [mappingRows, versionRows] = await Promise.all([
    proposalIds.length ? db.select().from(proposalMappings).where(inArray(proposalMappings.proposalId, proposalIds)) : [],
    proposalIds.length ? db.select().from(proposalVersions).where(and(inArray(proposalVersions.proposalId, proposalIds), eq(proposalVersions.status, "ready"))) : [],
  ]);
  const visibleIds = [...clientRows, ...eventRows, ...leadRows, ...proposalRows].map((row) => row.id);
  const activities = visibleIds.length ? await db.select({ entityType: auditLog.entityType, entityId: auditLog.entityId, at: max(auditLog.createdAt) })
    .from(auditLog).where(inArray(auditLog.entityId, visibleIds)).groupBy(auditLog.entityType, auditLog.entityId) : [];
  const lastActivities = new Map(activities.map((row) => [`${row.entityType}:${row.entityId}`, row.at]));
  // Logged conversations (FLOW-120): the latest one counts as activity, and the
  // earliest open follow-up task is the next follow-up.
  const logged = new Map<string, { at: Date; followUp: Date | null }>();
  const loggedFor = [
    leadRows.length ? inArray(communications.leadId, leadRows.map((row) => row.id)) : undefined,
    clientRows.length ? inArray(communications.clientId, clientRows.map((row) => row.id)) : undefined,
    eventRows.length ? inArray(communications.eventId, eventIds) : undefined,
  ].filter((condition): condition is SQL => condition !== undefined);
  const communicationRows = loggedFor.length ? await db
    .select({ leadId: communications.leadId, clientId: communications.clientId, eventId: communications.eventId,
      at: communications.occurredAt, dueAt: tasks.dueAt, status: tasks.status, taskArchivedAt: tasks.archivedAt })
    .from(communications).leftJoin(tasks, eq(tasks.id, communications.followUpTaskId))
    .where(and(isNull(communications.archivedAt), or(...loggedFor))) : [];
  for (const row of communicationRows) {
    const key = row.leadId ? `lead:${row.leadId}` : row.clientId ? `client:${row.clientId}` : `event:${row.eventId}`;
    const open = row.dueAt && row.status !== "done" && !row.taskArchivedAt ? row.dueAt : null;
    const current = logged.get(key);
    logged.set(key, {
      at: current && current.at > row.at ? current.at : row.at,
      followUp: open && (!current?.followUp || open < current.followUp) ? open : current?.followUp ?? null,
    });
  }
  const last = (kind: string, id: string, updated: Date) => {
    const audit = lastActivities.get(`${kind}:${id}`);
    const conversation = logged.get(`${kind}:${id}`);
    return new Date(Math.max(updated.getTime(), audit?.getTime() ?? 0, conversation?.at.getTime() ?? 0)).toISOString();
  };
  const nextFollowUp = (kind: string, id: string) => logged.get(`${kind}:${id}`)?.followUp?.toISOString() ?? null;
  const clientNames = new Map(clientRows.map((row) => [row.id, row.name]));
  const owners = new Map(people.map((row) => [row.id, row.name]));
  const sources = new Map(leadRows.filter((row) => row.convertedEventId).map((row) => [row.convertedEventId!, row.source]));
  const scheduled = sumBy(scheduleRows, (row) => row.eventId, (row) => row.amountCents);
  const received = sumBy(paymentRows, (row) => row.eventId, (row) => row.amountCents);
  const mappings = new Map(mappingRows.map((row) => [row.proposalId, row]));
  const currentVersions = new Map(versionRows.map((row) => [row.id, row]));
  const proposalsByEvent = new Map<string, typeof proposalRows>();
  for (const proposal of proposalRows) proposalsByEvent.set(proposal.eventId, [...(proposalsByEvent.get(proposal.eventId) ?? []), proposal]);
  for (const list of proposalsByEvent.values()) list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  const money = (eventId: string, total: number | null) => ({
    totalCents: total, receivedCents: received.get(eventId) ?? 0,
    balanceCents: scheduled.has(eventId) ? scheduled.get(eventId)! - (received.get(eventId) ?? 0) : null,
  });
  const proposalTotal = (proposal: typeof proposalRows[number]) => {
    const mapping = mappings.get(proposal.id);
    return mapping?.versionId === proposal.currentVersionId ? mapping.data.totalCents ?? null : null;
  };
  const eventTotal = (eventId: string) => {
    const choices = proposalsByEvent.get(eventId) ?? [];
    const selected = choices.find((proposal) => proposal.stage === "signed") ?? choices.find((proposal) => proposal.stage !== "lost");
    return selected ? proposalTotal(selected) : null;
  };
  const rows: SalesRow[] = [];
  for (const lead of leadRows) if (["new", "contacted", "qualified"].includes(lead.status)) rows.push({
    id: lead.id, kind: "lead", clientId: lead.convertedClientId, client: lead.name,
    eventId: lead.convertedEventId, title: lead.name, eventDate: lead.eventDate,
    eventType: lead.eventType, stage: lead.status, ownerId: lead.assignedSalespersonId,
    owner: owners.get(lead.assignedSalespersonId ?? "") ?? null, source: lead.source,
    totalCents: null, receivedCents: null, balanceCents: null,
    lastActivity: last("lead", lead.id, lead.updatedAt), nextFollowUp: nextFollowUp("lead", lead.id), bookedAt: null,
    eventStatus: null, leadStatus: lead.status, proposalStage: null, versionNumber: null,
  });
  for (const client of clientRows) rows.push({
    id: client.id, kind: "client", clientId: client.id, client: client.name,
    eventId: null, title: client.name, eventDate: null, eventType: "", stage: "Client",
    ownerId: client.assignedSalespersonId, owner: owners.get(client.assignedSalespersonId ?? "") ?? null,
    source: null, totalCents: null, receivedCents: null, balanceCents: null,
    lastActivity: last("client", client.id, client.updatedAt), nextFollowUp: nextFollowUp("client", client.id), bookedAt: null,
    eventStatus: null, leadStatus: null, proposalStage: null, versionNumber: null,
  });
  for (const event of eventRows) {
    const total = eventTotal(event.id);
    const common = {
      clientId: event.clientId, client: clientNames.get(event.clientId) ?? "Client",
      eventId: event.id, eventDate: utcToBusinessTime(event.startsAt).date,
      eventType: event.eventType, source: sources.get(event.id) ?? null,
      bookedAt: event.bookedAt?.toISOString() ?? null, eventStatus: event.status,
      leadStatus: null,
    };
    rows.push({ ...common, id: event.id, kind: "event", title: event.title, stage: event.status,
      ownerId: event.assignedSalespersonId, owner: owners.get(event.assignedSalespersonId ?? "") ?? null,
      ...money(event.id, total), lastActivity: last("event", event.id, event.updatedAt), nextFollowUp: nextFollowUp("event", event.id), proposalStage: null, versionNumber: null });
    for (const proposal of proposalsByEvent.get(event.id) ?? []) rows.push({
      ...common, nextFollowUp: null, id: proposal.id, kind: "proposal", title: proposal.title,
      stage: proposal.stage, ownerId: proposal.assignedSalespersonId,
      owner: owners.get(proposal.assignedSalespersonId ?? "") ?? null,
      ...money(event.id, proposalTotal(proposal)), lastActivity: last("proposal", proposal.id, proposal.updatedAt),
      proposalStage: proposal.stage, versionNumber: currentVersions.get(proposal.currentVersionId ?? "")?.number ?? null,
    });
  }
  return { rows, clientRows, eventRows, proposalRows, versionRows, money, eventTotal };
}

export async function salesClient(db: DbLike, actor: Actor, clientId: string) {
  const data = await salesDataset(db, actor);
  if (!data.clientRows.some((client) => client.id === clientId)) throw notFound("Client");
  const clientEvents = data.eventRows.filter((event) => event.clientId === clientId).sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
  const ids = data.versionRows.map((version) => version.id);
  const snapshots = ids.length ? await db.select().from(proposalVersionMappings).where(inArray(proposalVersionMappings.versionId, ids)) : [];
  const totals = new Map(snapshots.map((snapshot) => [snapshot.versionId, snapshot.data.totalCents ?? null]));
  const eventList = clientEvents.map((event) => ({
    eventId: event.id, title: event.title, status: event.status,
    eventDate: utcToBusinessTime(event.startsAt).date, bookedAt: event.bookedAt?.toISOString() ?? null,
    ...data.money(event.id, data.eventTotal(event.id)),
    proposals: data.proposalRows.filter((proposal) => proposal.eventId === event.id).map((proposal) => ({
      id: proposal.id, title: proposal.title, stage: proposal.stage,
      versions: data.versionRows.filter((version) => version.proposalId === proposal.id).map((version) => ({
        id: version.id, number: version.number!, totalCents: totals.get(version.id) ?? null,
      })).sort((a, b) => b.number - a.number),
    })),
  }));
  return { clientId, events: eventList, eventCount: eventList.length,
    lifetimeBookedCents: eventList.filter((event) => ["closed", "preparation", "finished"].includes(event.status))
      .reduce((sum, event) => sum + (event.totalCents ?? 0), 0) };
}

export async function salesReport(db: DbLike, actor: Actor, range: { from?: string; to?: string }) {
  const data = await salesDataset(db, actor);
  const within = (date: string) => (!range.from || date >= range.from) && (!range.to || date <= range.to);
  const proposalRows = data.rows.filter((row) => row.kind === "proposal" && row.eventDate && within(row.eventDate));
  const eventRows = data.rows.filter((row) => row.kind === "event" && row.eventDate && within(row.eventDate) && ["closed", "preparation", "finished"].includes(row.eventStatus ?? ""));
  const pipeline = [...new Set(proposalRows.map((row) => row.proposalStage!))].sort().map((stage) => {
    const rows = proposalRows.filter((row) => row.proposalStage === stage);
    return { stage, count: rows.length, totalCents: rows.reduce((sum, row) => sum + (row.totalCents ?? 0), 0) };
  });
  const months = [...new Set(eventRows.map((row) => row.eventDate!.slice(0, 7)))].sort();
  const bookedByMonth = months.map((month) => {
    const rows = eventRows.filter((row) => row.eventDate!.startsWith(month));
    return { month, count: rows.length, totalCents: rows.reduce((sum, row) => sum + (row.totalCents ?? 0), 0) };
  });
  const decided = proposalRows.filter((row) => row.proposalStage === "signed" || row.proposalStage === "lost");
  const win = (key: "owner" | "source") => [...new Set(decided.map((row) => row[key] ?? "Unassigned"))].sort().map((value) => {
    const rows = decided.filter((row) => (row[key] ?? "Unassigned") === value);
    const wins = rows.filter((row) => row.proposalStage === "signed").length;
    return { [key]: value, wins, decided: rows.length, rate: rows.length ? wins / rows.length : null };
  });
  return { pipeline, bookedByMonth, winBySalesperson: win("owner"), winBySource: win("source") };
}

export async function listSalesViews(db: DbLike, actor: Actor) {
  authorized(actor);
  const rows = await db.select().from(salesViews).where(and(eq(salesViews.userId, actor.userId), isNull(salesViews.archivedAt))).orderBy(asc(salesViews.createdAt));
  return rows.map((row) => ({ id: row.id, name: row.name, filter: salesFilterSchema.parse(row.filter), createdAt: row.createdAt.toISOString() }));
}
export async function createSalesView(db: DbLike, actor: Actor, input: { name: string; filter: SalesFilter }) {
  authorized(actor);
  const existing = await listSalesViews(db, actor);
  if (existing.length >= 20) throw new ApiError(400, "VIEW_LIMIT", "You can save up to 20 sales views.");
  const [row] = await db.insert(salesViews).values({ userId: actor.userId, name: input.name, filter: input.filter, createdBy: actor.userId, updatedBy: actor.userId }).returning();
  return { id: row.id, name: row.name, filter: salesFilterSchema.parse(row.filter), createdAt: row.createdAt.toISOString() };
}
export async function deleteSalesView(db: DbLike, actor: Actor, id: string) {
  authorized(actor);
  const [row] = await db.update(salesViews).set({ archivedAt: new Date(), updatedBy: actor.userId }).where(and(eq(salesViews.id, id), eq(salesViews.userId, actor.userId), isNull(salesViews.archivedAt))).returning({ id: salesViews.id });
  if (!row) throw notFound("View");
}
