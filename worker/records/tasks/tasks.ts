import {
  and,
  asc,
  count,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../../shared/access";
import { businessDefaultsSchema, defaultBusinessDefaults } from "../../../shared/settings";
import {
  completion,
  DASHBOARD_SECTION_SIZE,
  dueBucket,
  dueBounds,
  NEEDS_DELEGATION_DAYS,
  type ChecklistItemUpdate,
  type Task,
  type TaskDashboard,
  type TaskDashboardSection,
  type TaskDueBucket,
  type TaskFilter,
  type TaskPerson,
  type TaskSummary,
  type TaskUpdate,
  type taskInputSchema,
} from "../../../shared/tasks";
import { writeAudit } from "../../audit/log";
import type { DbLike } from "../../db/client";
import {
  clients,
  events,
  jobs,
  taskAssignees,
  taskManagers,
  taskChecklistItems,
  taskComments,
  tasks,
  settings,
  users,
} from "../../db/schema";
import { ApiError, forbidden, notFound } from "../../hono";
import { emitDomainEvent } from "../../jobs/queue";
import { can, mayManageTask, taskScope } from "../../policy";
import { addLocalDays, businessTimeToUtc, utcToBusinessTime } from "../../../shared/time";
import { findVisibleClient } from "../sales/clients";
import { findVisibleEvent, visibleEvents } from "../events/events";
import { findItem } from "../inventory/inventory-items";
import { findSop } from "./sops";
import { groupBy, indexBy, keyset, type Page, type PageRequest } from "../core/paging";

// Task engine (FLOW-58). This is the service every module uses to create and
// update tasks; there are no task tables per module. createTask and updateTask
// take the caller's transaction, so a module creates its kitchen, production or
// truck-loading tasks in the same transaction as its own change. actor is null
// when the system creates or changes a task on its own.
//
// Every change writes an audit row (entity "task"), and a change of assignees
// emits task.assigned with the users added and removed (AC2), which is how the
// new assignees are notified (FLOW-43). Claiming emits task.claimed for the
// managers, and moving to done emits task.completed (FLOW-59/60).

type TaskRow = typeof tasks.$inferSelect;
export type NewTask = z.output<typeof taskInputSchema>;

const assignedTo = (userId: string) =>
  sql`exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.userId} = ${userId} and ${taskAssignees.archivedAt} is null)`;
const managedBy = (userId: string) =>
  sql`exists (select 1 from ${taskManagers} where ${taskManagers.taskId} = ${tasks.id} and ${taskManagers.userId} = ${userId} and ${taskManagers.archivedAt} is null)`;
const unassigned = sql`not exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.archivedAt} is null)`;

// Tasks this user is assigned to, manages or created (also the calendar's
// "their tasks", FLOW-63).
export const involving = (userId: string) =>
  or(eq(tasks.createdBy, userId), managedBy(userId), assignedTo(userId));

// Everyone also sees the open unassigned tasks, so any employee can pick one up
// (FLOW-272). Assigned tasks stay limited by taskScope.
export function visibleTasks(actor: Actor): SQL | undefined {
  return taskScope(actor) === "all"
    ? undefined
    : or(
        involving(actor.userId),
        and(unassigned, ne(tasks.status, "done")),
      );
}

// Tasks in one due bucket (shared/tasks.ts dueBucket) as of now.
function dueIn(bucket: TaskDueBucket, now: Date): SQL | undefined {
  const { tomorrow } = dueBounds(now);
  if (bucket === "overdue") return lt(tasks.dueAt, now);
  if (bucket === "today") return and(gte(tasks.dueAt, now), lt(tasks.dueAt, tomorrow));
  return or(isNull(tasks.dueAt), gte(tasks.dueAt, tomorrow));
}

// The conditions of a task list: visibility, then every given filter.
function listWhere(actor: Actor, filter: TaskFilter, now: Date) {
  return and(
    isNull(tasks.archivedAt),
    visibleTasks(actor),
    filter.mine ? involving(actor.userId) : undefined,
    filter.type ? eq(tasks.type, filter.type) : undefined,
    filter.status
      ? eq(tasks.status, filter.status)
      : filter.includeDone
        ? undefined
        : ne(tasks.status, "done"),
    filter.eventId ? eq(tasks.eventId, filter.eventId) : undefined,
    filter.assigneeId ? assignedTo(filter.assigneeId) : undefined,
    filter.overseerId ? managedBy(filter.overseerId) : undefined,
    filter.unassigned ? unassigned : undefined,
    filter.due ? dueIn(filter.due, now) : undefined,
  );
}

async function findTaskRow(
  db: DbLike,
  actor: Actor | null,
  id: string,
  lock = false,
) {
  const query = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.id, id),
        isNull(tasks.archivedAt),
        actor ? visibleTasks(actor) : undefined,
      ),
    );
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw notFound("Task");
  return row;
}

