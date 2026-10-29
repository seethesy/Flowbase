import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type { Actor } from "../../shared/access";
import {
  templateDueAt,
  type TaskTemplate,
  type taskTemplateInputSchema,
} from "../../shared/tasks";
import { writeAudit } from "../audit/log";
import type { DbLike } from "../db/client";
import { events, tasks, taskTemplateItems, taskTemplates } from "../db/schema";
import { ApiError, notFound } from "../hono";
import { findVisibleEvent } from "./events";
import { createTask } from "./tasks";

// Task templates (FLOW-62): reusable sets of tasks with due dates relative to an
// event, used by production schedules (FLOW-138). Applying one creates a task per
// item through the task service, at its real due date (AC1). Each task remembers
// its item, and (event, item) is unique on tasks, so applying again only adds
// tasks for items the event doesn't have yet (AC2).

type TemplateInput = z.output<typeof taskTemplateInputSchema>;
type TemplateRow = typeof taskTemplates.$inferSelect;

async function itemsOf(db: DbLike, templateIds: string[]) {
  if (!templateIds.length) return [];
  return db
    .select()
    .from(taskTemplateItems)
    .where(
      and(
        inArray(taskTemplateItems.templateId, templateIds),
        isNull(taskTemplateItems.archivedAt),
      ),
    )
    .orderBy(asc(taskTemplateItems.sortOrder), asc(taskTemplateItems.createdAt));
}

