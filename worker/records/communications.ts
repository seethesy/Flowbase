import { and, eq, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  communicationInputSchema,
  communicationTargetSchema,
  followUpDueTime,
  type Communication,
  type CommunicationInput,
} from "../../shared/communications";
import { taskInputSchema } from "../../shared/tasks";
import { businessTimeToUtc } from "../../shared/time";
import type { Db, DbLike } from "../db/client";
import { communications, tasks, users } from "../db/schema";
import { ApiError } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { findVisibleClient } from "./clients";
import { findVisibleEvent } from "./events";
import { findVisibleLead } from "./leads";
import { keyset, type Page, type PageRequest } from "./paging";
import { createTask } from "./tasks";

// Client communication log (FLOW-120). The log of a record is visible to whoever can
// open the record (a salesperson's own leads, clients and events; managers see all),
// so every read and write resolves the record through its own visibility check.
type Target = { leadId?: string; clientId?: string; eventId?: string };

// The record's name and the salesperson it is assigned to; 404 when the actor cannot
// open it.
async function findTarget(db: DbLike, actor: Actor, target: Target) {
  if (target.leadId) {
    const lead = await findVisibleLead(db, actor, target.leadId);
    return {
      name: lead.name || "lead",
      ownerId: lead.assignedSalespersonId,
      links: {},
    };
  }
  if (target.clientId) {
    const client = await findVisibleClient(db, actor, target.clientId);
    return {
      name: client.name,
      ownerId: client.assignedSalespersonId,
      links: { clientId: client.id },
    };
  }
  const event = await findVisibleEvent(db, actor, target.eventId!);
  return {
    name: event.title,
    ownerId: event.assignedSalespersonId,
    links: { eventId: event.id, clientId: event.clientId },
  };
}

type Row = {
  entry: typeof communications.$inferSelect;
  loggedBy: string | null;
  taskStatus: string | null;
  taskArchivedAt: Date | null;
};
const toCommunication = ({
  entry,
  loggedBy,
  taskStatus,
  taskArchivedAt,
}: Row): Communication => ({
  id: entry.id,
  leadId: entry.leadId,
  clientId: entry.clientId,
  eventId: entry.eventId,
  kind: entry.kind,
  occurredAt: entry.occurredAt.toISOString(),
  summary: entry.summary,
  loggedById: entry.createdBy,
  loggedByName: loggedBy ?? "",
  followUpDate: entry.followUpDate,
  followUpTaskId: entry.followUpTaskId,
  followUpOpen:
    taskStatus !== null && taskStatus !== "done" && taskArchivedAt === null,
  createdAt: entry.createdAt.toISOString(),
});

const selectRows = (db: DbLike) =>
  db
    .select({
      entry: communications,
      loggedBy: users.name,
      taskStatus: tasks.status,
      taskArchivedAt: tasks.archivedAt,
    })
    .from(communications)
    .leftJoin(users, eq(users.id, communications.createdBy))
    .leftJoin(tasks, eq(tasks.id, communications.followUpTaskId));

// Newest first, with who logged each entry.
export async function listCommunications(
  db: DbLike,
  actor: Actor,
  target: Target,
  page: PageRequest = {},
): Promise<Page<Communication>> {
  const parsed = communicationTargetSchema.safeParse(target);
  if (!parsed.success)
    throw new ApiError(400, "INVALID_REQUEST", parsed.error.issues[0].message);
  await findTarget(db, actor, target);
  const paging = keyset<Row>(
    [
      {
        column: communications.occurredAt,
        type: "timestamp",
        desc: true,
        of: (row) => row.entry.occurredAt,
      },
      {
        column: communications.id,
        type: "uuid",
        desc: true,
        of: (row) => row.entry.id,
      },
    ],
    page,
  );
  const rows = await selectRows(db)
    .where(
      and(
        isNull(communications.archivedAt),
        target.leadId ? eq(communications.leadId, target.leadId) : undefined,
        target.clientId
          ? eq(communications.clientId, target.clientId)
          : undefined,
        target.eventId ? eq(communications.eventId, target.eventId) : undefined,
        paging.where,
      ),
    )
    .orderBy(...paging.orderBy)
    .limit(paging.limit);
  return paging.page(rows, (kept) => kept.map(toCommunication));
}

// Logs a conversation. With a follow-up date it also creates a task for the
// record's salesperson (the actor when none is assigned), due at the end of that
// day, in the same transaction.
export async function logCommunication(
  db: Db,
  actor: Actor,
  input: CommunicationInput,
): Promise<Communication> {
  const entry = communicationInputSchema.parse(input);
  const id = await db.transaction(async (tx) => {
    const record = await findTarget(tx, actor, entry);
    let followUpTaskId: string | null = null;
    if (entry.followUpDate) {
      followUpTaskId = await createTask(
        tx,
        actor,
        taskInputSchema.parse({
          title: `Follow up: ${record.name}`,
          description: entry.summary,
          dueAt: businessTimeToUtc(
            entry.followUpDate,
            followUpDueTime,
          ).toISOString(),
          assigneeIds: [record.ownerId ?? actor.userId],
          ...record.links,
        }),
      );
    }
    const [row] = await tx
      .insert(communications)
      .values({
        leadId: entry.leadId ?? null,
        clientId: entry.clientId ?? null,
        eventId: entry.eventId ?? null,
        kind: entry.kind,
        occurredAt: entry.occurredAt ? new Date(entry.occurredAt) : new Date(),
        summary: entry.summary,
        followUpDate: entry.followUpDate,
        followUpTaskId,
        createdBy: actor.userId,
        updatedBy: actor.userId,
      })
      .returning({ id: communications.id });
    await emitDomainEvent(tx, {
      name: "communication.logged",
      entityId: row.id,
      data: { kind: entry.kind },
    });
    return row.id;
  });
  const [row] = await selectRows(db).where(eq(communications.id, id));
  return toCommunication(row);
}