// For other modules (attachments): the task, if the actor may see it.
export const findVisibleTask = (db: DbLike, actor: Actor, id: string) =>
  findTaskRow(db, actor, id);

async function assigneeIdsOf(db: DbLike, taskId: string) {
  const rows = await db
    .select({ userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(and(eq(taskAssignees.taskId, taskId), isNull(taskAssignees.archivedAt)))
    .orderBy(asc(taskAssignees.createdAt), asc(taskAssignees.userId));
  return rows.map((row) => row.userId);
}
async function managerIdsOf(db: DbLike, taskId: string) {
  const rows = await db.select({ userId: taskManagers.userId }).from(taskManagers)
    .where(and(eq(taskManagers.taskId, taskId), isNull(taskManagers.archivedAt)))
    .orderBy(asc(taskManagers.createdAt), asc(taskManagers.userId));
  return rows.map((row) => row.userId);
}

async function defaultManagerIds(db: DbLike) {
  const [stored] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "defaults"));
  const parsed = businessDefaultsSchema.safeParse(stored?.value);
  const setting = (parsed.success ? parsed.data : defaultBusinessDefaults).defaultTaskManagers;
  if (setting.mode === "people") {
    if (!setting.userIds.length) return [];
    const rows = await db.select({ id: users.id }).from(users).where(and(
      inArray(users.id, setting.userIds), eq(users.status, "active"), eq(users.role, "admin"), eq(users.hasAccount, true), isNull(users.archivedAt),
    ));
    return setting.userIds.filter((id) => rows.some((row) => row.id === id));
  }
  const rows = await db.select({ id: users.id }).from(users)
    .where(and(eq(users.role, "admin"), eq(users.hasAccount, true), eq(users.status, "active"), isNull(users.archivedAt)));
  return rows.map((row) => row.id);
}

// New assignees and managers must be active staff.
async function assertPeople(db: DbLike, ids: string[]) {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return;
  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, wanted),
        eq(users.status, "active"),
        isNull(users.archivedAt),
      ),
    );
  if (found.length !== wanted.length)
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      "Assign tasks to active staff only.",
    );
}
async function assertManagers(db: DbLike, ids: string[]) {
  const wanted = [...new Set(ids)];
  if (!wanted.length) return;
  const found = await db.select({ id: users.id }).from(users).where(and(inArray(users.id, wanted),
    eq(users.status, "active"), eq(users.role, "admin"), eq(users.hasAccount, true), isNull(users.archivedAt)));
  if (found.length !== wanted.length) throw new ApiError(400, "INVALID_REQUEST", "Choose active Admin accounts as managers.");
}

// Linked records must exist, and a person may link only records they can open.
async function assertLinks(
  db: DbLike,
  actor: Actor | null,
  links: { eventId?: string | null; clientId?: string | null; inventoryItemId?: string | null; sopId?: string | null },
) {
  if (links.eventId) {
    if (actor) await findVisibleEvent(db, actor, links.eventId);
    else {
      const [row] = await db
        .select({ id: events.id })
        .from(events)
        .where(eq(events.id, links.eventId));
      if (!row) throw notFound("Event");
    }
  }
  if (links.clientId) {
    if (actor) await findVisibleClient(db, actor, links.clientId);
    else {
      const [row] = await db
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, links.clientId));
      if (!row) throw notFound("Client");
    }
  }
  if (links.inventoryItemId) await findItem(db, links.inventoryItemId);
  if (links.sopId) await findSop(db, links.sopId);
}

// Only people who may delegate assign tasks to, or name as manager, anyone but
// themselves. Already-assigned people may stay.
function assertDelegation(
  actor: Actor | null,
  added: string[],
  managerIds: string[] | undefined,
  currentManagerIds: string[] = [],
  isManager = false,
) {
  if (!actor || can(actor, "tasks.delegate") || isManager) return;
  const others =
    added.some((userId) => userId !== actor.userId) ||
    (managerIds ?? []).some((id) => !currentManagerIds.includes(id) && id !== actor.userId);
  if (others)
    throw new ApiError(
      403,
      "FORBIDDEN",
      "Only managers and full-time staff can assign tasks to other people.",
    );
}

