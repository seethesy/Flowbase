import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import {
  MAX_TASK_VIEWS,
  taskViewFilterSchema,
  type TaskView,
  type TaskViewInput,
} from "../../shared/tasks";
import type { DbLike } from "../db/client";
import { taskViews } from "../db/schema";
import { ApiError, notFound } from "../hono";

// Saved task views (FLOW-59 AC3): each person's own named filters for the task
// list. Nobody else sees or changes them, so they aren't audited, like
// notification preferences.

const toView = (row: typeof taskViews.$inferSelect): TaskView => ({
  id: row.id,
  name: row.name,
  // A filter saved by an older version keeps only what still parses.
  filter: taskViewFilterSchema.catch({}).parse(row.filter),
  createdAt: row.createdAt.toISOString(),
});

const own = (actor: Actor) =>
  and(eq(taskViews.userId, actor.userId), isNull(taskViews.archivedAt));

export async function listTaskViews(db: DbLike, actor: Actor) {
  const rows = await db
    .select()
    .from(taskViews)
    .where(own(actor))
    .orderBy(asc(taskViews.createdAt), asc(taskViews.id));
  return rows.map(toView);
}

export async function createTaskView(
  db: DbLike,
  actor: Actor,
  input: TaskViewInput,
) {
  const [{ total }] = await db
    .select({ total: count() })
    .from(taskViews)
    .where(own(actor));
  if (total >= MAX_TASK_VIEWS)
    throw new ApiError(
      400,
      "INVALID_REQUEST",
      `You can save up to ${MAX_TASK_VIEWS} views. Delete one first.`,
    );
  const [row] = await db
    .insert(taskViews)
    .values({
      userId: actor.userId,
      name: input.name,
      filter: input.filter,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning();
  return toView(row);
}

export async function deleteTaskView(db: DbLike, actor: Actor, id: string) {
  const [row] = await db
    .update(taskViews)
    .set({ archivedAt: new Date(), updatedBy: actor.userId })
    .where(and(eq(taskViews.id, id), own(actor)))
    .returning({ id: taskViews.id });
  if (!row) throw notFound("View");
}