async function toTemplates(db: DbLike, rows: TemplateRow[]): Promise<TaskTemplate[]> {
  const items = await itemsOf(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    sopUrl: row.sopUrl,
    items: items
      .filter((item) => item.templateId === row.id)
      .map((item) => ({
        id: item.id,
        title: item.title,
        type: item.type,
        offsetDays: item.offsetDays,
        time: item.time,
        position: item.position,
      })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

async function findTemplateRow(db: DbLike, id: string, lock = false) {
  const query = db
    .select()
    .from(taskTemplates)
    .where(and(eq(taskTemplates.id, id), isNull(taskTemplates.archivedAt)));
  const [row] = lock ? await query.for("update") : await query;
  if (!row) throw notFound("Task template");
  return row;
}

export async function listTaskTemplates(db: DbLike) {
  const rows = await db
    .select()
    .from(taskTemplates)
    .where(isNull(taskTemplates.archivedAt))
    .orderBy(asc(taskTemplates.name));
  return toTemplates(db, rows);
}

export async function getTaskTemplate(db: DbLike, id: string) {
  const [template] = await toTemplates(db, [await findTemplateRow(db, id)]);
  return template;
}

// The audit snapshot: the template as the API shows it, without ids and times.
async function snapshot(db: DbLike, id: string) {
  const [row] = await db.select().from(taskTemplates).where(eq(taskTemplates.id, id));
  const [template] = await toTemplates(db, [row]);
  return {
    name: template.name,
    sopUrl: template.sopUrl,
    items: template.items.map((item) => ({
      title: item.title,
      type: item.type,
      offsetDays: item.offsetDays,
      time: item.time,
      position: item.position,
    })),
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

async function assertUniqueName(db: DbLike, name: string, except?: string) {
  const [clash] = await db
    .select({ id: taskTemplates.id })
    .from(taskTemplates)
    .where(
      and(
        sql`lower(${taskTemplates.name}) = lower(${name})`,
        isNull(taskTemplates.archivedAt),
      ),
    );
  if (clash && clash.id !== except)
    throw new ApiError(409, "ALREADY_EXISTS", "A template with this name already exists.");
}

// Writes the items: given ids update their item, new ones are added, and items
// left out are archived (tasks made from them keep their link).
async function saveItems(
  db: DbLike,
  actor: Actor,
  templateId: string,
  items: TemplateInput["items"],
) {
  const existing = await itemsOf(db, [templateId]);
  const known = new Set(existing.map((item) => item.id));
  const kept = new Set<string>();
  for (const [sortOrder, item] of items.entries()) {
    const values = {
      title: item.title,
      type: item.type,
      offsetDays: item.offsetDays,
      time: item.time,
      position: item.position || null,
      sortOrder,
      updatedBy: actor.userId,
    };
    if (item.id && known.has(item.id)) {
      kept.add(item.id);
      await db
        .update(taskTemplateItems)
        .set(values)
        .where(eq(taskTemplateItems.id, item.id));
    } else {
      await db
        .insert(taskTemplateItems)
        .values({ ...values, templateId, createdBy: actor.userId });
    }
  }
  const dropped = existing.filter((item) => !kept.has(item.id)).map((item) => item.id);
  if (dropped.length)
    await db
      .update(taskTemplateItems)
      .set({ archivedAt: new Date(), updatedBy: actor.userId })
      .where(inArray(taskTemplateItems.id, dropped));
}

export async function createTaskTemplate(
  db: DbLike,
  actor: Actor,
  input: TemplateInput,
) {
  await assertUniqueName(db, input.name);
  const [row] = await db
    .insert(taskTemplates)
    .values({
      name: input.name,
      sopUrl: input.sopUrl,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning();
  await saveItems(db, actor, row.id, input.items);
  await writeAudit(db, actor, {
    entityType: "task_template",
    entityId: row.id,
    action: "create",
    before: null,
    after: await snapshot(db, row.id),
  });
  return row.id;
}

export async function updateTaskTemplate(
  db: DbLike,
  actor: Actor,
  id: string,
  input: TemplateInput,
) {
  await findTemplateRow(db, id, true);
  await assertUniqueName(db, input.name, id);
  const before = await snapshot(db, id);
  await db
    .update(taskTemplates)
    .set({ name: input.name, sopUrl: input.sopUrl, updatedBy: actor.userId })
    .where(eq(taskTemplates.id, id));
  await saveItems(db, actor, id, input.items);
  await writeAudit(db, actor, {
    entityType: "task_template",
    entityId: id,
    action: "update",
    before,
    after: await snapshot(db, id),
  });
}

export async function archiveTaskTemplate(db: DbLike, actor: Actor, id: string) {
  await findTemplateRow(db, id, true);
  const before = await snapshot(db, id);
  await db
    .update(taskTemplates)
    .set({ archivedAt: new Date(), updatedBy: actor.userId })
    .where(eq(taskTemplates.id, id));
  await writeAudit(db, actor, {
    entityType: "task_template",
    entityId: id,
    action: "archive",
    before,
    after: await snapshot(db, id),
  });
}

// Applies a template to an event in the caller's transaction (AC1, AC2). actor
// null is the system (production schedules); a person must be able to open the
// event. The event row is locked so two applies at once can't both add a task.
// Tasks are created unassigned, to be delegated from the dashboard (FLOW-61).
export async function applyTaskTemplate(
  db: DbLike,
  actor: Actor | null,
  templateId: string,
  eventId: string,
): Promise<{ createdIds: string[]; skipped: number }> {
  const template = await findTemplateRow(db, templateId);
  if (actor) await findVisibleEvent(db, actor, eventId);
  const [event] = await db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), isNull(events.archivedAt)))
    .for("update");
  if (!event) throw notFound("Event");
  const items = await itemsOf(db, [template.id]);
  const done = new Set(
    items.length
      ? (
          await db
            .select({ itemId: tasks.templateItemId })
            .from(tasks)
            .where(
              and(
                eq(tasks.eventId, eventId),
                inArray(
                  tasks.templateItemId,
                  items.map((item) => item.id),
                ),
              ),
            )
        ).map((row) => row.itemId)
      : [],
  );
  const createdIds: string[] = [];
  for (const item of items) {
    if (done.has(item.id)) continue;
    createdIds.push(
      await createTask(
        db,
        actor,
        {
          title: item.title,
          description: template.sopUrl ? `SOP: ${template.sopUrl}` : "",
          type: item.type,
          status: "todo",
          priority: "normal",
          dueAt: templateDueAt(event.startsAt, item).toISOString(),
          assigneeIds: [],
          overseerId: null,
          eventId,
          clientId: null,
          inventoryItemId: null,
          beoId: null,
          position: item.position,
          checklist: [],
        },
        { templateItemId: item.id },
      ),
    );
  }
  return { createdIds, skipped: items.length - createdIds.length };
}