// The task as an audit snapshot: its fields by API name, assignees and checklist.
async function taskSnapshot(db: DbLike, id: string) {
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  const checklist = await db
    .select()
    .from(taskChecklistItems)
    .where(
      and(
        eq(taskChecklistItems.taskId, id),
        isNull(taskChecklistItems.archivedAt),
      ),
    )
    .orderBy(asc(taskChecklistItems.sortOrder), asc(taskChecklistItems.createdAt));
  return {
    title: row.title,
    description: row.description,
    notes: row.notes,
    type: row.type,
    status: row.status,
    priority: row.priority,
    dueAt: row.dueAt?.toISOString() ?? null,
    assigneeIds: (await assigneeIdsOf(db, id)).sort(),
    managerIds: (await managerIdsOf(db, id)).sort(),
    eventId: row.eventId,
    clientId: row.clientId,
    inventoryItemId: row.inventoryItemId,
    beoId: row.beoId,
    sopId: row.sopId,
    position: row.position,
    checklist: checklist.map((item) => ({
      label: item.label,
      done: item.doneAt !== null,
    })),
    completedAt: row.completedAt?.toISOString() ?? null,
    completedBy: row.completedBy,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

async function emitAssigned(
  db: DbLike,
  actor: Actor | null,
  taskId: string,
  added: string[],
  removed: string[],
) {
  if (!added.length && !removed.length) return;
  await emitDomainEvent(db, {
    name: "task.assigned",
    entityId: taskId,
    data: {
      addedUserIds: added,
      removedUserIds: removed,
      actorId: actor?.userId ?? null,
    },
  });
}

async function emitCompleted(db: DbLike, actor: Actor | null, taskId: string) {
  await emitDomainEvent(db, {
    name: "task.completed",
    entityId: taskId,
    data: { actorId: actor?.userId ?? null },
  });
}

// Creates a task in the caller's transaction and returns its id. templateItemId
// is set only by applying a template (task-templates.ts).
export async function createTask(
  db: DbLike,
  actor: Actor | null,
  input: Omit<NewTask, "sopId" | "notes"> & { sopId?: string | null; notes?: string },
  { templateItemId = null }: { templateItemId?: string | null } = {},
): Promise<string> {
  const managerIds = input.managerIds ?? (input.overseerId ? [input.overseerId] : await defaultManagerIds(db));
  assertDelegation(actor, input.assigneeIds, input.managerIds ?? (input.overseerId ? [input.overseerId] : undefined));
  await assertPeople(db, [
    ...input.assigneeIds,
  ]);
  if (actor) await assertManagers(db, managerIds);
  await assertLinks(db, actor, input);
  const by = actor?.userId ?? null;
  const now = new Date();
  const [row] = await db
    .insert(tasks)
    .values({
      title: input.title,
      description: input.description,
      notes: input.notes ?? "",
      type: input.type,
      status: input.status,
      priority: input.priority,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      eventId: input.eventId,
      clientId: input.clientId,
      inventoryItemId: input.inventoryItemId,
      beoId: input.beoId,
      sopId: input.sopId ?? null,
      position: input.position || null,
      templateItemId,
      ...completion(
        { status: "todo", completedAt: null, completedBy: null },
        input.status,
        by,
        now,
      ),
      createdBy: by,
      updatedBy: by,
    })
    .returning();
  if (input.assigneeIds.length)
    await db.insert(taskAssignees).values(
      input.assigneeIds.map((userId) => ({
        taskId: row.id,
        userId,
        createdBy: by,
        updatedBy: by,
      })),
    );
  if (managerIds.length)
    await db.insert(taskManagers).values(managerIds.map((userId) => ({
      taskId: row.id, userId, createdBy: by, updatedBy: by,
    })));
  if (input.checklist.length)
    await db.insert(taskChecklistItems).values(
      input.checklist.map((label, sortOrder) => ({
        taskId: row.id,
        label,
        sortOrder,
        createdBy: by,
        updatedBy: by,
      })),
    );
  await writeAudit(db, actor, {
    entityType: "task",
    entityId: row.id,
    action: "create",
    before: null,
    after: await taskSnapshot(db, row.id),
  });
  await emitAssigned(db, actor, row.id, input.assigneeIds, []);
  if (input.status === "done") await emitCompleted(db, actor, row.id);
  return row.id;
}

const managedFields: (keyof TaskUpdate)[] = [
  "title",
  "description",
  "type",
  "priority",
  "dueAt",
  "assigneeIds",
  "overseerId",
  "managerIds",
  "eventId",
  "clientId",
  "inventoryItemId",
  "beoId",
  "sopId",
  "position",
];

// Updates a task in the caller's transaction. Anyone who can see the task may
// change its status; its other fields need mayManageTask.
export async function updateTask(
  db: DbLike,
  actor: Actor | null,
  id: string,
  patch: TaskUpdate,
) {
  const row = await findTaskRow(db, actor, id, true);
  const changing = managedFields.filter((key) => patch[key] !== undefined);
  const currentManagers = await managerIdsOf(db, id);
  if (actor && changing.length && !mayManageTask(actor, { createdBy: row.createdBy, managerIds: currentManagers })) throw forbidden();
  if (actor && patch.notes !== undefined && !mayManageTask(actor, { createdBy: row.createdBy, managerIds: currentManagers }) && !await assigneeIdsOf(db, id).then((ids) => ids.includes(actor.userId))) throw forbidden();
  const before = await taskSnapshot(db, id);
  const current = before.assigneeIds;
  const next = patch.assigneeIds ?? current;
  const added = next.filter((userId) => !current.includes(userId));
  const removed = current.filter((userId) => !next.includes(userId));
  const nextManagers = patch.managerIds ?? (patch.overseerId !== undefined ? (patch.overseerId ? [patch.overseerId] : []) : currentManagers);
  const addedManagers = nextManagers.filter((userId) => !currentManagers.includes(userId));
  const removedManagers = currentManagers.filter((userId) => !nextManagers.includes(userId));
  assertDelegation(actor, added, nextManagers, currentManagers, currentManagers.includes(actor?.userId ?? ""));
  await assertPeople(db, [
    ...added,
  ]);
  if (actor && (patch.managerIds !== undefined || patch.overseerId !== undefined)) await assertManagers(db, nextManagers);
  await assertLinks(db, actor, {
    eventId: patch.eventId !== row.eventId ? patch.eventId : undefined,
    clientId: patch.clientId !== row.clientId ? patch.clientId : undefined,
    inventoryItemId:
      patch.inventoryItemId !== row.inventoryItemId
        ? patch.inventoryItemId
        : undefined,
    sopId: patch.sopId !== row.sopId ? patch.sopId : undefined,
  });
  const by = actor?.userId ?? null;
  const now = new Date();
  const fields = {
    title: patch.title,
    description: patch.description,
    notes: patch.notes,
    type: patch.type,
    status: patch.status,
    priority: patch.priority,
    eventId: patch.eventId,
    clientId: patch.clientId,
    inventoryItemId: patch.inventoryItemId,
    beoId: patch.beoId,
    sopId: patch.sopId,
    position: patch.position === undefined ? undefined : patch.position || null,
  };
  await db
    .update(tasks)
    .set({
      // Drizzle leaves undefined fields unchanged.
      ...fields,
      ...(patch.dueAt !== undefined && {
        dueAt: patch.dueAt ? new Date(patch.dueAt) : null,
      }),
      ...(patch.status !== undefined && completion(row, patch.status, by, now)),
      updatedBy: by,
    })
    .where(eq(tasks.id, id));
  if (removed.length)
    await db
      .update(taskAssignees)
      .set({ archivedAt: now, updatedBy: by })
      .where(
        and(
          eq(taskAssignees.taskId, id),
          inArray(taskAssignees.userId, removed),
          isNull(taskAssignees.archivedAt),
        ),
      );
  if (added.length)
    await db.insert(taskAssignees).values(
      added.map((userId) => ({ taskId: id, userId, createdBy: by, updatedBy: by })),
    );
  if (removedManagers.length)
    await db.update(taskManagers).set({ archivedAt: now, updatedBy: by }).where(and(
      eq(taskManagers.taskId, id), inArray(taskManagers.userId, removedManagers), isNull(taskManagers.archivedAt),
    ));
  if (addedManagers.length)
    await db.insert(taskManagers).values(addedManagers.map((userId) => ({
      taskId: id, userId, createdBy: by, updatedBy: by,
    })));
  await writeAudit(db, actor, {
    entityType: "task",
    entityId: id,
    action: "update",
    before,
    after: await taskSnapshot(db, id),
  });
  await emitAssigned(db, actor, id, added, removed);
  if (patch.status === "done" && row.status !== "done")
    await emitCompleted(db, actor, id);
}

// Pick up joins the current assignees; Drop removes only the caller.
export async function claimTask(
  db: DbLike,
  actor: Actor,
  id: string,
  _options: { unassignedOnly?: boolean } = {},
) {
  void _options; // Accepted for older clients; joining no longer needs this guard.
  // The row is locked, so two pickers run one after the other and the second
  // sees the first one's assignee.
  const row = await findTaskRow(db, actor, id, true);
  if (row.status === "done")
    throw new ApiError(409, "TASK_DONE", "This task is already done.");
  const before = await taskSnapshot(db, id);
  if (before.assigneeIds.includes(actor.userId)) return;
  await assertPeople(db, [actor.userId]);
  await db.insert(taskAssignees).values({
    taskId: id,
    userId: actor.userId,
    createdBy: actor.userId,
    updatedBy: actor.userId,
  });
  await db.update(tasks).set({ updatedBy: actor.userId }).where(eq(tasks.id, id));
  await writeAudit(db, actor, {
    entityType: "task",
    entityId: id,
    action: "update",
    before,
    after: await taskSnapshot(db, id),
  });
  await emitAssigned(db, actor, id, [actor.userId], []);
  await emitDomainEvent(db, {
    name: "task.claimed",
    entityId: id,
    data: { actorId: actor.userId },
  });
}

export async function dropTask(db: DbLike, actor: Actor, id: string) {
  await findTaskRow(db, actor, id, true);
  const before = await taskSnapshot(db, id);
  if (!before.assigneeIds.includes(actor.userId)) return;
  await db.update(taskAssignees).set({ archivedAt: new Date(), updatedBy: actor.userId })
    .where(and(eq(taskAssignees.taskId, id), eq(taskAssignees.userId, actor.userId), isNull(taskAssignees.archivedAt)));
  await db.update(tasks).set({ updatedBy: actor.userId }).where(eq(tasks.id, id));
  await writeAudit(db, actor, { entityType: "task", entityId: id, action: "update", before, after: await taskSnapshot(db, id) });
  await emitAssigned(db, actor, id, [], [actor.userId]);
}

export async function taskAssignments(db: DbLike, actor: Actor, id: string) {
  await findTaskRow(db, actor, id);
  const rows = await db.select().from(taskAssignees).where(eq(taskAssignees.taskId, id));
  const person = await peopleOf(db, rows.flatMap((row) => [row.userId, row.createdBy, row.updatedBy]));
  return rows.flatMap((row) => [
    { id: `${row.id}:added`, user: person(row.userId)!, action: "added" as const,
      actor: person(row.createdBy), at: row.createdAt.toISOString() },
    ...(row.archivedAt ? [{ id: `${row.id}:removed`, user: person(row.userId)!, action: "removed" as const,
      actor: person(row.updatedBy), at: row.archivedAt.toISOString() }] : []),
  ]).sort((a, b) => a.at.localeCompare(b.at));
}

// Archives a task (it leaves every list). Needs mayManageTask.
export async function setTaskArchived(db: DbLike, actor: Actor, id: string, archived: boolean) {
  const [row] = await db.select().from(tasks).where(and(eq(tasks.id, id), visibleTasks(actor))).for("update");
  if (!row) throw notFound("Task");
  if (!mayManageTask(actor, { createdBy: row.createdBy, managerIds: await managerIdsOf(db, id) })) throw forbidden();
  if (Boolean(row.archivedAt) === archived) return { id, archived };
  const before = await taskSnapshot(db, id);
  await db
    .update(tasks)
    .set({ archivedAt: archived ? new Date() : null, updatedBy: actor.userId })
    .where(eq(tasks.id, id));
  await writeAudit(db, actor, {
    entityType: "task",
    entityId: id,
    action: archived ? "archive" : "restore",
    before,
    after: await taskSnapshot(db, id),
  });
  return { id, archived };
}
export const archiveTask = (db: DbLike, actor: Actor | null, id: string) => {
  if (actor) return setTaskArchived(db, actor, id, true);
  return (async () => {
    await findTaskRow(db, null, id, true);
    const before = await taskSnapshot(db, id);
    await db.update(tasks).set({ archivedAt: new Date(), updatedBy: null }).where(eq(tasks.id, id));
    await writeAudit(db, null, { entityType: "task", entityId: id, action: "archive", before, after: await taskSnapshot(db, id) });
    return { id, archived: true };
  })();
};

// Checklist items: anyone who can see the task works its checklist. Each change
// is audited as a change of the task's checklist.
async function changeChecklist(
  db: DbLike,
  actor: Actor | null,
  taskId: string,
  change: () => Promise<void>,
) {
  await findTaskRow(db, actor, taskId, true);
  const before = await taskSnapshot(db, taskId);
  await change();
  await db
    .update(tasks)
    .set({ updatedBy: actor?.userId ?? null })
    .where(eq(tasks.id, taskId));
  await writeAudit(db, actor, {
    entityType: "task",
    entityId: taskId,
    action: "update",
    before,
    after: await taskSnapshot(db, taskId),
  });
}

async function findChecklistItem(db: DbLike, taskId: string, itemId: string) {
  const [item] = await db
    .select()
    .from(taskChecklistItems)
    .where(
      and(
        eq(taskChecklistItems.id, itemId),
        eq(taskChecklistItems.taskId, taskId),
        isNull(taskChecklistItems.archivedAt),
      ),
    );
  if (!item) throw notFound("Checklist item");
  return item;
}

export function addChecklistItem(
  db: DbLike,
  actor: Actor | null,
  taskId: string,
  label: string,
) {
  return changeChecklist(db, actor, taskId, async () => {
    const [{ last }] = await db
      .select({ last: sql<number | null>`max(${taskChecklistItems.sortOrder})` })
      .from(taskChecklistItems)
      .where(eq(taskChecklistItems.taskId, taskId));
    await db.insert(taskChecklistItems).values({
      taskId,
      label,
      sortOrder: (last ?? -1) + 1,
      createdBy: actor?.userId ?? null,
      updatedBy: actor?.userId ?? null,
    });
  });
}

export function updateChecklistItem(
  db: DbLike,
  actor: Actor | null,
  taskId: string,
  itemId: string,
  patch: ChecklistItemUpdate,
) {
  return changeChecklist(db, actor, taskId, async () => {
    const item = await findChecklistItem(db, taskId, itemId);
    const by = actor?.userId ?? null;
    const done =
      patch.done === undefined || patch.done === (item.doneAt !== null)
        ? {}
        : patch.done
          ? { doneAt: new Date(), doneBy: by }
          : { doneAt: null, doneBy: null };
    await db
      .update(taskChecklistItems)
      .set({
        ...(patch.label !== undefined && { label: patch.label }),
        ...done,
        updatedBy: by,
      })
      .where(eq(taskChecklistItems.id, itemId));
  });
}

export function archiveChecklistItem(
  db: DbLike,
  actor: Actor | null,
  taskId: string,
  itemId: string,
) {
  return changeChecklist(db, actor, taskId, async () => {
    await findChecklistItem(db, taskId, itemId);
    await db
      .update(taskChecklistItems)
      .set({ archivedAt: new Date(), updatedBy: actor?.userId ?? null })
      .where(eq(taskChecklistItems.id, itemId));
  });
}

// Comments are append-only; each is audited as a task_comment create.
export async function addComment(
  db: DbLike,
  actor: Actor,
  taskId: string,
  body: string,
) {
  await findTaskRow(db, actor, taskId);
  const [row] = await db
    .insert(taskComments)
    .values({ taskId, body, createdBy: actor.userId, updatedBy: actor.userId })
    .returning();
  await writeAudit(db, actor, {
    entityType: "task_comment",
    entityId: row.id,
    action: "create",
    before: null,
    after: { taskId, body },
  });
}

// Display names for user ids; an unknown id stands in for its own name.
async function peopleOf(db: DbLike, ids: (string | null)[]) {
  const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
  const rows = wanted.length
    ? await db
        .select({ id: users.id, name: users.name, email: users.email })
        .from(users)
        .where(inArray(users.id, wanted))
    : [];
  const names = new Map(rows.map((row) => [row.id, row.name || row.email]));
  return (id: string | null): TaskPerson | null =>
    id === null ? null : { id, name: names.get(id) ?? id };
}

async function toSummaries(
  db: DbLike,
  actor: Actor,
  rows: TaskRow[],
): Promise<TaskSummary[]> {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const assigned = await db
    .select({ taskId: taskAssignees.taskId, userId: taskAssignees.userId })
    .from(taskAssignees)
    .where(and(inArray(taskAssignees.taskId, ids), isNull(taskAssignees.archivedAt)))
    .orderBy(asc(taskAssignees.createdAt), asc(taskAssignees.userId));
  const managers = await db.select({ taskId: taskManagers.taskId, userId: taskManagers.userId })
    .from(taskManagers)
    .where(and(inArray(taskManagers.taskId, ids), isNull(taskManagers.archivedAt)))
    .orderBy(asc(taskManagers.createdAt), asc(taskManagers.userId));
  const counts = await db
    .select({
      taskId: taskChecklistItems.taskId,
      total: sql<number>`count(*)::int`,
      done: sql<number>`count(${taskChecklistItems.doneAt})::int`,
    })
    .from(taskChecklistItems)
    .where(
      and(
        inArray(taskChecklistItems.taskId, ids),
        isNull(taskChecklistItems.archivedAt),
      ),
    )
    .groupBy(taskChecklistItems.taskId);
  const eventIds = [
    ...new Set(rows.flatMap((row) => (row.eventId ? [row.eventId] : []))),
  ];
  const titles = new Map(
    eventIds.length
      ? (
          await db
            .select({ id: events.id, title: events.title })
            .from(events)
            .where(and(inArray(events.id, eventIds), visibleEvents(actor)))
        ).map((row) => [row.id, row.title])
      : [],
  );
  const person = await peopleOf(db, [
    ...assigned.map((row) => row.userId),
    ...managers.map((row) => row.userId),
    ...rows.flatMap((row) => [row.createdBy, row.completedBy]),
  ]);
  const assignedBy = groupBy(assigned, (a) => a.taskId);
  const managersBy = groupBy(managers, (m) => m.taskId);
  const countBy = indexBy(counts, (c) => c.taskId);
  return rows.map((row) => {
    const tally = countBy.get(row.id);
    return {
      id: row.id,
      title: row.title,
      type: row.type,
      status: row.status,
      priority: row.priority,
      dueAt: row.dueAt?.toISOString() ?? null,
      assignees: (assignedBy.get(row.id) ?? []).map((a) => person(a.userId)!),
      overseer: (managersBy.get(row.id) ?? []).map((m) => person(m.userId)!),
      managers: (managersBy.get(row.id) ?? []).map((m) => person(m.userId)!),
      creator: person(row.createdBy),
      eventId: row.eventId,
      eventTitle: row.eventId ? (titles.get(row.eventId) ?? null) : null,
      clientId: row.clientId,
      inventoryItemId: row.inventoryItemId,
      beoId: row.beoId,
      sopId: row.sopId,
      position: row.position,
      templateItemId: row.templateItemId,
      checklistDone: tally?.done ?? 0,
      checklistTotal: tally?.total ?? 0,
      completedAt: row.completedAt?.toISOString() ?? null,
      completedBy: person(row.completedBy),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

// Summaries of the given tasks the actor can see, in the given order.
export async function getTaskSummaries(db: DbLike, actor: Actor, ids: string[]) {
  if (!ids.length) return [];
  const rows = await db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.id, ids), isNull(tasks.archivedAt), visibleTasks(actor)));
  const byId = indexBy(rows, (row) => row.id);
  return toSummaries(
    db,
    actor,
    ids.flatMap((id) => byId.get(id) ?? []),
  );
}

export async function getTask(db: DbLike, actor: Actor, id: string): Promise<Task> {
  const row = await findTaskRow(db, actor, id);
  const [summary] = await toSummaries(db, actor, [row]);
  const checklist = await db
    .select()
    .from(taskChecklistItems)
    .where(
      and(eq(taskChecklistItems.taskId, id), isNull(taskChecklistItems.archivedAt)),
    )
    .orderBy(asc(taskChecklistItems.sortOrder), asc(taskChecklistItems.createdAt));
  const comments = await db
    .select()
    .from(taskComments)
    .where(and(eq(taskComments.taskId, id), isNull(taskComments.archivedAt)))
    .orderBy(asc(taskComments.createdAt));
  const person = await peopleOf(db, [
    ...checklist.map((item) => item.doneBy),
    ...comments.map((comment) => comment.createdBy),
  ]);
  return {
    ...summary,
    description: row.description,
    notes: row.notes,
    checklist: checklist.map((item) => ({
      id: item.id,
      label: item.label,
      done: item.doneAt !== null,
      doneAt: item.doneAt?.toISOString() ?? null,
      doneBy: person(item.doneBy),
    })),
    comments: comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: person(comment.createdBy),
      createdAt: comment.createdAt.toISOString(),
    })),
    canManage: mayManageTask(actor, { createdBy: row.createdBy, managerIds: summary.managers.map((m) => m.id) }),
  };
}

// Every task the actor can see, whichever module created it (AC1), newest first.
// Without mine=true this is the communal list (FLOW-59): FT+ see every task;
// everyone else sees the tasks they're on plus the open unassigned ones
// (FLOW-272), which they can pick up.
export async function listTasksPage(
  db: DbLike,
  actor: Actor,
  filter: TaskFilter,
  page: PageRequest = {},
  now = new Date(),
): Promise<Page<TaskSummary>> {
  const paging = keyset<TaskRow>(
    [
      { column: tasks.createdAt, type: "timestamp", desc: true, of: (row) => row.createdAt },
      { column: tasks.id, type: "uuid", desc: true, of: (row) => row.id },
    ],
    page,
  );
  const rows = await db
    .select()
    .from(tasks)
    .where(and(listWhere(actor, filter, now), paging.where))
    .orderBy(...paging.orderBy)
    .limit(paging.limit);
  return paging.page(rows, (kept) => toSummaries(db, actor, kept));
}

// One dashboard section: how many tasks match, and the soonest-due of them.
async function section(
  db: DbLike,
  actor: Actor,
  where: SQL | undefined,
  now: Date,
): Promise<TaskDashboardSection> {
  const [{ total }] = await db.select({ total: count() }).from(tasks).where(where);
  const rows = await db
    .select()
    .from(tasks)
    .where(where)
    .orderBy(sql`${tasks.dueAt} asc nulls last`, asc(tasks.createdAt), asc(tasks.id))
    .limit(DASHBOARD_SECTION_SIZE);
  return { count: total, tasks: (await toSummaries(db, actor, rows)).map((task) => ({
    ...task, dueBucket: dueBucket(task.dueAt, now),
  })) };
}

// Unassigned open tasks that need someone (FLOW-61 AC1): those on events that
// start between today and NEEDS_DELEGATION_DAYS from now (business dates), and
// those on no event that are due by then or have no due date. Archived and lost
// events don't count.
function needsDelegationWhere(now: Date) {
  const today = utcToBusinessTime(now).date;
  const from = businessTimeToUtc(today, "00:00");
  const until = businessTimeToUtc(addLocalDays(today, NEEDS_DELEGATION_DAYS + 1), "00:00");
  return and(
    unassigned,
    or(
      sql`exists (select 1 from ${events} where ${events.id} = ${tasks.eventId} and ${events.archivedAt} is null and ${events.status} <> 'lost' and ${events.startsAt} >= ${from.toISOString()}::timestamptz and ${events.startsAt} < ${until.toISOString()}::timestamptz)`,
      and(isNull(tasks.eventId), or(isNull(tasks.dueAt), lte(tasks.dueAt, until))),
    ),
  );
}

// The task dashboard (FLOW-61): the actor's own open tasks by when they're due,
// the open tasks they manage, and for managers "Needs delegation". Each count
// matches the task list with the same filters (AC2): mine=true&assigneeId=<me>&
// due=<bucket>, mine=true&overseerId=<me>, and unassigned=true for Needs
// delegation, which also keeps to the next 14 days.
export async function taskDashboard(
  db: DbLike,
  actor: Actor,
  now = new Date(),
): Promise<TaskDashboard> {
  const [setting] = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, "defaults"));
  const parsed = businessDefaultsSchema.safeParse(setting?.value ?? {});
  const hideDays = parsed.success ? parsed.data.hideCompletedTasksAfterDays : defaultBusinessDefaults.hideCompletedTasksAfterDays;
  const cutoff = new Date(now.getTime() - hideDays * 86_400_000);
  const keep = or(ne(tasks.status, "done"), gte(tasks.completedAt, cutoff));
  const mine = (due: TaskDueBucket) =>
    section(
      db,
      actor,
      and(listWhere(actor, { mine: "true", assigneeId: actor.userId, due, includeDone: "true" }, now), keep),
      now,
    );
  return {
    all: await section(db, actor, and(listWhere(actor, { includeDone: "true" }, now), keep), now),
    mine: await section(db, actor, and(listWhere(actor, { assigneeId: actor.userId, includeDone: "true" }, now), keep), now),
    managing: await section(db, actor, and(listWhere(actor, { overseerId: actor.userId, includeDone: "true" }, now), keep), now),
    overdue: await mine("overdue"),
    today: await mine("today"),
    upcoming: await mine("upcoming"),
    overseeing: await section(
      db,
      actor,
      and(listWhere(actor, { mine: "true", overseerId: actor.userId, includeDone: "true" }, now), keep),
      now,
    ),
    needsDelegation: can(actor, "tasks.triage")
      ? await section(
          db,
          actor,
          and(
            listWhere(actor, { unassigned: "true" }, now),
            needsDelegationWhere(now),
          ),
          now,
        )
      : null,
  };
}

// How far back the due-task scan looks; a task further overdue than this when the
// scan first sees it (e.g. after an outage) is not announced.
const DUE_LOOKBACK_MS = 7 * 24 * 60 * 60_000;

// Emits task.due once for each open task whose due time has passed (FLOW-43's
// "task due" trigger). One statement per cron run: the key names the task and
// its due time, so a repeated scan adds nothing, and moving the due time later
// announces it again when the new time comes.
export async function emitDueTaskEvents(db: DbLike, now = new Date()) {
  const since = new Date(now.getTime() - DUE_LOOKBACK_MS);
  const result = await db.execute(sql`
    insert into ${jobs} (type, payload, idempotency_key, run_at)
    select 'event:task.due',
      jsonb_build_object('entityId', ${tasks.id}::text),
      'event:task.due:' || ${tasks.id}::text || ':' || floor(extract(epoch from ${tasks.dueAt}) * 1000)::bigint::text,
      ${now.toISOString()}::timestamptz
    from ${tasks}
    where ${tasks.archivedAt} is null
      and ${tasks.status} <> 'done'
      and ${tasks.dueAt} <= ${now.toISOString()}::timestamptz
      and ${tasks.dueAt} > ${since.toISOString()}::timestamptz
    on conflict (idempotency_key) do nothing`);
  return (result as unknown as { count?: number }).count ?? 0;
}

// How long before its due time a task counts as due soon (FLOW-60).
export const DUE_SOON_MS = 24 * 60 * 60_000;

// Emits task.due_soon once for each open, assigned task that will be due within
// DUE_SOON_MS, keyed like task.due so a repeated scan adds nothing and a new due
// time is announced again.
export async function emitDueSoonTaskEvents(db: DbLike, now = new Date()) {
  const until = new Date(now.getTime() + DUE_SOON_MS);
  const result = await db.execute(sql`
    insert into ${jobs} (type, payload, idempotency_key, run_at)
    select 'event:task.due_soon',
      jsonb_build_object('entityId', ${tasks.id}::text),
      'event:task.due_soon:' || ${tasks.id}::text || ':' || floor(extract(epoch from ${tasks.dueAt}) * 1000)::bigint::text,
      ${now.toISOString()}::timestamptz
    from ${tasks}
    where ${tasks.archivedAt} is null
      and ${tasks.status} <> 'done'
      and ${tasks.dueAt} > ${now.toISOString()}::timestamptz
      and ${tasks.dueAt} <= ${until.toISOString()}::timestamptz
      and exists (select 1 from ${taskAssignees} where ${taskAssignees.taskId} = ${tasks.id} and ${taskAssignees.archivedAt} is null)
    on conflict (idempotency_key) do nothing`);
  return (result as unknown as { count?: number }).count ?? 0;
}
